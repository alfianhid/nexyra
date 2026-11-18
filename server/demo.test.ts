import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_STEPS, httpSend, runStep, type Memo, type Send } from "../scripts/demo/steps.js";
import type { Db } from "./db.js";

// TICKET-17 done-when: automated tests run all three scenarios through the API and check
// the final state. This walks the demo exactly as docs/demo-script.md does, in stage
// order (case 3, case 2, case 1, programme view), on the state `npm run demo:reset`
// produces (cohort included), with no model key and no network beyond this server.
// Nothing here writes to the database directly.

let server: Server | undefined;
let base = "";
let dir = "";
let db: Db;
let send: Send;
const memo: Memo = {};
const outbound: string[] = [];
const realFetch = globalThis.fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-demo-"));
  process.env.DATABASE_FILE = join(dir, "demo.sqlite");
  // The demo must not depend on a model or the network (TICKET-17, TICKET-21).
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("http://127.0.0.1:")) {
      outbound.push(url);
      throw new Error(`The demo tried to reach the network: ${url}`);
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const { getDb } = await import("./db.js");
  const { resetDemo } = await import("./reset.js");
  const { app } = await import("./index.js");
  db = await getDb();
  await resetDemo(db);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  // The video path resets for ~5 s between requests; Node's 5 s keep-alive would close the
  // pooled socket just as fetch reuses it.
  if (server) server.keepAliveTimeout = 60_000;
  const address = server?.address();
  if (typeof address === "object" && address !== null) base = `http://127.0.0.1:${address.port}`;
  send = httpSend(base);
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closeDb } = await import("./db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function step(id: string): Promise<Json> {
  const definition = DEMO_STEPS.find((s) => s.id === id);
  if (!definition) throw new Error(`no step ${id}`);
  const result = await runStep(definition, memo, send);
  expect(result.status, `step ${id}: ${JSON.stringify(result.body)}`).toBe(200);
  return result.body;
}

async function get(path: string, role = "program_manager"): Promise<Json> {
  const result = await send("GET", `${path}${path.includes("?") ? "&" : "?"}role=${role}`, undefined, undefined);
  expect(result.status, `${path}: ${JSON.stringify(result.body)}`).toBe(200);
  return result.body;
}

const types = (detail: Json): string[] => detail.timeline.map((e: { type: string }) => e.type);

describe("TICKET-17: the demo, start to finish, through the API", () => {
  it("starts where the script says: day 0, three demo cases in the worklist, the cohort behind them", async () => {
    const clock = await get("/api/clock");
    expect(clock).toMatchObject({ now: "2026-11-17T11:42:00+07:00", day: 0 });

    const worklist = await get("/api/cases");
    // The programme manager's register also shows the three TICKET-18 mammography cases,
    // the second-pathway proof; none of them escalates during the scripted demo.
    expect(worklist.cases.map((c: { case_id: string }) => c.case_id).sort()).toEqual([
      "CX-1001",
      "CX-1002",
      "CX-1003",
      "MM-2001",
      "MM-2002",
      "MM-2003",
    ]);
    expect(worklist.cohort).toEqual({ included: false, cases: 1000 });

    const everything = await get("/api/cases?cohort=include");
    expect(everything.cases).toHaveLength(1006);
    expect(everything.cohort.included).toBe(true);
  });

  it("case 3: verification proposes reopen, the physician reopens, the repeat colonoscopy closes it properly", async () => {
    const verification = await step("3.1");
    expect(verification.extraction.proposal).toBe("reopen");
    expect(verification.extraction.fields.filter((f: { validated: boolean }) => f.validated)).toHaveLength(2);
    const reread = await step("3.2");
    expect(reread.extraction.origin).toBe("cache");
    expect(reread.extraction.proposal).toBe("reopen");

    const reopened = await step("3.3");
    expect(reopened.case).toMatchObject({ stage: "referral_sent", status: "open", final_outcome: null });
    expect(reopened.case.owner.actor_id).toBe("act_003"); // never unowned
    expect(reopened.available_actions).not.toContain("confirm_closure");

    const handed = await step("3.4");
    expect(handed.case.owner).toMatchObject({ actor_id: "act_005", display_name: "S. Al Ali" });
    expect((await step("3.5")).case.stage).toBe("referral_accepted");

    const booked = await step("3.6");
    expect(booked.results[0]).toMatchObject({ outcome: "stitched", case_id: "CX-1003", stage: "colonoscopy_booked" });
    const performed = await step("3.7");
    expect(performed.counts.stitched).toBe(2);
    expect((await get("/api/cases/CX-1003")).case.stage).toBe("procedure_completed");

    expect((await step("3.8")).case.stage).toBe("pathology_ordered");
    const pathology = await step("3.9");
    expect(pathology.results[0]).toMatchObject({ outcome: "stitched", stage: "pathology_received" });

    const proposed = await step("3.10");
    expect(proposed.case).toMatchObject({ stage: "closure_proposed", final_outcome: "surveillance_scheduled" });
    expect(proposed.available_actions).not.toContain("confirm_closure"); // coordinator view

    const closed = await step("3.11");
    expect(closed.case).toMatchObject({ stage: "closed", status: "closed", final_outcome: "surveillance_scheduled" });
    expect(closed.documents.map((d: { kind: string }) => d.kind).sort()).toEqual(["colonoscopy", "colonoscopy", "pathology"]);
    const confirmation = closed.timeline.find((e: { type: string }) => e.type === "closure_confirmed");
    expect(confirmation.actor).toMatchObject({ actor_id: "act_003", role: "responsible_physician" });
    expect(types(closed)).toEqual(
      expect.arrayContaining(["procedure_incomplete", "fhir_resource_stitched", "pathology_received", "closure_proposed"]),
    );
    // Closed exactly once, and only after the reopen.
    const order = types(closed);
    expect(order.indexOf("procedure_incomplete")).toBeLessThan(order.indexOf("closure_confirmed"));
    expect(order.filter((t) => t === "closure_confirmed")).toHaveLength(1);
  });

  it("case 2: unowned after the rejection, patient moved, consultation, accepted with a new owner, booking stitched", async () => {
    const unowned = await step("2.1");
    expect(unowned.cases.map((c: { case_id: string }) => c.case_id)).toEqual(["CX-1002"]);
    expect(unowned.cases[0].trigger.type).toBe("referral_rejected");
    expect(unowned.cases[0].assign_owner_task.owner.actor_id).toBe("act_001");

    const moved = await step("2.2");
    expect(moved.case.owner).toBeNull();
    expect(moved.provider).toMatchObject({ provider_id: "prov_clinic_b" });
    const assign = moved.tasks.find((t: { kind: string; status: string }) => t.kind === "assign_owner" && t.status === "open");
    expect(assign.owner.actor_id).toBe("act_005");

    const asked = await step("2.3");
    expect(memo.consultation_id).toBe(asked.consultation_id);
    expect(asked.consultations[0]).toMatchObject({ status: "open", to_actor_id: "act_006", due_at: "2026-11-19T11:42:00+07:00" });

    const day1 = await step("2.4");
    expect(day1.clock.day).toBe(1);
    // Case 3 is closed and the cohort is never ticked: no stage escalation today. The
    // silent patient's staff call is an outreach step, reported apart.
    expect(day1.escalations).toBe(0);
    expect(day1.unowned_triggered).toBe(0);
    expect(day1.outreach).toMatchObject({ messages_sent: 0, staff_calls: 1, navigator_escalations: 0 });
    expect(day1.outreach.per_case).toEqual([{ case_id: "CX-1001", step: "staff_call", reason: "no_response" }]);

    const accepted = await step("2.5");
    expect(accepted.case).toMatchObject({ stage: "referral_accepted" });
    expect(accepted.case.owner).toMatchObject({ actor_id: "act_005" });
    expect(accepted.consultations[0]).toMatchObject({ status: "answered", outcome: "accepted", hours_to_answer: 24 });
    expect(accepted.ownership.state).toBe("owned");
    expect(accepted.ownership.gaps.at(-1)).toMatchObject({ hours_to_owner: 44 });

    const booked = await step("2.6");
    expect(booked.results[0]).toMatchObject({ outcome: "stitched", case_id: "CX-1002", stage: "colonoscopy_booked" });

    expect((await get("/api/unowned")).count).toBe(0);
    const detail = await get("/api/cases/CX-1002");
    expect(detail.case).toMatchObject({ stage: "colonoscopy_booked", status: "open" });
    expect(detail.case.owner.actor_id).toBe("act_005");
  });

  it("case 1: message unanswered, staff call, navigator records fear, the patient confirms, the case moves on", async () => {
    const ladder = await step("1.1");
    expect(ladder.status).toBe("staff_call");
    const call = ladder.ladder.find((s: { key: string }) => s.key === "staff_call");
    expect(call.state).toBe("done");
    expect(call.task).toMatchObject({ kind: "outreach_call", status: "open" });
    expect(ladder.message.dir).toBe("rtl");

    const called = await step("1.2");
    expect(called.case.stage).toBe("result_received");

    const day2 = await step("1.3");
    expect(day2.clock.day).toBe(2);
    expect(day2.outreach.navigator_escalations).toBe(0);

    const day3 = await step("1.4");
    expect(day3.clock.day).toBe(3);
    expect(day3.outreach.navigator_escalations).toBe(1);
    expect(day3.escalations).toBe(0);
    const navigatorTask = (await get("/api/cases/CX-1001")).tasks.find(
      (t: { kind: string }) => t.kind === "outreach_navigator",
    );
    expect(navigatorTask).toMatchObject({ status: "open" });
    expect(navigatorTask.owner).toMatchObject({ actor_id: "act_002", role: "navigator" });

    const barrier = await step("1.5");
    const recorded = barrier.timeline.find((e: { event_id: string }) => e.event_id === barrier.recorded);
    expect(recorded.payload).toMatchObject({ delay_reason: "fear", connected: true });

    const page = await step("1.6");
    expect(JSON.stringify(page)).toContain("rtl");
    await step("1.7");
    expect((await get("/api/cases/CX-1001/outreach")).status).toBe("acknowledged");

    const detail = await get("/api/cases/CX-1001");
    expect(detail.case).toMatchObject({ stage: "patient_notified", status: "open" });
    expect(detail.case.owner.actor_id).toBe("act_005");
    expect(types(detail)).toEqual(
      expect.arrayContaining([
        "outreach_message_sent",
        "outreach_staff_call_due",
        "outreach_navigator_assigned",
        "outreach_attempted",
        "task_completed",
        "patient_acknowledged",
        "patient_notified",
      ]),
    );
    // Both calls closed their own ladder tasks, so the stop has nothing left to cancel.
    expect(detail.tasks.filter((t: { kind: string; status: string }) => t.kind.startsWith("outreach") && t.status === "open")).toEqual([]);
  });

  it("programme view: one jump to the next deadline escalates CX-1001; the view counts cohort and demo cases", async () => {
    const jump = await step("P.0");
    // CX-1001 has been at Patient notified since day 3 with no referral (72 h deadline).
    expect(jump.clock).toMatchObject({ now: "2026-11-23T11:42:00+07:00", day: 6 });
    expect(jump.escalations).toBe(1);
    expect(jump.escalations_per_role).toEqual([{ role: "responsible_physician", count: 1 }]);
    const escalated = await get("/api/cases/CX-1001");
    expect(escalated.timeline.at(-1)).toMatchObject({ type: "deadline_missed", payload: { level: 1, stage: "patient_notified" } });

    const summary = await step("P.1");
    expect(summary.counts.total).toBe(1003);
    expect(summary.synthetic_data_label).toBeTruthy();
    expect(summary.clock.day).toBe(6);
    const physician = summary.escalations_per_role_per_day.find((r: { role: string }) => r.role === "responsible_physician");
    expect(physician.total).toBe(1);

    const escalatedCohort = await db
      .prepare(
        `SELECT count(*) AS n FROM events
          WHERE case_id LIKE 'SY-%' AND type IN ('deadline_missed', 'referral_unanswered', 'outreach_message_sent')`,
      )
      .get<{ n: number }>();
    expect(escalatedCohort?.n).toBe(0);
    expect(outbound).toEqual([]);
  });
});

// TICKET-21's video skips case 1: case 3, case 2, then one jump to the next deadline and
// the programme view (docs/video-script.md). The figures the narration reads are these.
describe("TICKET-21: the video's path", () => {
  it("after case 3's reopen and case 2, the next deadline escalates the repeat referral and reaches the navigator", async () => {
    const { resetDemo } = await import("./reset.js");
    await resetDemo(db);
    for (const key of Object.keys(memo)) delete memo[key];

    for (const id of ["3.1", "3.3"]) await step(id);
    for (const id of ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6"]) await step(id);

    // On camera case 3 stops at the reopen, so its repeat referral (back at Referral sent on
    // day 0, 72 h to be accepted) is the next deadline: it escalates and goes unowned, and
    // the silent patient's ladder reaches the navigator at the same tick.
    const jump = await step("P.0");
    expect(jump.clock).toMatchObject({ now: "2026-11-20T11:42:00+07:00", day: 3, label: "20 Nov 2026 · 11:42" });
    expect(jump.escalations).toBe(1);
    expect(jump.escalations_per_role).toEqual([{ role: "responsible_physician", count: 1 }]);
    expect(jump.unowned_triggered).toBe(1);
    expect(jump.outreach).toMatchObject({ staff_calls: 0, navigator_escalations: 1 });
    expect(jump.outreach.per_case).toEqual([{ case_id: "CX-1001", step: "navigator", reason: "no_movement" }]);

    const unowned = await get("/api/unowned");
    expect(unowned.cases.map((c: { case_id: string }) => c.case_id)).toEqual(["CX-1003"]);
    expect(unowned.cases[0].trigger.type).toBe("referral_unanswered");

    const summary = await step("P.1");
    expect(summary.counts.total).toBe(1003);
    expect(outbound).toEqual([]);
  }, 120_000);
});
