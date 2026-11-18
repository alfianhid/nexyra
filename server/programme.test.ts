import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.js";
import type { WriteActor } from "./events.js";
import type { ProgrammeSummary } from "./programme.js";

// TICKET-16 done-when, one named test per box the server can prove. The fixture is a
// handful of cases written through the engine (createCase / applyEvent / logOutreach /
// tick), never straight into `events`, so the funnel is checked against a timeline the
// engine itself produced.

let dir = "";
let db: Db;
let server: Server | undefined;
let base = "";
let summary: ProgrammeSummary;

const SYSTEM: WriteActor = { actor_id: "act_system", role: "system", display_name: "system" };
const COORDINATOR: WriteActor = { actor_id: "act_001", role: "coordination_staff", display_name: "R. Haddad" };
const PHYSICIAN: WriteActor = { actor_id: "act_003", role: "responsible_physician", display_name: "Dr. Fulan" };

const DEMO_START = "2026-11-17T11:42:00+07:00";

// Fixture day d is d - 40 days from the demo start, so "now" (day 40) is day 0 of the
// demo clock and every escalation the final tick writes lands on demo day 0.
function dayAt(d: number): string {
  const at = new Date(Date.parse(DEMO_START) + (d - 40) * 86_400_000);
  const shifted = new Date(at.getTime() + 7 * 3_600_000);
  return `${shifted.toISOString().slice(0, 19)}+07:00`;
}

const header = (id: string, role: string, name: string) => ({
  "X-Nexyra-Actor": JSON.stringify({ actor_id: id, role, display_name: name }),
});
const MANAGER_HEADER = header("act_004", "program_manager", "A. Al Suwaidi");
const COORDINATOR_HEADER = header("act_001", "coordination_staff", "R. Haddad");

async function at(d: number): Promise<void> {
  const { setClock } = await import("./clock.js");
  await setClock(db, dayAt(d), 0);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-programme-"));
  process.env.DATABASE_FILE = join(dir, "programme.sqlite");
  const { getDb } = await import("./db.js");
  const events = await import("./events.js");
  const { tick } = await import("./escalation.js");
  const { programmeSummary } = await import("./programme.js");
  const { app } = await import("./index.js");
  db = await getDb();

  // Actors only; the cases are this file's fixture, not the demo seed.
  for (const [id, role, name] of [
    ["act_001", "coordination_staff", "R. Haddad"],
    ["act_002", "navigator", "Nur H."],
    ["act_003", "responsible_physician", "Dr. Fulan"],
    ["act_004", "program_manager", "A. Al Suwaidi"],
    ["act_system", "system", "system"],
  ] as const) {
    await db.prepare("INSERT INTO actors (id, role, display_name) VALUES (?, ?, ?)").run(id, role, name);
  }

  const patient = { name: "Synthetic patient", age: 55, language: "en" };
  const create = async (caseId: string, d: number) => {
    await at(d);
    await events.createCase(db, { caseId, patient, actor: SYSTEM });
  };
  const move = async (caseId: string, d: number, type: string, actor: WriteActor = COORDINATOR, payload?: Record<string, unknown>) => {
    await at(d);
    await events.applyEvent(db, { caseId, type, actor, ...(payload ? { payload } : {}) });
  };
  const document = (caseId: string) =>
    db
      .prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES (?, ?, 'colonoscopy', 'Report', ?)")
      .run(`d_${caseId}`, caseId, `Report for ${caseId}`);

  // F-1: the whole pathway, closed on day 37 (inside the last seven days).
  await create("F-1", 20);
  await move("F-1", 21, "patient_notified");
  await move("F-1", 22, "referral_sent");
  await move("F-1", 23, "referral_accepted", SYSTEM);
  await move("F-1", 24, "colonoscopy_booked");
  await move("F-1", 32, "colonoscopy_performed");
  await move("F-1", 32, "pathology_ordered");
  await move("F-1", 35, "pathology_received", SYSTEM);
  await move("F-1", 36, "closure_proposed", COORDINATOR, { outcome: "returned_to_routine_screening" });
  await document("F-1");
  await at(37);
  await events.confirmCaseClosure(db, { caseId: "F-1", actor: PHYSICIAN });

  // F-2: referred on day 3 and still waiting on day 40, so past the 31-day limit.
  await create("F-2", 0);
  await move("F-2", 2, "patient_notified");
  await move("F-2", 3, "referral_sent");
  await at(4);
  await events.logOutreach(db, { caseId: "F-2", actor: COORDINATOR, outcome: "No answer", delayReason: "fear" });

  // F-3: referral rejected on day 5, which clears the owner (TICKET-08 trigger 1).
  await create("F-3", 1);
  await move("F-3", 2, "patient_notified");
  await move("F-3", 3, "referral_sent");
  await move("F-3", 5, "referral_rejected", SYSTEM);
  await at(6);
  await events.logOutreach(db, { caseId: "F-3", actor: COORDINATOR, outcome: "Spoke to patient", delayReason: "fear" });

  // F-4: closure proposed, but the latest reading proposes reopening.
  await create("F-4", 0);
  await move("F-4", 1, "patient_notified");
  await move("F-4", 2, "referral_sent");
  await move("F-4", 3, "referral_accepted", SYSTEM);
  await move("F-4", 4, "colonoscopy_booked");
  await move("F-4", 10, "colonoscopy_performed");
  await move("F-4", 10, "pathology_ordered");
  await move("F-4", 12, "pathology_received", SYSTEM);
  await move("F-4", 13, "closure_proposed", COORDINATOR, { outcome: "returned_to_routine_screening" });
  await document("F-4");
  await db
    .prepare(
      `INSERT INTO extractions (id, case_id, document_id, prompt_version, model, proposal, proposal_reason, fields, text_hash, created_at)
       VALUES ('x_f4', 'F-4', 'd_F-4', 'v1', 'test-model', 'reopen', 'Incomplete exam', '[]', 'hash-f4', ?)`,
    )
    .run(dayAt(14));

  // F-5: a fresh result.
  await create("F-5", 38);
  await at(39);
  await events.logOutreach(db, { caseId: "F-5", actor: COORDINATOR, outcome: "Letter sent", channel: "letter", delayReason: "transport" });

  await at(40);
  await tick(db);

  summary = await programmeSummary(db, "program_manager");

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server?.address();
  if (typeof address === "object" && address !== null) base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closeDb } = await import("./db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

// The events that put a case into each stage, written out by hand from the template
// table in docs/api.md so the check does not reuse the code under test.
const ENTERED_BY: Record<string, string> = {
  result_received: "type IN ('case_created', 'reopened')",
  patient_notified: "type IN ('patient_notified', 'referral_rejected')",
  referral_sent: "type IN ('referral_sent', 'procedure_incomplete')",
  referral_accepted: "type = 'referral_accepted'",
  colonoscopy_booked: "type = 'colonoscopy_booked'",
  procedure_completed: "type = 'colonoscopy_performed'",
  pathology_ordered: "type = 'pathology_ordered'",
  pathology_received: "type = 'pathology_received'",
  closure_proposed: "type = 'closure_proposed'",
  closure_confirmed: "type = 'closure_confirmed'",
  closed:
    "(type = 'case_closed' OR (type = 'closure_confirmed' AND json_extract(payload, '$.finalises') = 1))",
};

async function firstAt(caseId: string, where: string): Promise<string | undefined> {
  const row = await db
    .prepare(`SELECT occurred_at FROM events WHERE case_id = ? AND ${where} ORDER BY rowid LIMIT 1`)
    .get<{ occurred_at: string }>(caseId);
  return row?.occurred_at;
}

describe("TICKET-16 done-when", () => {
  it("funnel numbers match direct counts from the events table", async () => {
    for (const row of summary.funnel) {
      const where = ENTERED_BY[row.key];
      expect(where, `no direct count written for ${row.key}`).toBeDefined();
      const direct = await db
        .prepare(`SELECT count(DISTINCT case_id) AS n FROM events WHERE ${where}`)
        .get<{ n: number }>();
      expect(row.reached, row.key).toBe(Number(direct?.n ?? 0));
    }

    // Open per stage against the cached case rows the engine keeps equal to the replay.
    const open = await db
      .prepare("SELECT stage, count(*) AS n FROM cases WHERE status != 'closed' GROUP BY stage")
      .all<{ stage: string; n: number }>();
    for (const row of summary.funnel) {
      const direct = open.find((o) => o.stage === row.key)?.n ?? 0;
      expect(row.open, row.key).toBe(Number(direct));
    }
    expect(summary.funnel.reduce((sum, row) => sum + row.open, 0)).toBe(summary.counts.open);
    expect(summary.funnel.find((r) => r.key === "closed")?.reached).toBe(1);
  });

  it("funnel medians match the gaps between first events in the timeline", async () => {
    const gap = async (caseId: string, from: string, to: string) => {
      const a = await firstAt(caseId, ENTERED_BY[from]!);
      const b = await firstAt(caseId, ENTERED_BY[to]!);
      return (Date.parse(b!) - Date.parse(a!)) / 86_400_000;
    };
    const notified = await Promise.all(["F-1", "F-2", "F-3", "F-4"].map((id) => gap(id, "result_received", "patient_notified")));
    const sortedNotified = notified.sort((a, b) => a - b);
    const expectedNotified = (sortedNotified[1]! + sortedNotified[2]!) / 2;
    expect(summary.funnel.find((r) => r.key === "patient_notified")?.median_days_from_previous).toBe(expectedNotified);

    const done = await Promise.all(["F-1", "F-4"].map((id) => gap(id, "colonoscopy_booked", "procedure_completed")));
    expect(summary.funnel.find((r) => r.key === "procedure_completed")?.median_days_from_previous).toBe(
      (done[0]! + done[1]!) / 2,
    );
    expect(summary.funnel[0]?.median_days_from_previous).toBeNull();
  });

  it("every exception row carries its case id", async () => {
    const ids = new Set((await db.prepare("SELECT id FROM cases").all<{ id: string }>()).map((r) => r.id));
    expect(summary.exceptions.length).toBeGreaterThan(0);
    for (const row of summary.exceptions) {
      expect(typeof row.case_id).toBe("string");
      expect(ids.has(row.case_id), row.case_id).toBe(true);
      expect(row.reason.length).toBeGreaterThan(0);
    }
    const kinds = (kind: string) => summary.exceptions.filter((e) => e.kind === kind).map((e) => e.case_id);
    // F-2's referral has waited since day 3 with no answer, so TICKET-08's
    // "referral not answered by the acceptance deadline" trigger makes it unowned too.
    expect(kinds("unowned").sort()).toEqual(["F-2", "F-3"]);
    expect(kinds("past_referral_limit").sort()).toEqual(["F-2", "F-3"]);
    expect(kinds("closure_held")).toEqual(["F-4"]);
    // Unowned since the rejection on day 5: 35 days at day 40.
    expect(
      summary.exceptions.find((e) => e.kind === "unowned" && e.case_id === "F-3")?.reason,
    ).toBe("Unowned 35 days");
    expect(summary.counts.unowned).toBe(2);
    expect(summary.counts.closures_held).toBe(1);
  });

  it("the synthetic-data label is in the payload", () => {
    expect(summary.synthetic_data_label).toBe(
      "Synthetic data. Drop-off rates are input assumptions, not results.",
    );
  });

  it("missing unstitched table gives an empty list, not an error", async () => {
    const { programmeSummary } = await import("./programme.js");
    // TICKET-08 creates the table; hiding it keeps proving the fallback for an older
    // database without it, and renaming back leaves the schema intact for later tests.
    await db.exec("ALTER TABLE unstitched RENAME TO unstitched_hidden");
    try {
      const result = await programmeSummary(db, "program_manager");
      expect(result.unstitched).toEqual({ available: false, count: 0, rows: [] });
    } finally {
      await db.exec("ALTER TABLE unstitched_hidden RENAME TO unstitched");
    }
  });

  it("queued unstitched resources light the section up; stitched ones do not", async () => {
    const { programmeSummary } = await import("./programme.js");
    const insert = db.prepare(
      `INSERT INTO unstitched
         (id, resource_type, resource_id, reason_code, reason, resource, received_at, recorded_at,
          status, stitched_case_id)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`,
    );
    await insert.run("u_1", "DiagnosticReport", "dr-77", "no_match", "No identifier match", dayAt(39), dayAt(39), "queued", null);
    await insert.run("u_2", "Procedure", "proc-9", "no_match", "x", dayAt(39), dayAt(39), "stitched", "F-1");
    try {
      const result = await programmeSummary(db, "program_manager");
      expect(result.unstitched.available).toBe(true);
      expect(result.unstitched.rows.map((r) => r.id)).toEqual(["u_1"]);
      expect(result.unstitched.rows[0]?.reason).toBe("No identifier match");
      expect(result.unstitched.rows[0]?.summary).toBe("DiagnosticReport dr-77");
    } finally {
      await db.exec("DELETE FROM unstitched WHERE id IN ('u_1', 'u_2')");
    }
  });
});

describe("program summary sections", () => {
  it("counts delay reasons recorded by staff", () => {
    const count = (key: string) => summary.delay_reasons.find((r) => r.delay_reason === key)?.count;
    expect(count("fear")).toBe(2);
    expect(count("transport")).toBe(1);
    expect(count("cost")).toBe(0);
  });

  it("counts escalations per role per demo day from deadline_missed events", async () => {
    const rows = await db
      .prepare(
        `SELECT json_extract(payload, '$.escalated_to') AS role, count(*) AS n
           FROM events WHERE type = 'deadline_missed' GROUP BY role`,
      )
      .all<{ role: string; n: number }>();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(summary.escalations_per_role_per_day.find((r) => r.role === row.role)?.total).toBe(Number(row.n));
      const day0 = summary.escalations_by_day.find((d) => d.day === 0);
      expect(day0?.per_role.find((r) => r.role === row.role)?.count).toBe(Number(row.n));
    }
  });

  it("measures referral to colonoscopy against the 31-day limit", () => {
    const r = summary.referral_to_colonoscopy!;
    expect(r.limit_days).toBe(31);
    expect(r.completed).toBe(2); // F-1 (10 days) and F-4 (8 days)
    expect(r.completed_over_limit).toBe(0);
    expect(r.median_days_completed).toBe(9);
    expect(r.waiting_over_limit).toBe(2); // F-2 and F-3, 37 days
    expect(r.buckets.find((b) => b.label === "8–14 days")?.completed).toBe(2);
    expect(r.buckets.find((b) => b.label === "32–45 days")?.waiting).toBe(2);
  });

  it("counts closures in the last seven demo days", () => {
    expect(summary.counts.closed_this_week).toBe(1);
    expect(summary.counts.total).toBe(5);
  });

  it("labels the scenario as an assumption and cites its source", () => {
    expect(summary.scenario.title).toBe("Scenario based on assumptions");
    expect(summary.scenario.source).toContain("Atlas et al., JAMA 2023");
    expect(summary.scenario.additional_completed).toBe(Math.round(5 * (0.31 - 0.229)));
  });
});

describe("GET /api/program/summary", () => {
  it("answers the program manager", async () => {
    const response = await fetch(`${base}/api/program/summary?role=program_manager`, { headers: MANAGER_HEADER });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ProgrammeSummary;
    expect(body.synthetic_data_label).toBe(summary.synthetic_data_label);
    expect(body.funnel.length).toBeGreaterThan(0);
  });

  it("refuses coordination staff", async () => {
    const response = await fetch(`${base}/api/program/summary?role=coordination_staff`, { headers: COORDINATOR_HEADER });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("role_not_permitted");
  });

  it("refuses a header that names an unknown actor", async () => {
    const response = await fetch(`${base}/api/program/summary`, {
      headers: header("act_999", "program_manager", "Nobody"),
    });
    expect(response.status).toBe(403);
  });

  it("requires a role", async () => {
    const response = await fetch(`${base}/api/program/summary`);
    expect(response.status).toBe(400);
  });
});
