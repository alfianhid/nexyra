import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.js";

// TICKET-08 done-when, one named test per box, through the HTTP surface. Cases the tests
// need beyond the seed are created with createCase and walked with POST /events, the
// same way the demo would drive them.

let server: Server | undefined;
let base = "";
let dir = "";
let db: Db;
let events: typeof import("./events.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-unowned-"));
  process.env.DATABASE_FILE = join(dir, "unowned.sqlite");
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
const NAVIGATOR = header("act_002", "navigator");

const SNOMED_GASTRO = { system: "http://snomed.info/sct", code: "394584008", display: "Gastroenterology" };

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

async function post(caseId: string, type: string, payload: Record<string, unknown> = {}, headers = COORDINATOR_A) {
  const result = await call("POST", `/api/cases/${caseId}/events`, { headers, body: { type, payload } });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body;
}

// A case at clinic A with a referral to `toProvider`, sitting at referral_sent.
async function caseWithReferral(caseId: string, patientId: string, referralId: string, toProvider = "prov_hospital_b") {
  await events.createCase(db, {
    caseId,
    patient: { name: `Patient ${caseId}`, age: 55, language: "en" },
    actor: events.SYSTEM_ACTOR,
    ownerActorId: "act_001",
    providerId: "prov_clinic_a",
    patientIdentifier: patientId,
  });
  await post(caseId, "patient_notified");
  return post(caseId, "referral_sent", {
    referral: { referral_id: referralId, to_provider_id: toProvider, priority: "routine", specialty: SNOMED_GASTRO },
  });
}

async function walk(caseId: string, types: string[]) {
  for (const type of types) await post(caseId, type);
}

describe("TICKET-08 / TICKET-11: the template blocks validate", () => {
  it("refuses an unowned block or a consultation answer that points nowhere or leaves a case unowned", async () => {
    const { readFileSync } = await import("node:fs");
    const { validatePathway } = await import("./pathways/index.js");
    const raw = () => JSON.parse(readFileSync(join(import.meta.dirname, "pathways", "fit-colonoscopy.json"), "utf8"));
    const problems = (mutate: (t: Record<string, any>) => void): string => {
      const t = raw();
      mutate(t);
      try {
        validatePathway(t, "broken.json");
      } catch (error) {
        return (error as Error).message;
      }
      return "accepted";
    };

    expect(problems(() => {})).toBe("accepted");
    expect(problems((t) => (t.unowned.acceptance_stage = "nowhere"))).toMatch(/unowned.acceptance_stage/);
    expect(problems((t) => (t.events.referral_unanswered.owner = "keep"))).toMatch(/unowned.unanswered_event/);
    expect(problems((t) => (t.events.consultation_accepted.owner = "clear"))).toMatch(/never leaves a case unowned/);
    expect(problems((t) => delete t.events.consultation_redirected.consultation_answer)).toMatch(/consultation_answer "redirected"/);
    expect(problems((t) => (t.stitching.rules[0].event = "case_closed"))).toMatch(/system role may not record/);
  });
});

describe("TICKET-08: referral input follows the REF attributes", () => {
  it("stores status, priority and the SNOMED-coded specialty, and refuses anything else", async () => {
    const body = await caseWithReferral("CX-T8-REF", "NX-P-T8REF", "REF-T8-REF");
    expect(body.referrals).toEqual([
      expect.objectContaining({
        referral_id: "REF-T8-REF",
        status: "pending",
        priority: "routine",
        specialty: SNOMED_GASTRO,
        to_provider: { provider_id: "prov_hospital_b", name: "Hospital B" },
      }),
    ]);

    await events.createCase(db, {
      caseId: "CX-T8-BADREF",
      patient: { name: "Bad", age: 50, language: "en" },
      actor: events.SYSTEM_ACTOR,
      ownerActorId: "act_001",
      providerId: "prov_clinic_a",
    });
    await post("CX-T8-BADREF", "patient_notified");
    const bad = [
      { to_provider_id: "prov_hospital_b", priority: "urgent", specialty: SNOMED_GASTRO },
      { to_provider_id: "prov_hospital_b", priority: "routine", specialty: { ...SNOMED_GASTRO, system: "local" } },
      { to_provider_id: "prov_hospital_b", priority: "routine", specialty: { ...SNOMED_GASTRO, code: "GI" } },
      { to_provider_id: "prov_nowhere", priority: "routine", specialty: SNOMED_GASTRO },
    ];
    for (const referral of bad) {
      const { status, body: error } = await call("POST", "/api/cases/CX-T8-BADREF/events", {
        headers: COORDINATOR_A,
        body: { type: "referral_sent", payload: { referral } },
      });
      expect(status, JSON.stringify(referral)).toBe(400);
      expect(error.error.code).toBe("validation_failed");
    }
  });
});

describe("TICKET-08: the three unowned triggers", () => {
  it("trigger 1: a rejected referral makes the case unowned with an assign-owner task for the referring provider's coordination staff", async () => {
    await caseWithReferral("CX-T8-REJ", "NX-P-T8REJ", "REF-T8-REJ");
    const body = await post("CX-T8-REJ", "referral_rejected", { reason: "Request incomplete" }, NAVIGATOR);

    expect(body.case.owner).toBeNull();
    expect(body.ownership.state).toBe("unowned");
    expect(body.referrals[0].status).toBe("rejected");
    const task = body.tasks.find((t: { kind: string; status: string }) => t.kind === "assign_owner" && t.status === "open");
    // Clinic A referred, so its coordination staff (act_001) get the task.
    expect(task.owner.actor_id).toBe("act_001");

    const trigger = body.timeline.at(-1);
    expect(trigger.type).toBe("referral_rejected");
    expect(trigger.payload.previous_owner_actor_id).toBe("act_001");

    const unowned = await call("GET", "/api/unowned");
    const row = unowned.body.cases.find((c: { case_id: string }) => c.case_id === "CX-T8-REJ");
    expect(row.trigger).toMatchObject({ type: "referral_rejected", reason: "Request incomplete" });
    expect(row.provider).toEqual({ provider_id: "prov_clinic_a", name: "Clinic A" });
    expect(row.assign_owner_task.owner.actor_id).toBe("act_001");
  });

  it("trigger 3: the patient moving provider while the case is open makes it unowned, and the task follows the patient", async () => {
    await events.createCase(db, {
      caseId: "CX-T8-MOVE",
      patient: { name: "Mover", age: 49, language: "en" },
      actor: events.SYSTEM_ACTOR,
      ownerActorId: "act_001",
      providerId: "prov_clinic_a",
      patientIdentifier: "NX-P-T8MOVE",
    });
    const body = await post("CX-T8-MOVE", "patient_moved_provider", {
      provider_id: "prov_clinic_b",
      reason: "Patient registered at clinic B",
    });
    expect(body.case.owner).toBeNull();
    expect(body.case.stage).toBe("result_received");
    expect(body.provider).toEqual({ provider_id: "prov_clinic_b", name: "Clinic B" });
    const task = body.tasks.find((t: { kind: string }) => t.kind === "assign_owner");
    expect(task.owner.actor_id).toBe("act_005"); // clinic B's coordination staff

    // Moving to the provider the case is already at, or to none, is refused.
    const same = await call("POST", "/api/cases/CX-T8-MOVE/events", {
      headers: COORDINATOR_B,
      body: { type: "patient_moved_provider", payload: { provider_id: "prov_clinic_b" } },
    });
    expect(same.status).toBe(400);
    const none = await call("POST", "/api/cases/CX-T8-MOVE/events", {
      headers: COORDINATOR_B,
      body: { type: "patient_moved_provider", payload: {} },
    });
    expect(none.status).toBe(400);

    // On a case that is already unowned (the seeded CX-1002) the spell continues from
    // the first trigger, and the open task moves to the new provider.
    const before = await call("GET", "/api/unowned");
    const since = before.body.cases.find((c: { case_id: string }) => c.case_id === "CX-1002").unowned_since;
    const moved = await post("CX-1002", "patient_moved_provider", { provider_id: "prov_clinic_b" });
    const assign = moved.tasks.find((t: { task_id: string }) => t.task_id === "t_1002_owner");
    expect(assign.owner.actor_id).toBe("act_005");
    expect(moved.ownership.unowned_since).toBe(since);
    expect(moved.ownership.gaps).toHaveLength(1);

    // A closed case has no owner to lose: the engine refuses the move at the terminal stage.
    const { transitionFor } = await import("./engine.js");
    expect(transitionFor("closed", "patient_moved_provider", "coordination_staff").ok).toBe(false);
  });

  it("rebuildCase reproduces the provider a move recorded", async () => {
    await db.prepare("UPDATE cases SET provider_id = NULL WHERE id = 'CX-T8-MOVE'").run();
    const state = await events.rebuildCase(db, "CX-T8-MOVE");
    expect(state.provider_id).toBe("prov_clinic_b");
    const row = await db.prepare("SELECT provider_id FROM cases WHERE id = 'CX-T8-MOVE'").get<{ provider_id: string }>();
    expect(row?.provider_id).toBe("prov_clinic_b");
  });
});

describe("TICKET-08: the unowned list", () => {
  it("is one endpoint, ordered server-side, longest unowned first, with the trigger and the task", async () => {
    const { status, body } = await call("GET", "/api/unowned");
    expect(status).toBe(200);
    expect(body.count).toBe(body.cases.length);
    const ids = body.cases.map((c: { case_id: string }) => c.case_id);
    expect(ids).toEqual(expect.arrayContaining(["CX-1002", "CX-T8-REJ", "CX-T8-MOVE"]));
    const since = body.cases.map((c: { unowned_since: string }) => Date.parse(c.unowned_since));
    expect([...since].sort((a, b) => a - b)).toEqual(since);
    expect(body.cases[0].case_id).toBe("CX-1002"); // unowned since 16 Nov 15:40
    for (const row of body.cases) {
      expect(row.trigger, row.case_id).not.toBeNull();
      expect(typeof row.hours_unowned).toBe("number");
    }
  });
});

describe("TICKET-08: ownership hand-over and time to owned again", () => {
  it("records who handed over and who received, and stores the hours to owned again per case", async () => {
    const body = await post("CX-1002", "owner_assigned", { owner_actor_id: "act_005" }, COORDINATOR_B);
    expect(body.case.owner.actor_id).toBe("act_005");

    const assigned = body.timeline.at(-1);
    expect(assigned.type).toBe("owner_assigned");
    expect(assigned.payload).toMatchObject({
      handed_over_by: "act_001", // the owner before the referral was rejected
      received_by: "act_005",
      assigned_by: "act_005",
    });

    // Unowned 16 Nov 15:40 -> owned 17 Nov 11:42 (demo day 0) = 20.0 hours.
    expect(body.ownership).toMatchObject({ state: "owned", unowned_since: null });
    expect(body.ownership.gaps[0]).toMatchObject({
      trigger: expect.objectContaining({ type: "referral_rejected" }),
      owner_event_type: "owner_assigned",
      owner_actor_id: "act_005",
      hours_to_owner: 20,
    });
    const stored = await db
      .prepare("SELECT hours_to_owner FROM ownership_gaps WHERE case_id = 'CX-1002'")
      .get<{ hours_to_owner: number }>();
    expect(stored?.hours_to_owner).toBe(20);

    expect(body.tasks.find((t: { task_id: string }) => t.task_id === "t_1002_owner").status).toBe("completed");
    const unowned = await call("GET", "/api/unowned");
    expect(unowned.body.cases.map((c: { case_id: string }) => c.case_id)).not.toContain("CX-1002");
  });
});

describe("TICKET-08: event stitching", () => {
  const procedure = (id: string, patient: string, referral: string | null) => ({
    resourceType: "Procedure",
    id,
    status: "completed",
    meta: { source: "urn:nexyra:provider:prov_hospital_b" },
    code: { coding: [{ system: "http://snomed.info/sct", code: "73761001", display: "Colonoscopy" }] },
    subject: { identifier: { system: "urn:nexyra:demo-patient-id", value: patient } },
    ...(referral ? { basedOn: [{ reference: `ServiceRequest/${referral}` }] } : {}),
    performedDateTime: "2026-11-17T09:00:00+07:00",
  });

  it("stitches a colonoscopy performed at another hospital to the right case", async () => {
    // Two open cases at colonoscopy_booked, different patients and referrals.
    for (const [caseId, patient, referral] of [
      ["CX-T8-S1", "NX-P-S1", "REF-S1"],
      ["CX-T8-S2", "NX-P-S2", "REF-S2"],
    ] as const) {
      await caseWithReferral(caseId, patient, referral);
      await walk(caseId, ["referral_accepted", "colonoscopy_booked"]);
    }

    const { status, body } = await call("POST", "/api/ingest/fhir", {
      headers: COORDINATOR_A,
      body: procedure("proc-s2-1", "NX-P-S2", "REF-S2"),
    });
    expect(status).toBe(200);
    expect(body.results).toEqual([
      expect.objectContaining({ outcome: "stitched", case_id: "CX-T8-S2", stage: "procedure_completed", stage_moved: true }),
    ]);
    expect(body.counts.stitched).toBe(1);

    const s2 = await call("GET", "/api/cases/CX-T8-S2?role=coordination_staff");
    const last = s2.body.timeline.at(-1);
    expect(last.type).toBe("colonoscopy_performed");
    expect(last.actor).toBeNull(); // the engine recorded it
    expect(last.payload.fhir).toMatchObject({ key: "Procedure/proc-s2-1", source_provider_id: "prov_hospital_b", referral_id: "REF-S2" });

    const s1 = await call("GET", "/api/cases/CX-T8-S1?role=coordination_staff");
    expect(s1.body.case.stage).toBe("colonoscopy_booked");

    // Sending the same resource again stitches nothing new.
    const again = await call("POST", "/api/ingest/fhir", {
      headers: COORDINATOR_A,
      body: procedure("proc-s2-1", "NX-P-S2", "REF-S2"),
    });
    expect(again.body.results[0]).toMatchObject({ outcome: "stitched", duplicate: true, case_id: "CX-T8-S2" });
    const count = await db
      .prepare("SELECT count(*) AS n FROM events WHERE json_extract(payload, '$.fhir.key') = 'Procedure/proc-s2-1'")
      .get<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("stitches a resource that is not the next step as history, without moving the case", async () => {
    const appointment = {
      resourceType: "Appointment",
      id: "appt-s1-early",
      status: "booked",
      basedOn: [{ reference: "ServiceRequest/REF-T8-REF" }],
      participant: [{ actor: { reference: "Patient/x", identifier: { value: "NX-P-T8REF" } } }],
    };
    // CX-T8-REF is still at referral_sent: an appointment cannot book it yet.
    const { body } = await call("POST", "/api/ingest/fhir", { headers: COORDINATOR_A, body: appointment });
    expect(body.results[0]).toMatchObject({ outcome: "stitched", case_id: "CX-T8-REF", stage_moved: false, stage: "referral_sent" });
    const detail = await call("GET", "/api/cases/CX-T8-REF?role=coordination_staff");
    expect(detail.body.timeline.at(-1)).toMatchObject({ type: "fhir_resource_stitched" });
    expect(detail.body.timeline.at(-1).payload.not_moved_reason).toMatch(/cannot follow stage/);
  });

  it("puts an event with no matching case in the not-yet-stitched queue, with its reason", async () => {
    const bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { resource: procedure("proc-unknown-ref", "NX-P-S1", "REF-DOES-NOT-EXIST") },
        { resource: procedure("proc-wrong-patient", "NX-P-SOMEONE-ELSE", "REF-S1") },
        { resource: procedure("proc-no-referral", "NX-P-S1", null) },
        { resource: { resourceType: "Observation", id: "obs-1", status: "final" } },
      ],
    };
    const { status, body } = await call("POST", "/api/ingest/fhir", { headers: COORDINATOR_A, body: bundle });
    expect(status).toBe(200);
    expect(body.results.map((r: { outcome: string; reason_code: string }) => [r.outcome, r.reason_code])).toEqual([
      ["queued_unstitched", "unknown_referral"],
      ["queued_unstitched", "patient_mismatch"],
      ["queued_unstitched", "no_referral_reference"],
      ["rejected", "unsupported_type"],
    ]);
    expect(body.counts).toEqual({ created_case: 0, stitched: 0, queued_unstitched: 3, rejected: 1 });

    const queue = await call("GET", "/api/ingest/unstitched");
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((i: { resource_id: string }) => i.resource_id)).toEqual([
      "proc-unknown-ref",
      "proc-wrong-patient",
      "proc-no-referral",
    ]);
    expect(queue.body.items[0]).toMatchObject({
      resource_type: "Procedure",
      reason_code: "unknown_referral",
      referral_id: "REF-DOES-NOT-EXIST",
      patient_identifier: "NX-P-S1",
      source_provider: { provider_id: "prov_hospital_b", name: "Hospital B" },
      status: "queued",
    });
    // Nothing was stitched onto CX-T8-S1.
    const s1 = await call("GET", "/api/cases/CX-T8-S1?role=coordination_staff");
    expect(s1.body.case.stage).toBe("colonoscopy_booked");
  });

  it("stitches a queued resource once its referral exists, and marks the queue row stitched", async () => {
    await caseWithReferral("CX-T8-LATE", "NX-P-S1", "REF-DOES-NOT-EXIST");
    await walk("CX-T8-LATE", ["referral_accepted", "colonoscopy_booked"]);
    const { body } = await call("POST", "/api/ingest/fhir", {
      headers: COORDINATOR_A,
      body: procedure("proc-unknown-ref", "NX-P-S1", "REF-DOES-NOT-EXIST"),
    });
    expect(body.results[0]).toMatchObject({ outcome: "stitched", case_id: "CX-T8-LATE" });

    const queued = await call("GET", "/api/ingest/unstitched");
    expect(queued.body.items.map((i: { resource_id: string }) => i.resource_id)).not.toContain("proc-unknown-ref");
    const all = await call("GET", "/api/ingest/unstitched?status=all");
    expect(all.body.items.find((i: { resource_id: string }) => i.resource_id === "proc-unknown-ref")).toMatchObject({
      status: "stitched",
      stitched_case_id: "CX-T8-LATE",
    });
  });

  it("attaches a pathology report from another provider and moves the case to pathology_received", async () => {
    await walk("CX-T8-S2", ["pathology_ordered"]);
    const report = {
      resourceType: "DiagnosticReport",
      id: "dr-s2-path",
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "SP" }] }],
      code: { text: "Surgical pathology report" },
      subject: { identifier: { value: "NX-P-S2" } },
      basedOn: [{ reference: "ServiceRequest/REF-S2" }],
      presentedForm: [{ contentType: "text/plain", data: Buffer.from("Tubular adenoma, low-grade dysplasia.").toString("base64") }],
    };
    const { body } = await call("POST", "/api/ingest/fhir", { headers: COORDINATOR_A, body: report });
    expect(body.results[0]).toMatchObject({ outcome: "stitched", stage: "pathology_received", stage_moved: true });
    const detail = await call("GET", "/api/cases/CX-T8-S2?role=coordination_staff");
    expect(detail.body.documents).toEqual([expect.objectContaining({ kind: "pathology" })]);
  });

  it("refuses ingest without an actor and answers a malformed body with the error envelope", async () => {
    const anonymous = await call("POST", "/api/ingest/fhir", { body: procedure("p-x", "NX-P-S1", "REF-S1") });
    expect(anonymous.status).toBe(403);
    const malformed = await call("POST", "/api/ingest/fhir", { headers: COORDINATOR_A, body: { resourceType: "Procedure" } });
    expect(malformed.body.results[0]).toMatchObject({ outcome: "rejected", reason_code: "missing_identity" });
  });
});

describe("TICKET-08: trigger 2, referral unanswered by the acceptance deadline", () => {
  it("fires from tick once the acceptance deadline passes, and only once", async () => {
    await caseWithReferral("CX-T8-SILENT", "NX-P-SILENT", "REF-SILENT");
    // referral_sent's deadline (the acceptance deadline) is 72 hours in the template.
    const early = await call("POST", "/api/clock/tick");
    expect(early.body.unowned_triggered).toBe(0);

    const advanced = await call("POST", "/api/clock/advance", { body: { days: 3 } });
    expect(advanced.status).toBe(200);
    expect(advanced.body.unowned_triggered).toBeGreaterThanOrEqual(1);

    const detail = await call("GET", "/api/cases/CX-T8-SILENT?role=coordination_staff");
    expect(detail.body.case.owner).toBeNull();
    expect(detail.body.case.stage).toBe("referral_sent");
    expect(detail.body.referrals[0].status).toBe("expired");
    expect(detail.body.timeline.some((e: { type: string }) => e.type === "referral_unanswered")).toBe(true);
    expect(detail.body.tasks.find((t: { kind: string }) => t.kind === "assign_owner").owner.actor_id).toBe("act_001");

    const unowned = await call("GET", "/api/unowned");
    expect(unowned.body.cases.find((c: { case_id: string }) => c.case_id === "CX-T8-SILENT").trigger.type).toBe(
      "referral_unanswered",
    );

    // Idempotent: a second tick at the same instant fires nothing more, and neither does
    // a tick after a new owner took the case at the same stage.
    const again = await call("POST", "/api/clock/tick");
    expect(again.body.unowned_triggered).toBe(0);
    await post("CX-T8-SILENT", "owner_assigned", { owner_actor_id: "act_001" });
    const afterOwner = await call("POST", "/api/clock/tick");
    expect(afterOwner.body.unowned_triggered).toBe(0);
    const fired = await db
      .prepare("SELECT count(*) AS n FROM events WHERE case_id = 'CX-T8-SILENT' AND type = 'referral_unanswered'")
      .get<{ n: number }>();
    expect(fired?.n).toBe(1);
  });
});
