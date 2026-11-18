// TICKET-17: the demo, step by step, as the HTTP requests the screens send. One list
// serves three purposes:
// - `server/demo.test.ts` walks it end to end after `demo:reset` and checks every result;
// - `npm run demo:step -- <id>` sends one step to a running server, for the steps that
//   have no button yet or that stand for a message from another system (FHIR from the
//   endoscopy unit or the laboratory);
// - `docs/demo-script.md` refers to the step ids.
// All people, providers and reports are fictional.

import { PATHOLOGY_REPORT, REPEAT_COLONOSCOPY_REPORT } from "../../server/demoReports.js";

export type DemoActor = { actor_id: string; role: string; display_name: string };

export const ACTORS = {
  coordinatorA: { actor_id: "act_001", role: "coordination_staff", display_name: "R. Haddad" },
  coordinatorB: { actor_id: "act_005", role: "coordination_staff", display_name: "S. Al Ali" },
  navigator: { actor_id: "act_002", role: "navigator", display_name: "Nur H." },
  physician: { actor_id: "act_003", role: "responsible_physician", display_name: "Dr. Fulan" },
  receivingPhysician: { actor_id: "act_006", role: "responsible_physician", display_name: "Dr. Fulana" },
  programManager: { actor_id: "act_004", role: "program_manager", display_name: "A. Al Suwaidi" },
} as const satisfies Record<string, DemoActor>;

export const CX1001_TOKEN = "hq7m3kx9va";

// What one step sends. `body` may read earlier responses (the consultation id).
export type DemoStep = {
  id: string;
  case: "CX-1003" | "CX-1002" | "CX-1001" | "programme";
  title: string;
  // Who does it on screen, and which control. "inbound" means another system sends it.
  screen: string;
  method: "GET" | "POST";
  path: (memo: Memo) => string;
  actor?: DemoActor;
  body?: (memo: Memo) => unknown;
};

export type Memo = Record<string, unknown>;

// ---- reports and messages from outside (fictional) --------------------------------------

// The report texts live in server/demoReports.ts: the seed caches their reading.

const fromProvider = (provider: string) => ({ source: `urn:nexyra:provider:${provider}` });

export const FHIR = {
  // Case 3: the endoscopy unit books and performs the repeat colonoscopy, then the lab reports.
  case3Booking: {
    resourceType: "Appointment",
    id: "appt-4302-2",
    status: "booked",
    meta: fromProvider("prov_endo_e"),
    basedOn: [{ reference: "ServiceRequest/REF-4302-1" }],
    participant: [{ actor: { type: "Patient", identifier: { value: "NX-P-1003" } } }],
    start: "2026-11-24T08:30:00+07:00",
  },
  case3Performed: {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        resource: {
          resourceType: "Procedure",
          id: "proc-4302-2",
          status: "completed",
          meta: fromProvider("prov_endo_e"),
          basedOn: [{ reference: "ServiceRequest/REF-4302-1" }],
          subject: { identifier: { value: "NX-P-1003" } },
          code: { text: "Colonoscopy" },
        },
      },
      {
        resource: {
          resourceType: "DiagnosticReport",
          id: "rep-4302-2",
          status: "final",
          meta: fromProvider("prov_endo_e"),
          basedOn: [{ reference: "ServiceRequest/REF-4302-1" }],
          subject: { identifier: { value: "NX-P-1003" } },
          code: { text: "Colonoscopy report" },
          conclusion: REPEAT_COLONOSCOPY_REPORT,
        },
      },
    ],
  },
  case3Pathology: {
    resourceType: "DiagnosticReport",
    id: "path-4302-2",
    status: "final",
    meta: fromProvider("prov_endo_e"),
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "SP", display: "Surgical Pathology" }] }],
    basedOn: [{ reference: "ServiceRequest/REF-4302-1" }],
    subject: { identifier: { value: "NX-P-1003" } },
    code: { text: "Histopathology report" },
    conclusion: PATHOLOGY_REPORT,
  },
  // Case 2: hospital B books the colonoscopy it accepted through the consultation.
  case2Booking: {
    resourceType: "Appointment",
    id: "appt-4377-1",
    status: "booked",
    meta: fromProvider("prov_hospital_b"),
    basedOn: [{ reference: "ServiceRequest/REF-4377-1" }],
    participant: [{ actor: { type: "Patient", identifier: { value: "NX-P-1002" } } }],
    start: "2026-11-25T09:00:00+07:00",
  },
} as const;

const event = (caseId: string, type: string, payload: Record<string, unknown> = {}) => ({
  method: "POST" as const,
  path: () => `/api/cases/${caseId}/events`,
  body: () => ({ type, payload }),
});

// ---- the demo, in stage order: case 3, case 2, case 1, programme view -----------------

export const DEMO_STEPS: DemoStep[] = [
  // Case 3: "done" that is not done. Day 0.
  {
    id: "3.1",
    case: "CX-1003",
    title: "Open the closure review: the cached reading proposes reopen, with two cited quotes",
    screen: "Physician · Case CX-1003 → Closure review",
    method: "GET",
    path: () => "/api/cases/CX-1003/verification",
    actor: ACTORS.physician,
  },
  {
    id: "3.2",
    case: "CX-1003",
    title: "Read the report again: served from the cache, no model call",
    screen: "Physician · Closure review (verification)",
    method: "POST",
    path: () => "/api/cases/CX-1003/verification",
    actor: ACTORS.physician,
    body: () => ({}),
  },
  {
    id: "3.3",
    case: "CX-1003",
    title:
      "Reopen: the engine records the examination as incomplete with the reading's reasons; the case goes back to referral",
    screen: "Physician · Closure review → Reopen case",
    method: "POST",
    path: () => "/api/cases/CX-1003/reopen",
    actor: ACTORS.physician,
    body: () => ({ reason: "Repeat colonoscopy needed" }),
  },
  {
    id: "3.4",
    case: "CX-1003",
    title: "Hand the case to S. Al Ali to rebook",
    screen: "Physician · Case CX-1003 → Record next step: Owner assigned or handed over, S. Al Ali",
    actor: ACTORS.physician,
    ...event("CX-1003", "owner_assigned", {
      owner_actor_id: "act_005",
      summary: "Handed to S. Al Ali to rebook the repeat colonoscopy",
    }),
  },
  {
    id: "3.5",
    case: "CX-1003",
    title: "The endoscopy unit accepts the repeat referral",
    screen: "Coordinator · Case CX-1003 → Record next step: Receiving provider accepted the referral",
    actor: ACTORS.coordinatorB,
    ...event("CX-1003", "referral_accepted", { summary: "Endoscopy unit E accepted the repeat colonoscopy" }),
  },
  {
    id: "3.6",
    case: "CX-1003",
    title: "Inbound: the endoscopy unit's booking (FHIR Appointment) is stitched to the case",
    screen: "inbound (npm run demo:step -- 3.6)",
    method: "POST",
    path: () => "/api/ingest/fhir",
    actor: ACTORS.coordinatorB,
    body: () => FHIR.case3Booking,
  },
  {
    id: "3.7",
    case: "CX-1003",
    title: "Inbound: repeat colonoscopy performed, complete, one polyp removed (Procedure + report)",
    screen: "inbound (npm run demo:step -- 3.7)",
    method: "POST",
    path: () => "/api/ingest/fhir",
    actor: ACTORS.coordinatorB,
    body: () => FHIR.case3Performed,
  },
  {
    id: "3.8",
    case: "CX-1003",
    title: "The physician records the pathology order",
    screen: "Physician · Case CX-1003 → Record next step: Pathology ordered",
    actor: ACTORS.physician,
    ...event("CX-1003", "pathology_ordered", { summary: "Polyp sent for histology" }),
  },
  {
    id: "3.9",
    case: "CX-1003",
    title: "Inbound: the pathology report (tubular adenoma, surveillance in 3 years)",
    screen: "inbound (npm run demo:step -- 3.9)",
    method: "POST",
    path: () => "/api/ingest/fhir",
    actor: ACTORS.coordinatorB,
    body: () => FHIR.case3Pathology,
  },
  {
    id: "3.10",
    case: "CX-1003",
    title: "Propose closure with the surveillance outcome",
    screen: "Coordinator · Case CX-1003 → Record next step: Closure proposed with an outcome (Surveillance scheduled)",
    actor: ACTORS.coordinatorB,
    ...event("CX-1003", "closure_proposed", {
      outcome: "surveillance_scheduled",
      summary: "Closure proposed: surveillance colonoscopy in 3 years",
    }),
  },
  {
    id: "3.11",
    case: "CX-1003",
    title: "Read the latest report: the repeat colonoscopy and its pathology, read together (cached reading)",
    screen: "Physician · Closure review → Read the latest report",
    method: "POST",
    path: () => "/api/cases/CX-1003/verification",
    actor: ACTORS.physician,
    body: () => ({}),
  },
  {
    id: "3.12",
    case: "CX-1003",
    title: "The physician confirms closure: surveillance scheduled",
    screen: "Physician · Closure review → Confirm closure",
    method: "POST",
    path: () => "/api/cases/CX-1003/closure/confirm",
    actor: ACTORS.physician,
    body: () => ({ final_outcome: "surveillance_scheduled" }),
  },

  // Case 2: referral rejected, the patient moves, the case is unowned, then owned again.
  {
    id: "2.1",
    case: "CX-1002",
    title: "The unowned queue: CX-1002, referral rejected by hospital B, nobody owns it",
    screen: "Coordination · Unowned queue",
    method: "GET",
    path: () => "/api/unowned",
    actor: ACTORS.coordinatorB,
  },
  {
    id: "2.2",
    case: "CX-1002",
    title: "Record that the patient moved to clinic B: the assign-owner task follows the patient",
    screen: "Coordination (S. Al Ali) · Case CX-1002 → Patient moved provider",
    actor: ACTORS.coordinatorB,
    ...event("CX-1002", "patient_moved_provider", {
      provider_id: "prov_clinic_b",
      summary: "Patient now registered at clinic B",
    }),
  },
  {
    id: "2.3",
    case: "CX-1002",
    title: "The referring physician asks hospital B one question (consultation, due in 48 h)",
    screen: "Physician · Case CX-1002 → Ask the receiving provider",
    method: "POST",
    path: () => "/api/cases/CX-1002/consultations",
    actor: ACTORS.physician,
    body: () => ({ question: "Missing FIT date and history now attached. Can you accept the referral?" }),
  },
  {
    id: "2.4",
    case: "CX-1002",
    title: "Advance the clock one day",
    screen: "Header · +1 day",
    method: "POST",
    path: () => "/api/clock/advance",
    body: () => ({ days: 1 }),
  },
  {
    id: "2.5",
    case: "CX-1002",
    title: "Hospital B accepts; S. Al Ali owns the case again",
    screen: "Receiving physician (Dr. Fulana) · Consultation → Accept",
    method: "POST",
    path: (memo) => `/api/consultations/${String(memo.consultation_id)}/answer`,
    actor: ACTORS.receivingPhysician,
    body: () => ({
      outcome: "accepted",
      owner_actor_id: "act_005",
      note: "Accepted with the attached data; booking follows.",
    }),
  },
  {
    id: "2.6",
    case: "CX-1002",
    title: "Inbound: hospital B's booking (FHIR Appointment) is stitched to the case",
    screen: "inbound (npm run demo:step -- 2.6)",
    method: "POST",
    path: () => "/api/ingest/fhir",
    actor: ACTORS.coordinatorB,
    body: () => FHIR.case2Booking,
  },

  // Case 1: the silent patient. The staff call task fired in step 2.4 (day 1).
  {
    id: "1.1",
    case: "CX-1001",
    title: "The outreach ladder: Arabic message unanswered since 16 Nov, staff call task open",
    screen: "Coordination · Case CX-1001 → Outreach",
    method: "GET",
    path: () => "/api/cases/CX-1001/outreach",
    actor: ACTORS.coordinatorB,
  },
  {
    id: "1.2",
    case: "CX-1001",
    title: "Staff call: no answer",
    screen: "Coordination · Outreach → Log call",
    method: "POST",
    path: () => "/api/cases/CX-1001/outreach",
    actor: ACTORS.coordinatorB,
    body: () => ({ outcome: "No answer", channel: "call", connected: false }),
  },
  {
    id: "1.3",
    case: "CX-1001",
    title: "Advance the clock one day (nothing new: the navigator waits 48 h after the call step)",
    screen: "Header · +1 day",
    method: "POST",
    path: () => "/api/clock/advance",
    body: () => ({ days: 1 }),
  },
  {
    id: "1.4",
    case: "CX-1001",
    title: "Advance one more day: no movement for 48 h, so the navigator gets the case",
    screen: "Header · +1 day",
    method: "POST",
    path: () => "/api/clock/advance",
    body: () => ({ days: 1 }),
  },
  {
    id: "1.5",
    case: "CX-1001",
    title: "The navigator reaches the patient and records the barrier: fear of the bowel preparation",
    screen: "Navigator · Outreach → Log call (reason: fear)",
    method: "POST",
    path: () => "/api/cases/CX-1001/outreach",
    actor: ACTORS.navigator,
    body: () => ({
      outcome: "Reached the patient; afraid of the bowel preparation",
      channel: "call",
      connected: true,
      delay_reason: "fear",
      note: "Explained the preparation; patient will read the message link again",
    }),
  },
  {
    id: "1.6",
    case: "CX-1001",
    title: "The patient opens the link from the message (Arabic, right to left)",
    screen: `Patient page /p/${CX1001_TOKEN}`,
    method: "GET",
    path: () => `/api/patient/${CX1001_TOKEN}`,
  },
  {
    id: "1.7",
    case: "CX-1001",
    title: "The patient taps \"understood\": the case moves to Patient notified and the ladder stops",
    screen: `Patient page /p/${CX1001_TOKEN} → Understood`,
    method: "POST",
    path: () => `/api/patient/${CX1001_TOKEN}/response`,
    body: () => ({ response: "understood" }),
  },

  // Programme view, after one jump to the next deadline so an escalation happens on stage.
  {
    id: "P.0",
    case: "programme",
    title: "Jump to the next deadline: the case that missed it escalates without anyone pressing a case button",
    screen: "Header · Next deadline",
    method: "POST",
    path: () => "/api/clock/advance",
    body: () => ({ until: "next_deadline" }),
  },
  {
    id: "P.1",
    case: "programme",
    title: "The programme view over the three demo cases and the 1,000-case synthetic cohort",
    screen: "Program manager · Programme",
    method: "GET",
    path: () => "/api/program/summary",
    actor: ACTORS.programManager,
  },
];

export type Send = (
  method: "GET" | "POST",
  path: string,
  actor: DemoActor | undefined,
  body: unknown,
) => Promise<{ status: number; body: unknown }>;

// Sends one step and remembers what later steps need from its answer.
export async function runStep(step: DemoStep, memo: Memo, send: Send) {
  const response = await send(step.method, step.path(memo), step.actor, step.body?.(memo));
  const body = response.body as Record<string, unknown> | null;
  if (step.id === "2.3" && body && typeof body.consultation_id === "string") {
    memo.consultation_id = body.consultation_id;
  }
  return response;
}

export function httpSend(base: string): Send {
  return async (method, path, actor, body) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (actor) headers["X-Nexyra-Actor"] = JSON.stringify(actor);
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON; keep the text
    }
    return { status: response.status, body: parsed };
  };
}
