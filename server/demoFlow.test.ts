import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.js";

// The fixes the demo walk needed (18 Nov): reopening at the closure review, reading the
// latest report, the patient move permission, the actor list, server-formatted labels,
// consultation answers by the addressee only, register counts, the move's task deadline,
// pathway labels, the generic "Record next step" list and the proposal rejection. HTTP
// calls on the seeded state, except for creating extra cases and documents, which have no
// endpoint.

let server: Server | undefined;
let base = "";
let dir = "";
let db: Db;
let events: typeof import("./events.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-flow-"));
  process.env.DATABASE_FILE = join(dir, "flow.sqlite");
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  const { getDb } = await import("./db.js");
  const { seed } = await import("./seed.js");
  const { app } = await import("./index.js");
  events = await import("./events.js");
  db = await getDb();
  await seed(db);
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

const header = (actor_id: string, role: string) => ({
  "X-Nexyra-Actor": JSON.stringify({ actor_id, role, display_name: actor_id }),
});
const COORDINATOR_A = header("act_001", "coordination_staff");
const COORDINATOR_B = header("act_005", "coordination_staff");
const PHYSICIAN = header("act_003", "responsible_physician");
const RECEIVING_PHYSICIAN = header("act_006", "responsible_physician");
const LABEL = /^\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/;

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
  return { status: response.status, body: (await response.json()) as any };
}

async function ok(method: "GET" | "POST", path: string, options: { headers?: Record<string, string>; body?: unknown } = {}) {
  const result = await call(method, path, options);
  expect(result.status, `${path}: ${JSON.stringify(result.body)}`).toBe(200);
  return result.body;
}

async function newCase(caseId: string, documents: { kind: string; text: string }[] = []) {
  await events.createCase(db, {
    caseId,
    patient: { name: `Patient ${caseId}`, age: 60, language: "en" },
    actor: events.SYSTEM_ACTOR,
    ownerActorId: "act_003",
    providerId: "prov_clinic_b",
  });
  for (const [i, d] of documents.entries()) {
    await db
      .prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES (?, ?, ?, ?, ?)")
      .run(`d_${caseId}_${i}`, caseId, d.kind, `${d.kind} report ${i}`, d.text);
  }
}

describe("TICKET-15: rejecting the AI proposal", () => {
  it("is the physician's, needs a reason, records an event and never moves the case", async () => {
    const coordinator = await call("POST", "/api/cases/CX-1003/proposal/reject", {
      headers: COORDINATOR_B,
      body: { reason: "Not convinced by the report" },
    });
    expect(coordinator.status).toBe(403);

    const short = await call("POST", "/api/cases/CX-1003/proposal/reject", { headers: PHYSICIAN, body: { reason: "no" } });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe("validation_failed");

    const notWaiting = await call("POST", "/api/cases/CX-1001/proposal/reject", {
      headers: PHYSICIAN,
      body: { reason: "Nothing to reject here" },
    });
    expect(notWaiting.status).toBe(409);

    const before = await ok("GET", "/api/cases/CX-1003?role=responsible_physician");
    const rejected = await ok("POST", "/api/cases/CX-1003/proposal/reject", {
      headers: PHYSICIAN,
      body: { reason: "The report describes a second lesion the reading missed" },
    });
    expect(rejected.case).toMatchObject({ stage: before.case.stage, status: "open", final_outcome: before.case.final_outcome });
    const recorded = rejected.timeline.find((e: { event_id: string }) => e.event_id === rejected.recorded);
    expect(recorded).toMatchObject({
      type: "proposal_rejected",
      actor: { actor_id: "act_003", role: "responsible_physician" },
      payload: { proposal: "reopen", extraction_id: "x_1003", reason: "The report describes a second lesion the reading missed" },
    });

    const summary = await ok("GET", "/api/program/summary?role=program_manager");
    expect(summary.ai_divergence).toEqual({ count: 1, proposals_rejected: 1, closed_against_reading: 0 });
  });
});

describe("Reopen at the closure review", () => {
  it("is refused where no role can send the case back", async () => {
    const result = await call("POST", "/api/cases/CX-1001/reopen", { headers: PHYSICIAN, body: {} });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("invalid_transition");
  });

  it("offers reopen_case to the physician after the procedure, and records the template's event", async () => {
    await newCase("CX-F-REOPEN");
    for (const type of ["patient_notified", "referral_sent"]) {
      await ok("POST", "/api/cases/CX-F-REOPEN/events", { headers: COORDINATOR_B, body: { type } });
    }
    await ok("POST", "/api/cases/CX-F-REOPEN/events", { headers: COORDINATOR_B, body: { type: "referral_accepted" } });
    await ok("POST", "/api/cases/CX-F-REOPEN/events", { headers: COORDINATOR_B, body: { type: "colonoscopy_booked" } });
    const before = await ok("GET", "/api/cases/CX-F-REOPEN?role=responsible_physician");
    expect(before.available_actions).not.toContain("reopen_case");
    const done = await ok("POST", "/api/cases/CX-F-REOPEN/events", { headers: COORDINATOR_B, body: { type: "colonoscopy_performed" } });
    expect(done.case.stage).toBe("procedure_completed");
    const physicianView = await ok("GET", "/api/cases/CX-F-REOPEN?role=responsible_physician");
    expect(physicianView.available_actions).toContain("reopen_case");

    const reopened = await ok("POST", "/api/cases/CX-F-REOPEN/reopen", { headers: PHYSICIAN, body: {} });
    expect(reopened.case).toMatchObject({ stage: "referral_sent", status: "open" });
    expect(reopened.case.owner.actor_id).toBe("act_003");
    expect(reopened.timeline.at(-1).type).toBe("procedure_incomplete");
  });
});

describe("Verification reads the latest report and attaches cached readings per document", () => {
  it("attaches a cached reading to a new document with the same text, once", async () => {
    const seeded = await db.prepare("SELECT text FROM documents WHERE id = 'd_1003'").get<{ text: string }>();
    await newCase("CX-F-SAME", [{ kind: "colonoscopy", text: seeded?.text ?? "" }]);

    const first = await ok("POST", "/api/cases/CX-F-SAME/verification", { headers: PHYSICIAN, body: {} });
    expect(first.extraction).toMatchObject({ origin: "cache", proposal: "reopen" });
    expect(first.report.document_id).toBe("d_CX-F-SAME_0");
    const second = await ok("POST", "/api/cases/CX-F-SAME/verification", { headers: PHYSICIAN, body: {} });
    expect(second.extraction.origin).toBe("cache");

    const rows = await db
      .prepare("SELECT document_id FROM extractions WHERE case_id = 'CX-F-SAME'")
      .all<{ document_id: string }>();
    expect(rows).toEqual([{ document_id: "d_CX-F-SAME_0" }]);
    const readings = await db
      .prepare("SELECT count(*) AS n FROM events WHERE case_id = 'CX-F-SAME' AND type = 'extraction_completed'")
      .get<{ n: number }>();
    expect(readings?.n).toBe(1);

    const detail = await ok("GET", "/api/cases/CX-F-SAME?role=responsible_physician");
    expect(detail.verification).toMatchObject({ status: "ready", proposal: "reopen" });
    const stored = await ok("GET", "/api/cases/CX-F-SAME/verification");
    expect(stored.extraction.fields.every((f: { read_label: string }) => LABEL.test(f.read_label))).toBe(true);
  });

  it("reads a colonoscopy report and the pathology after it as one report, and never shows an older reading", async () => {
    const seeded = await db.prepare("SELECT text FROM documents WHERE id = 'd_1003'").get<{ text: string }>();
    await newCase("CX-F-LATEST", [{ kind: "colonoscopy", text: seeded?.text ?? "" }]);
    await ok("POST", "/api/cases/CX-F-LATEST/verification", { headers: PHYSICIAN, body: {} });
    await db
      .prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES (?, ?, ?, ?, ?)")
      .run("d_CX-F-LATEST_c2", "CX-F-LATEST", "colonoscopy", "Repeat", "Complete colonoscopy to the caecum.");
    await db
      .prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES (?, ?, ?, ?, ?)")
      .run("d_CX-F-LATEST_p", "CX-F-LATEST", "pathology", "Pathology", "Tubular adenoma.");

    const view = await ok("GET", "/api/cases/CX-F-LATEST/verification");
    expect(view.extraction).toMatchObject({ origin: "not_read", fields: [] });
    expect(view.report).toMatchObject({
      document_id: "d_CX-F-LATEST_p",
      document_ids: ["d_CX-F-LATEST_c2", "d_CX-F-LATEST_p"],
      text: "COLONOSCOPY REPORT\nComplete colonoscopy to the caecum.\n\nPATHOLOGY REPORT\nTubular adenoma.",
    });
    const detail = await ok("GET", "/api/cases/CX-F-LATEST?role=responsible_physician");
    expect(detail.verification).toMatchObject({ status: "pending" });
  });
});

describe("Case view: actions, labels, pathway, next steps", () => {
  it("sends record_provider_move to the roles the template gives the move", async () => {
    const coordinator = await ok("GET", "/api/cases/CX-1002?role=coordination_staff");
    expect(coordinator.available_actions).toContain("record_provider_move");
    const physician = await ok("GET", "/api/cases/CX-1002?role=responsible_physician");
    expect(physician.available_actions).not.toContain("record_provider_move");
    const manager = await ok("GET", "/api/cases/CX-1002?role=program_manager");
    expect(manager.available_actions).toEqual([]);
  });

  it("labels every timestamp the screens print, in the deadline format", async () => {
    const detail = await ok("GET", "/api/cases/CX-1002?role=coordination_staff");
    expect(detail.ownership).toMatchObject({ unowned_label: "Unowned 20h", unowned_since_label: "16 Nov 15:40" });
    for (const e of detail.timeline) expect(e.occurred_label).toMatch(LABEL);
    for (const t of detail.tasks) expect(t.due_label).toMatch(LABEL);
    for (const r of detail.referrals) expect(r.sent_label).toMatch(LABEL);
    for (const g of detail.ownership.gaps) expect(g.unowned_at_label).toMatch(LABEL);
    const owned = await ok("GET", "/api/cases/CX-1001?role=coordination_staff");
    expect(owned.ownership.unowned_label).toBeNull();

    const unowned = await ok("GET", "/api/unowned");
    expect(unowned.cases[0]).toMatchObject({ unowned_since_label: "16 Nov 15:40", pathway_label: "FIT → colonoscopy" });
    expect(unowned.cases[0].assign_owner_task.due_label).toBe("17 Nov 15:40");
  });

  it("names the pathway on rows and headers, and says which cases have the outreach ladder", async () => {
    const list = await ok("GET", "/api/cases?role=program_manager");
    const label = (id: string) => list.cases.find((c: { case_id: string }) => c.case_id === id).pathway_label;
    expect(label("CX-1001")).toBe("FIT → colonoscopy");
    expect(label("MM-2001")).toBe("Mammogram → biopsy");
    const fit = await ok("GET", "/api/cases/CX-1001?role=coordination_staff");
    expect(fit.case).toMatchObject({ has_outreach: true, pathway: { short_label: "FIT → colonoscopy" } });
    const mm = await ok("GET", "/api/cases/MM-2001?role=program_manager");
    expect(mm.case.has_outreach).toBe(false);
  });

  it("counts the role's whole register whatever the filter", async () => {
    const all = await ok("GET", "/api/cases?role=coordination_staff");
    const unowned = await ok("GET", "/api/cases?role=coordination_staff&filter=unowned");
    expect(unowned.counts).toEqual(all.counts);
    expect(unowned.register).toEqual(all.register);
    expect(all.counts.open).toBeGreaterThan(unowned.cases.length - 1);
  });

  it("lists the next steps from the template, offering a closure proposal only once evidence is attached", async () => {
    const physician = await ok("GET", "/api/cases/CX-1003?role=responsible_physician");
    const types = physician.next_steps.map((s: { event: string }) => s.event);
    expect(types).toContain("procedure_incomplete");
    expect(types).toContain("owner_assigned");
    expect(types).not.toContain("closure_confirmed");
    expect(physician.next_steps.find((s: { event: string }) => s.event === "owner_assigned")).toMatchObject({
      moves_stage: false,
      needs_owner: true,
    });

    // A case at pathology_received with no report attached: no closure proposal yet.
    await newCase("CX-F-STEPS");
    for (const type of ["patient_notified", "referral_sent", "referral_accepted", "colonoscopy_booked", "colonoscopy_performed", "pathology_ordered", "pathology_received"]) {
      await ok("POST", "/api/cases/CX-F-STEPS/events", { headers: COORDINATOR_B, body: { type } });
    }
    const bare = await ok("GET", "/api/cases/CX-F-STEPS?role=responsible_physician");
    expect(bare.next_steps.map((s: { event: string }) => s.event)).not.toContain("closure_proposed");
    await db
      .prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES ('d_steps', 'CX-F-STEPS', 'pathology', 'Pathology', 'Tubular adenoma.')")
      .run();
    const withReport = await ok("GET", "/api/cases/CX-F-STEPS?role=responsible_physician");
    expect(withReport.next_steps.find((s: { event: string }) => s.event === "closure_proposed")).toMatchObject({
      to: "closure_proposed",
      needs_outcome: true,
    });
    // An event recorded with no summary prints the template's words in the timeline.
    expect(withReport.timeline.at(-1).summary).toBe("Pathology result received");
  });
});

describe("GET /api/actors", () => {
  it("lists the people with their role and provider, and not the system", async () => {
    const { actors } = await ok("GET", "/api/actors");
    expect(actors.find((a: { actor_id: string }) => a.actor_id === "act_006")).toEqual({
      actor_id: "act_006",
      role: "responsible_physician",
      display_name: "Dr. Fulana",
      provider: { provider_id: "prov_hospital_b", name: "Hospital B" },
    });
    expect(actors.some((a: { role: string }) => a.role === "system")).toBe(false);
  });
});

describe("Case 2: the move and the consultation", () => {
  it("gives the reassigned assign-owner task a fresh deadline from the template", async () => {
    const before = await ok("GET", "/api/cases/CX-1002?role=coordination_staff");
    expect(before.tasks.find((t: { kind: string }) => t.kind === "assign_owner").due_at).toBe("2026-11-17T15:40:00+07:00");
    const moved = await ok("POST", "/api/cases/CX-1002/events", {
      headers: COORDINATOR_A,
      body: { type: "patient_moved_provider", payload: { provider_id: "prov_clinic_b" } },
    });
    const task = moved.tasks.find((t: { kind: string; status: string }) => t.kind === "assign_owner" && t.status === "open");
    expect(task.owner.actor_id).toBe("act_005");
    expect(task.due_at).toBe("2026-11-18T11:42:00+07:00"); // now (17 Nov 11:42) + 24 h
    expect(task.due_label).toBe("18 Nov 11:42");
  });

  it("is answered only by the physician it was addressed to", async () => {
    const asked = await ok("POST", "/api/cases/CX-1002/consultations", {
      headers: PHYSICIAN,
      body: { question: "Missing FIT date and history now attached. Can you accept the referral?" },
    });
    expect(asked.consultations.at(-1).to_actor_id).toBe("act_006");
    const id = asked.consultation_id;

    const other = await call("POST", `/api/consultations/${id}/answer`, {
      headers: PHYSICIAN,
      body: { outcome: "accepted", owner_actor_id: "act_005" },
    });
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe("role_not_permitted");

    const addressee = await ok("POST", `/api/consultations/${id}/answer`, {
      headers: RECEIVING_PHYSICIAN,
      body: { outcome: "accepted", owner_actor_id: "act_005" },
    });
    expect(addressee.consultations.at(-1)).toMatchObject({ status: "answered", answered_by_actor_id: "act_006" });
    expect(addressee.consultations.at(-1).answered_label).toMatch(LABEL);
  });
});
