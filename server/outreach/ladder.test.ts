import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// TICKET-10 done-when, over HTTP against a seeded database: the silent patient climbs the
// ladder on schedule, the patient's two answers do what the ticket says, delay reasons are
// a closed set, and the Arabic page is right-to-left. CX-1001 is the seeded silent
// patient: Arabic-speaking, automated message sent 16 Nov 10:20, no answer yet.

let server: Server | undefined;
let base = "";
let dir = "";

const TOKEN = "hq7m3kx9va";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-outreach-"));
  process.env.DATABASE_FILE = join(dir, "outreach.sqlite");

  const { getDb } = await import("../db.js");
  const { app } = await import("../index.js");
  await getDb();

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server?.address();
  if (typeof address === "object" && address !== null) base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closeDb } = await import("../db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

// Every test starts from the demo seed at day 0, the way `npm run demo:reset` leaves it.
beforeEach(async () => {
  const { getDb, resetDatabase } = await import("../db.js");
  const { seed } = await import("../seed.js");
  const db = await getDb();
  await resetDatabase(db);
  await seed(db);
});

function actor(id: string, role: string, name: string): Record<string, string> {
  return { "X-Nexyra-Actor": JSON.stringify({ actor_id: id, role, display_name: name }) };
}
const COORDINATOR = actor("act_001", "coordination_staff", "R. Haddad");
const NAVIGATOR = actor("act_002", "navigator", "Nur H.");

async function call(
  method: "GET" | "POST",
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await response.json()) as any;
  return { status: response.status, body };
}

const advance = (days: number) => call("POST", "/api/clock/advance", { body: { days } });
const ladder = () => call("GET", "/api/cases/CX-1001/outreach?role=program_manager");
const caseView = () => call("GET", "/api/cases/CX-1001?role=program_manager");

type Step = { key: string; state: string; task: { kind: string; owner: { actor_id: string; role: string }; due_at: string; status: string } | null };
const step = (body: { ladder: Step[] }, key: string) => body.ladder.find((s) => s.key === key);

async function eventsOf(type: string) {
  const { getDb } = await import("../db.js");
  return (await getDb())
    .prepare(
      `SELECT id, actor_id, actor_role, occurred_at, payload FROM events
        WHERE case_id = 'CX-1001' AND type = ? ORDER BY rowid`,
    )
    .all<{ id: string; actor_id: string; actor_role: string; occurred_at: string; payload: string }>(type);
}

describe("TICKET-10: step 1, the automated message", () => {
  it("is fixed template text in Arabic, recorded as an event by system, with a simulated link", async () => {
    const [sent] = await eventsOf("outreach_message_sent");
    expect(sent?.actor_role).toBe("system");
    const payload = JSON.parse(sent?.payload ?? "{}");
    expect(payload.language).toBe("ar");
    expect(payload.dir).toBe("rtl");
    expect(payload.delivery).toBe("simulated");
    expect(payload.link).toBe(`/p/${TOKEN}`);
    // The template's fixed words with the variables filled in, nothing else.
    expect(payload.text).toContain("Y. Al Hammadi");
    expect(payload.text).toContain("+971 2 000 0000");
    expect(payload.text).toContain(`/p/${TOKEN}`);
    expect(payload.text).not.toMatch(/\{[a-z_]+\}/);

    const { body } = await ladder();
    expect(body.message.sent).toBe(true);
    expect(body.message.text).toBe(payload.text);
    expect(body.link.path).toBe(`/p/${TOKEN}`);
    expect(body.status).toBe("waiting_for_patient");
  });

  it("is sent by tick to a new case at Result received, once", async () => {
    const { getDb } = await import("../db.js");
    const { createCase } = await import("../events.js");
    const db = await getDb();
    await createCase(db, {
      caseId: "CX-T-NEW",
      patient: { name: "T. Example", age: 61, language: "ur" },
      actor: { actor_id: "act_system", role: "system", display_name: "system" },
    });

    const first = await call("POST", "/api/clock/tick");
    expect(first.body.outreach.messages_sent).toBe(1);
    const second = await call("POST", "/api/clock/tick");
    expect(second.body.outreach.messages_sent).toBe(0);

    const row = await db
      .prepare("SELECT payload FROM events WHERE case_id = 'CX-T-NEW' AND type = 'outreach_message_sent'")
      .all<{ payload: string }>();
    expect(row).toHaveLength(1);
    // Urdu is only a draft slot, so the English text goes out and says why.
    const payload = JSON.parse(row[0]?.payload ?? "{}");
    expect(payload.language).toBe("en");
    expect(payload.language_fallback).toBe(true);
    expect(payload.requested_review_status).toBe("draft_slot");
  });
});

describe("TICKET-10: the silent patient", () => {
  it("TICKET-10: a silent patient escalates to a staff call and then to a navigator according to the template deadlines", async () => {
    // Day 0: message sent 16 Nov 10:20, 25h ago. The staff call is due at +48h.
    let view = (await ladder()).body;
    expect(step(view, "staff_call")?.state).toBe("scheduled");
    expect(step(view, "navigator")?.state).toBe("scheduled");

    // Day 1 (18 Nov 11:42), 49h after the message: the staff call task.
    const day1 = await advance(1);
    expect(day1.body.outreach.staff_calls).toBe(1);
    expect(day1.body.outreach.navigator_escalations).toBe(0);
    view = (await ladder()).body;
    const callTask = step(view, "staff_call")?.task;
    expect(step(view, "staff_call")?.state).toBe("done");
    expect(callTask?.kind).toBe("outreach_call");
    expect(callTask?.owner.actor_id).toBe("act_005"); // the coordinator who owns the case
    expect(callTask?.owner.role).toBe("coordination_staff");
    expect(callTask?.due_at).toBe("2026-11-19T11:42:00+07:00"); // + staff_call_due_hours (24)

    // Ticking again at the same instant changes nothing.
    const again = await call("POST", "/api/clock/tick");
    expect(again.body.outreach.staff_calls).toBe(0);

    // Staff call, nobody answers: no barrier, so the ladder waits.
    const logged = await call("POST", "/api/cases/CX-1001/outreach", {
      headers: COORDINATOR,
      body: { outcome: "no_answer", channel: "call", connected: false },
    });
    expect(logged.status).toBe(200);
    view = (await ladder()).body;
    expect(step(view, "staff_call")?.task?.status).toBe("completed");
    expect(step(view, "navigator")?.state).toBe("scheduled");

    // Day 2: only 24h since the call step, under navigator_after_hours (48).
    const day2 = await advance(1);
    expect(day2.body.outreach.navigator_escalations).toBe(0);

    // Day 3: 48h since the call step and the case has not moved: the navigator.
    const day3 = await advance(1);
    expect(day3.body.outreach.navigator_escalations).toBe(1);
    view = (await ladder()).body;
    expect(view.status).toBe("navigator");
    const navTask = step(view, "navigator")?.task;
    expect(navTask?.kind).toBe("outreach_navigator");
    expect(navTask?.owner.actor_id).toBe("act_002");
    expect(navTask?.owner.role).toBe("navigator");
    expect(navTask?.due_at).toBe("2026-11-22T11:42:00+07:00");

    const [assigned] = await eventsOf("outreach_navigator_assigned");
    expect(assigned?.actor_role).toBe("system");
    expect(JSON.parse(assigned?.payload ?? "{}").reason).toBe("no_movement");

    // The ladder never moves the case, and its steps are not counted as escalations.
    expect((await caseView()).body.case.stage).toBe("result_received");
    expect(day1.body.escalations_per_role.some((r: { role: string }) => r.role === "navigator")).toBe(false);

    // The program manager sees the navigator's task in the register (the navigator has
    // no screen), and the navigator records the barrier: fear of the bowel preparation.
    const register = await call("GET", "/api/cases?role=program_manager");
    expect(register.body.cases.some((row: { case_id: string }) => row.case_id === "CX-1001")).toBe(true);

    const navigatorCall = await call("POST", "/api/cases/CX-1001/outreach", {
      headers: NAVIGATOR,
      body: {
        outcome: "Reached the patient; afraid of the bowel preparation",
        channel: "call",
        connected: true,
        delay_reason: "fear",
        note: "Afraid of drinking the bowel preparation",
      },
    });
    expect(navigatorCall.status).toBe(200);
    const recorded = navigatorCall.body.timeline.find((e: { event_id: string }) => e.event_id === navigatorCall.body.recorded);
    expect(recorded.payload.delay_reason).toBe("fear");
    expect(recorded.payload.connected).toBe(true);
    view = (await ladder()).body;
    expect(step(view, "navigator")?.task?.status).toBe("completed");
  });

  it("goes to the navigator at once when staff record a barrier", async () => {
    await advance(1); // the staff call task
    const logged = await call("POST", "/api/cases/CX-1001/outreach", {
      headers: COORDINATOR,
      body: { outcome: "Patient says she is scared of the test", connected: true, delay_reason: "fear" },
    });
    expect(logged.status).toBe(200);

    const view = (await ladder()).body;
    expect(view.status).toBe("navigator");
    const [assigned] = await eventsOf("outreach_navigator_assigned");
    const payload = JSON.parse(assigned?.payload ?? "{}");
    expect(payload.reason).toBe("barrier");
    expect(payload.delay_reason).toBe("fear");
    expect(step(view, "navigator")?.task?.owner.role).toBe("navigator");
  });
});

describe("TICKET-10: the patient's answers", () => {
  it("TICKET-10: patient confirmation stops the ladder and advances the case", async () => {
    await advance(1); // a staff call task is open
    const answer = await call("POST", `/api/patient/${TOKEN}/response`, { body: { response: "understood" } });
    expect(answer.status).toBe(200);
    expect(answer.body.response).toBe("understood");

    const detail = (await caseView()).body;
    expect(detail.case.stage).toBe("patient_notified");
    const types = detail.timeline.map((e: { type: string }) => e.type);
    expect(types).toContain("patient_acknowledged");
    expect(types).toContain("outreach_ladder_stopped");
    const notified = detail.timeline.find((e: { type: string }) => e.type === "patient_notified");
    expect(notified.actor).toBeNull(); // written by system on the patient's behalf
    expect(notified.payload.channel).toBe("patient_page");

    const [ack] = await eventsOf("patient_acknowledged");
    expect(ack?.actor_role).toBe("patient");

    // The open call task is cancelled, and no later tick climbs the ladder.
    let view = (await ladder()).body;
    expect(view.status).toBe("acknowledged");
    expect(step(view, "staff_call")?.task?.status).toBe("cancelled");
    const later = await advance(4);
    expect(later.body.outreach.navigator_escalations).toBe(0);
    view = (await ladder()).body;
    expect(step(view, "navigator")?.state).toBe("stopped");

    // A second tap is the same answer, not a second event.
    const repeat = await call("POST", `/api/patient/${TOKEN}/response`, { body: { response: "understood" } });
    expect(repeat.body.recorded).toBeNull();
    expect(await eventsOf("patient_acknowledged")).toHaveLength(1);
  });

  it("TICKET-10: a call request creates a task with an owner and a deadline", async () => {
    const answer = await call("POST", `/api/patient/${TOKEN}/response`, { body: { response: "request_call" } });
    expect(answer.status).toBe(200);
    expect(answer.body.response).toBe("request_call");

    const detail = (await caseView()).body;
    const task = detail.tasks.find((t: { kind: string }) => t.kind === "patient_callback");
    expect(task).toBeDefined();
    expect(task.owner.actor_id).toBe("act_005");
    expect(task.owner.role).toBe("coordination_staff");
    expect(task.due_at).toBe("2026-11-18T11:42:00+07:00"); // day 0 + callback_due_hours (24)
    expect(task.status).toBe("open");

    const [requested] = await eventsOf("callback_requested");
    expect(requested?.actor_role).toBe("patient");
    expect(JSON.parse(requested?.payload ?? "{}").task_id).toBe(task.task_id);

    // The case stays where it is, the request counts as the call step (no second call
    // task at the message deadline), and asking twice opens no second task.
    expect(detail.case.stage).toBe("result_received");
    const day1 = await advance(1);
    expect(day1.body.outreach.staff_calls).toBe(0);
    await call("POST", `/api/patient/${TOKEN}/response`, { body: { response: "request_call" } });
    const tasks = (await caseView()).body.tasks.filter((t: { kind: string }) => t.kind === "patient_callback");
    expect(tasks).toHaveLength(1);
  });

  it("refuses an unknown answer and an unknown token", async () => {
    const bad = await call("POST", `/api/patient/${TOKEN}/response`, { body: { response: "maybe" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("validation_failed");
    const missing = await call("GET", "/api/patient/not-a-token");
    expect(missing.status).toBe(404);
  });
});

describe("TICKET-10: delay reasons", () => {
  it("TICKET-10: delay reason is stored as a structured choice, never as free text", async () => {
    const ok = await call("POST", "/api/cases/CX-1001/outreach", {
      headers: COORDINATOR,
      body: { outcome: "connected", connected: true, delay_reason: "transport", note: "No car until Friday" },
    });
    expect(ok.status).toBe(200);
    const event = ok.body.timeline.find((e: { event_id: string }) => e.event_id === ok.body.recorded);
    expect(event.payload.delay_reason).toBe("transport");
    expect(event.payload.note).toBe("No car until Friday");

    const freeText = await call("POST", "/api/cases/CX-1001/outreach", {
      headers: COORDINATOR,
      body: { outcome: "connected", delay_reason: "no car until Friday" },
    });
    expect(freeText.status).toBe(400);
    expect(freeText.body.error.code).toBe("validation_failed");

    const badConnected = await call("POST", "/api/cases/CX-1001/outreach", {
      headers: COORDINATOR,
      body: { outcome: "connected", connected: "yes" },
    });
    expect(badConnected.status).toBe(400);

    // The staff screen offers exactly the closed set.
    const view = (await ladder()).body;
    expect(view.delay_reasons.map((r: { key: string }) => r.key)).toEqual([
      "fear",
      "transport",
      "cost",
      "language",
      "other",
    ]);
  });
});

describe("TICKET-10: the patient page", () => {
  it("TICKET-10: the Arabic patient page renders right-to-left", async () => {
    const { status, body } = await call("GET", `/api/patient/${TOKEN}`);
    expect(status).toBe(200);
    expect(body.language).toBe("ar");
    expect(body.content_language).toBe("ar");
    expect(body.dir).toBe("rtl");
    expect(body.content.page_title).toBe("نتيجة فحص القولون");
    expect(body.content.acknowledge).toBe("فهمت وسأحضر");
    expect(body.content.contact).toContain("+971 2 000 0000");
    expect(body.review_status).toBe("written_not_reviewed");
    expect(body.languages.find((l: { code: string }) => l.code === "ar").label).toBe(
      "not yet reviewed by a native speaker",
    );
  });

  it("switches language, and a draft slot falls back to English laid out left-to-right", async () => {
    const english = (await call("GET", `/api/patient/${TOKEN}?lang=en`)).body;
    expect(english.dir).toBe("ltr");
    expect(english.content.acknowledge).toBe("I understand and I will come");

    const urdu = (await call("GET", `/api/patient/${TOKEN}?lang=ur`)).body;
    expect(urdu.language).toBe("ur");
    expect(urdu.content_language).toBe("en");
    expect(urdu.dir).toBe("ltr");
    expect(urdu.fallback).toBe(true);
    expect(urdu.fallback_notice).toMatch(/draft/);
    for (const code of ["ur", "hi", "tl"]) {
      expect(urdu.languages.find((l: { code: string }) => l.code === code).label).toBe(
        "draft, not reviewed by a native speaker",
      );
    }
  });
});
