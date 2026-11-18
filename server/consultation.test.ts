import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.js";

// TICKET-11 done-when (consultations), the demo's case 2 walked through the API
// (TICKET-17 scenario 2), and the TICKET-15 `proposed_outcome` gap. HTTP calls only,
// except for creating extra cases, which has no endpoint.

let server: Server | undefined;
let base = "";
let dir = "";
let db: Db;
let events: typeof import("./events.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-consult-"));
  process.env.DATABASE_FILE = join(dir, "consult.sqlite");
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
const REFERRING_PHYSICIAN = header("act_003", "responsible_physician");
const RECEIVING_PHYSICIAN = header("act_006", "responsible_physician");

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

async function ok(method: "GET" | "POST", path: string, options: { headers?: Record<string, string>; body?: unknown } = {}) {
  const result = await call(method, path, options);
  expect(result.status, `${path}: ${JSON.stringify(result.body)}`).toBe(200);
  return result.body;
}

const event = (caseId: string, type: string, payload: Record<string, unknown> = {}, headers = COORDINATOR_A) =>
  ok("POST", `/api/cases/${caseId}/events`, { headers, body: { type, payload } });

const ask = (caseId: string, question = "Missing data now attached. Can you accept?", extra: Record<string, unknown> = {}) =>
  ok("POST", `/api/cases/${caseId}/consultations`, { headers: REFERRING_PHYSICIAN, body: { question, ...extra } });

const answer = (consultationId: string, body: Record<string, unknown>, headers = RECEIVING_PHYSICIAN) =>
  call("POST", `/api/consultations/${consultationId}/answer`, { headers, body });

// An owned case at referral_sent with a referral to hospital B.
async function referredCase(caseId: string) {
  await events.createCase(db, {
    caseId,
    patient: { name: `Patient ${caseId}`, age: 60, language: "en" },
    actor: events.SYSTEM_ACTOR,
    ownerActorId: "act_005",
    providerId: "prov_clinic_b",
    patientIdentifier: `NX-P-${caseId}`,
  });
  await event(caseId, "patient_notified", {}, COORDINATOR_B);
  await event(
    caseId,
    "referral_sent",
    { referral: { to_provider_id: "prov_hospital_b", priority: "asap", specialty: SNOMED_GASTRO } },
    COORDINATOR_B,
  );
}

describe("TICKET-11: a consultation request", () => {
  it("creates a task with an owner and a deadline for the receiving physician", async () => {
    await referredCase("CX-T11-TASK");
    const body = await ask("CX-T11-TASK");
    expect(body.consultation_id).toMatch(/^k_/);

    const consultation = body.consultations[0];
    // Addressed to the referral's receiving provider and its physician.
    expect(consultation).toMatchObject({
      status: "open",
      to_provider: { provider_id: "prov_hospital_b", name: "Hospital B" },
      to_actor_id: "act_006",
      requested_by_actor_id: "act_003",
      requested_at: "2026-11-17T11:42:00+07:00",
      due_at: "2026-11-19T11:42:00+07:00", // the template's 48-hour answer deadline
    });
    const task = body.tasks.find((t: { task_id: string }) => t.task_id === consultation.task_id);
    expect(task).toMatchObject({ kind: "answer_consultation", status: "open", due_at: consultation.due_at });
    expect(task.owner).toMatchObject({ actor_id: "act_006", role: "responsible_physician" });
    expect(body.timeline.at(-1)).toMatchObject({ type: "consultation_requested" });

    // The engine offers answering, not a second question, and the guards agree.
    expect(body.available_actions).toContain("answer_consultation");
    expect(body.available_actions).not.toContain("request_consultation");
    const second = await call("POST", "/api/cases/CX-T11-TASK/consultations", {
      headers: REFERRING_PHYSICIAN,
      body: { question: "Again?" },
    });
    expect(second.status).toBe(409);
    const coordinator = await call("POST", "/api/cases/CX-T11-TASK/consultations", {
      headers: COORDINATOR_B,
      body: { question: "Me?" },
    });
    expect(coordinator.status).toBe(403);
    // The answer task cannot be closed as a generic task; it is answered.
    const generic = await call("POST", `/api/tasks/${consultation.task_id}/complete`, {
      headers: RECEIVING_PHYSICIAN,
      body: { outcome: "done" },
    });
    expect(generic.status).toBe(409);
  });

  it("refuses an empty question and a stage that takes no consultation", async () => {
    const empty = await call("POST", "/api/cases/CX-1001/consultations", { headers: REFERRING_PHYSICIAN, body: { question: " " } });
    expect(empty.status).toBe(409); // result_received is not a consultation stage
    await referredCase("CX-T11-EMPTY");
    const blank = await call("POST", "/api/cases/CX-T11-EMPTY/consultations", { headers: REFERRING_PHYSICIAN, body: { question: " " } });
    expect(blank.status).toBe(400);
  });
});

describe("TICKET-11: each answer moves the case to the correct state", () => {
  it("accepted: the referral is accepted and the case moves to referral_accepted", async () => {
    await referredCase("CX-T11-ACC");
    const asked = await ask("CX-T11-ACC");
    const { status, body } = await answer(asked.consultation_id, { outcome: "accepted", note: "Data complete now" });
    expect(status).toBe(200);
    expect(body.case.stage).toBe("referral_accepted");
    expect(body.case.owner.actor_id).toBe("act_005"); // already owned: the owner stays
    expect(body.referrals.at(-1).status).toBe("accepted");
    expect(body.consultations[0]).toMatchObject({
      status: "answered",
      outcome: "accepted",
      answered_by_actor_id: "act_006",
      hours_to_answer: 0,
    });
    expect(body.tasks.find((t: { kind: string }) => t.kind === "answer_consultation").status).toBe("completed");
    expect(body.timeline.at(-1)).toMatchObject({ type: "consultation_accepted" });
    expect(body.available_actions).not.toContain("answer_consultation");
  });

  it("redirected: a new referral to the named provider, back at referral_sent with a fresh acceptance deadline", async () => {
    await referredCase("CX-T11-RED");
    const asked = await ask("CX-T11-RED");
    const missing = await answer(asked.consultation_id, { outcome: "redirected" });
    expect(missing.status).toBe(400);

    const { status, body } = await answer(asked.consultation_id, {
      outcome: "redirected",
      redirect_to_provider_id: "prov_endo_e",
    });
    expect(status).toBe(200);
    expect(body.case.stage).toBe("referral_sent");
    expect(body.referrals.map((r: { status: string; to_provider: { provider_id: string } }) => [r.to_provider.provider_id, r.status])).toEqual([
      ["prov_hospital_b", "redirected"],
      ["prov_endo_e", "pending"],
    ]);
    // The new referral keeps the priority and specialty of the one it replaces.
    expect(body.referrals[1]).toMatchObject({ priority: "asap", specialty: SNOMED_GASTRO });
    expect(body.referrals[1].replaces_referral_id).toBe(body.referrals[0].referral_id);
    expect(body.timeline.at(-1)).toMatchObject({ type: "consultation_redirected" });
  });

  it("more data requested: the stage stays, the referring physician gets the task to supply it", async () => {
    await referredCase("CX-T11-MORE");
    const asked = await ask("CX-T11-MORE");
    const { status, body } = await answer(asked.consultation_id, { outcome: "more_data_requested", note: "Send the FIT value" });
    expect(status).toBe(200);
    expect(body.case.stage).toBe("referral_sent");
    expect(body.case.owner.actor_id).toBe("act_005");
    const supply = body.tasks.find((t: { kind: string }) => t.kind === "supply_referral_data");
    expect(supply).toMatchObject({ status: "open", due_at: "2026-11-20T11:42:00+07:00" });
    expect(supply.owner.actor_id).toBe("act_003");
    // Answered once is answered.
    const again = await answer(asked.consultation_id, { outcome: "accepted" });
    expect(again.status).toBe(409);
  });

  it("on an unowned case, every answer gives the case an owner", async () => {
    await referredCase("CX-T11-UNOWNED");
    await event("CX-T11-UNOWNED", "referral_rejected", {}, COORDINATOR_B);
    const asked = await ask("CX-T11-UNOWNED");
    const { body } = await answer(asked.consultation_id, { outcome: "more_data_requested" });
    expect(body.case.stage).toBe("patient_notified");
    expect(body.case.owner.actor_id).toBe("act_003"); // the physician who asked
    expect(body.ownership.state).toBe("owned");
    expect(body.ownership.gaps[0]).toMatchObject({ owner_event_type: "consultation_more_data_requested", owner_actor_id: "act_003" });
  });

  it("an answer is recorded only through the answer endpoint, by an answering role, and only where it is a legal step", async () => {
    await referredCase("CX-T11-GUARD");
    const direct = await call("POST", "/api/cases/CX-T11-GUARD/events", {
      headers: RECEIVING_PHYSICIAN,
      body: { type: "consultation_accepted" },
    });
    expect(direct.status).toBe(409);

    const asked = await ask("CX-T11-GUARD");
    const coordinator = await answer(asked.consultation_id, { outcome: "accepted" }, COORDINATOR_A);
    expect(coordinator.status).toBe(403);
    const unknown = await answer(asked.consultation_id, { outcome: "maybe" });
    expect(unknown.status).toBe(400);

    // CX-1003 is at closure_proposed: a question may be asked there, but "accepted" is
    // not a step from that stage, so the engine refuses it and the question stays open.
    const closing = await ask("CX-1003", "Does the report support closure?", { to_provider_id: "prov_endo_e", to_actor_id: "act_006" });
    const refused = await answer(closing.consultation_id, { outcome: "accepted" });
    expect(refused.status).toBe(409);
    const detail = await ok("GET", "/api/cases/CX-1003?role=responsible_physician");
    expect(detail.consultations[0].status).toBe("open");
    const fine = await answer(closing.consultation_id, { outcome: "more_data_requested" });
    expect(fine.status).toBe(200);
    expect(fine.body.case.stage).toBe("closure_proposed");
  });
});

describe("TICKET-17 case 2 / TICKET-11: CX-1002 through the API", () => {
  it("referral rejected, patient moves clinic, unowned, consultation, new owner, colonoscopy booked by stitching", async () => {
    // Start: the seed's state.
    const start = await ok("GET", "/api/cases/CX-1002?role=coordination_staff");
    expect(start.case).toMatchObject({ stage: "patient_notified", owner: null });
    expect(start.ownership.state).toBe("unowned");
    expect((await ok("GET", "/api/unowned")).cases[0]).toMatchObject({
      case_id: "CX-1002",
      trigger: expect.objectContaining({ type: "referral_rejected" }),
      provider: { provider_id: "prov_clinic_a", name: "Clinic A" },
    });

    // 1. The patient registers at clinic B: still unowned, the task moves with them.
    const moved = await event("CX-1002", "patient_moved_provider", { provider_id: "prov_clinic_b" }, COORDINATOR_B);
    expect(moved.provider.provider_id).toBe("prov_clinic_b");
    expect(moved.tasks.find((t: { task_id: string }) => t.task_id === "t_1002_owner").owner.actor_id).toBe("act_005");

    // 2. Dr. Fulan asks hospital B a consultation.
    const asked = await ask("CX-1002", "Missing FIT date and history now attached. Can you accept the referral?");
    expect(asked.consultations[0]).toMatchObject({ to_actor_id: "act_006", referral_id: "REF-4377-1" });

    // 3. A day later Dr. Fulana at hospital B accepts; S. Al Ali at clinic B takes the case.
    await ok("POST", "/api/clock/advance", { body: { days: 1 } });
    const { status, body } = await answer(asked.consultation_id, {
      outcome: "accepted",
      owner_actor_id: "act_005",
      note: "Accepted with the added history",
    });
    expect(status).toBe(200);
    expect(body.case.stage).toBe("referral_accepted");
    expect(body.case.owner.actor_id).toBe("act_005");
    expect(body.consultations[0]).toMatchObject({ outcome: "accepted", hours_to_answer: 24 });
    const handOver = body.timeline.at(-1).payload;
    expect(handOver).toMatchObject({ handed_over_by: "act_001", received_by: "act_005", assigned_by: "act_006" });
    // Unowned 16 Nov 15:40 -> owned 18 Nov 11:42 = 44.0 hours.
    expect(body.ownership.gaps[0]).toMatchObject({ hours_to_owner: 44, owner_event_type: "consultation_accepted" });
    expect((await ok("GET", "/api/unowned")).cases.map((c: { case_id: string }) => c.case_id)).not.toContain("CX-1002");

    // 4. Hospital B's booking arrives as FHIR and is stitched onto the case.
    const ingest = await ok("POST", "/api/ingest/fhir", {
      headers: COORDINATOR_B,
      body: {
        resourceType: "Appointment",
        id: "appt-4377-1",
        status: "booked",
        meta: { source: "urn:nexyra:provider:prov_hospital_b" },
        basedOn: [{ reference: "ServiceRequest/REF-4377-1" }],
        participant: [{ actor: { type: "Patient", identifier: { value: "NX-P-1002" } } }],
        start: "2026-11-25T09:00:00+07:00",
      },
    });
    expect(ingest.results[0]).toMatchObject({ outcome: "stitched", case_id: "CX-1002", stage: "colonoscopy_booked" });
  });
});

describe("TICKET-11: an unanswered consultation escalates", () => {
  it("escalates past its deadline through tick, once per level, and stops when answered", async () => {
    await referredCase("CX-T11-LATE");
    const asked = await ask("CX-T11-LATE");
    const consultationId = asked.consultation_id as string;
    const overdue = async () =>
      db
        .prepare(
          `SELECT json_extract(payload, '$.level') AS level, json_extract(payload, '$.escalated_to') AS role
             FROM events WHERE type = 'consultation_overdue' AND json_extract(payload, '$.consultation_id') = ?
            ORDER BY rowid`,
        )
        .all<{ level: number; role: string }>(consultationId);

    await ok("POST", "/api/clock/advance", { body: { days: 2 } }); // the 48-hour deadline
    expect(await overdue()).toEqual([{ level: 1, role: "responsible_physician" }]);
    const escalation = await db
      .prepare("SELECT owner_actor_id FROM tasks WHERE case_id = 'CX-T11-LATE' AND kind = 'escalation' ORDER BY rowid DESC LIMIT 1")
      .get<{ owner_actor_id: string }>();
    expect(escalation?.owner_actor_id).toBe("act_006"); // back to the physician who owes it

    await ok("POST", "/api/clock/tick");
    expect(await overdue()).toHaveLength(1); // idempotent at the same instant

    await ok("POST", "/api/clock/advance", { body: { days: 1 } });
    expect(await overdue()).toEqual([
      { level: 1, role: "responsible_physician" },
      { level: 2, role: "program_manager" },
    ]);

    const { body } = await answer(consultationId, { outcome: "accepted" });
    expect(body.consultations[0].hours_to_answer).toBe(72);
    await ok("POST", "/api/clock/advance", { body: { days: 1 } });
    expect(await overdue()).toHaveLength(2);
    const timers = await db
      .prepare("SELECT status FROM timers WHERE stage = ?")
      .all<{ status: string }>(`consultation:${consultationId}`);
    expect(timers.map((t) => t.status)).toEqual(["cancelled", "cancelled"]);
  });
});

describe("TICKET-15: the verification carries proposed_outcome", () => {
  it("is null for a reopen proposal, in the verification read and the case view", async () => {
    const verification = await ok("GET", "/api/cases/CX-1003/verification");
    expect(verification.extraction.proposal).toBe("reopen");
    expect(verification.extraction.proposed_outcome).toBeNull();
    const detail = await ok("GET", "/api/cases/CX-1003?role=responsible_physician");
    expect(detail.verification).toMatchObject({ proposal: "reopen", proposed_outcome: null });
  });

  it("names the outcome a propose_closure asks the physician to confirm", async () => {
    await referredCase("CX-T15-PROPOSE");
    await db.prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES ('d_t15', 'CX-T15-PROPOSE', 'colonoscopy', 'Report', 'Complete colonoscopy to the caecum.')").run();
    const fields = [
      { key: "complete_exam", value: "yes" },
      { key: "adequate_prep", value: "yes" },
      { key: "tissue_taken", value: "no" },
      { key: "pathology_available", value: "no" },
      { key: "outcome_category", value: "normal" },
      { key: "next_step", value: "stated" },
    ];
    await db
      .prepare(
        `INSERT INTO extractions (id, case_id, document_id, prompt_version, model, proposal, proposal_reason, fields, text_hash, created_at)
         VALUES ('x_t15', 'CX-T15-PROPOSE', 'd_t15', 'v1', 'fake', 'propose_closure', 'normal', ?, 'hash-t15', '2026-11-17T12:00:00+07:00')`,
      )
      .run(JSON.stringify(fields));

    const verification = await ok("GET", "/api/cases/CX-T15-PROPOSE/verification");
    expect(verification.extraction.proposed_outcome).toBe("returned_to_routine_screening");
    const detail = await ok("GET", "/api/cases/CX-T15-PROPOSE?role=coordination_staff");
    expect(detail.verification).toEqual({
      status: "ready",
      proposal: "propose_closure",
      proposed_outcome: "returned_to_routine_screening",
    });
  });
});
