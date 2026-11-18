import { createHash } from "node:crypto";
import type { InStatement } from "@libsql/client";
import { databaseLabel, getDb, type Db } from "./db.js";
import { eventDefinition, foldEvents, type CaseState, type RecordedEvent } from "./engine.js";
import { ownershipGaps } from "./ownership.js";
// TICKET-10
import { composeMessage } from "./outreach/ladder.js";

// TICKET-17: three cases, all fictional. Running this file twice must not duplicate
// anything, so every row has a fixed id and every write is an upsert.

const NOW = "2026-11-17T11:42:00+07:00";
const DEMO_DAY_ZERO = "2026-11-17T11:42:00+07:00";

// TICKET-08: fictional providers. Clinic A is where CX-1002 started, clinic B where its
// patient moved; hospital B received (and rejected) its referral.
const PROVIDERS = [
  { id: "prov_clinic_a", name: "Clinic A", kind: "clinic" },
  { id: "prov_clinic_b", name: "Clinic B", kind: "clinic" },
  { id: "prov_hospital_b", name: "Hospital B", kind: "hospital" },
  { id: "prov_endo_e", name: "Endoscopy Unit E", kind: "endoscopy_unit" },
  // TICKET-18: where the mammography cases are referred for diagnostic assessment. The
  // schema's provider kinds have no imaging centre, so it is a hospital department.
  { id: "prov_breast_c", name: "Breast Imaging Centre C", kind: "hospital" },
];

const ACTORS = [
  { id: "act_001", role: "coordination_staff", display_name: "R. Haddad", provider_id: "prov_clinic_a" },
  { id: "act_002", role: "navigator", display_name: "Nur H.", provider_id: "prov_clinic_b" },
  { id: "act_003", role: "responsible_physician", display_name: "Dr. Fulan", provider_id: "prov_clinic_b" },
  { id: "act_004", role: "program_manager", display_name: "A. Al Suwaidi", provider_id: null },
  { id: "act_005", role: "coordination_staff", display_name: "S. Al Ali", provider_id: "prov_clinic_b" },
  // TICKET-11: the receiving physician a consultation on CX-1002 is addressed to.
  { id: "act_006", role: "responsible_physician", display_name: "Dr. Fulana", provider_id: "prov_hospital_b" },
  { id: "act_system", role: "system", display_name: "system", provider_id: null },
  // TICKET-10: the patient, acting only through the link in the outreach message.
  { id: "act_patient", role: "patient", display_name: "Patient (via link)", provider_id: null },
  // TICKET-18: the breast care navigator who owns the mammography recalls, and the
  // physician at the breast imaging centre who takes the cases that need a biopsy.
  { id: "act_007", role: "navigator", display_name: "L. Mansour", provider_id: "prov_clinic_b" },
  { id: "act_008", role: "responsible_physician", display_name: "Dr. Hessa", provider_id: "prov_breast_c" },
];

// The specialty a colonoscopy referral is addressed to, as a SNOMED CT coding.
const GASTROENTEROLOGY = {
  system: "http://snomed.info/sct",
  code: "394584008",
  display: "Gastroenterology",
};

// TICKET-18: the specialty a diagnostic breast assessment referral is addressed to.
const RADIOLOGY = {
  system: "http://snomed.info/sct",
  code: "394914008",
  display: "Radiology",
};

// ---- TICKET-10: CX-1001's automated message ------------------------------------------
// The silent patient got the ladder's step 1 on 16 Nov and has not answered. The text is
// composed by the same function the ladder uses, so the seeded message is exactly what
// the template sends. The token is fixed so the demo link is the same after every reset.
export const CX1001_TOKEN = "hq7m3kx9va";
const CX1001_RUN = "result_received@2026-11-15T09:12:00+07:00";
const CX1001_MESSAGE_AT = "2026-11-16T10:20:00+07:00";
const CX1001_MESSAGE = composeMessage(
  { patient_name: "Y. Al Hammadi", patient_language: "ar" },
  CX1001_TOKEN,
  CX1001_MESSAGE_AT,
);
// ---- end TICKET-10 --------------------------------------------------------------------

type SeedEvent = {
  id: string;
  type: string;
  actor_id: string;
  at: string;
  summary: string;
  // Extra payload the engine reads back on replay: the owner a creation or hand-over
  // names, the outcome a closure proposal carries.
  payload?: Record<string, unknown>;
};

type SeedCase = {
  id: string;
  patient_name: string;
  patient_age: number;
  patient_language: string;
  // TICKET-08: what incoming FHIR resources are matched on. Fictional by construction.
  patient_identifier: string;
  // TICKET-18: the template the case runs; the FIT pathway when absent.
  pathway_id?: string;
  // What the story says the case looks like at day 0. The seed does not write these: it
  // replays `events` through the engine and refuses to run if the replay disagrees, so
  // the cached columns are always what rebuildCase would produce (TICKET-03).
  expect: {
    stage: string;
    owner_actor_id: string | null;
    final_outcome: string | null;
  };
  events: SeedEvent[];
};

const CASES: SeedCase[] = [
  {
    // 1. The silent patient: the result is in and the automated Arabic message (TICKET-10
    // step 1) goes unanswered, so the patient has not been told yet and the case sits at
    // result_received. Advancing the clock climbs the ladder: staff call, then navigator.
    id: "CX-1001",
    patient_name: "Y. Al Hammadi",
    patient_age: 58,
    patient_language: "ar",
    patient_identifier: "NX-P-1001",
    expect: { stage: "result_received", owner_actor_id: "act_005", final_outcome: null },
    events: [
      {
        id: "e_1001_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-11-15T09:12:00+07:00",
        summary: "Case created from FIT result 4412/26",
        payload: { owner_actor_id: "act_005", provider_id: "prov_clinic_b" },
      },
      {
        id: "e_1001_2",
        type: "outreach_message_sent",
        actor_id: "act_system",
        at: CX1001_MESSAGE_AT,
        summary: CX1001_MESSAGE.summary,
        payload: { run_id: CX1001_RUN, step: "message", ...CX1001_MESSAGE },
      },
    ],
  },
  {
    // 2. Referral rejected by the receiving hospital: the case goes back to the step
    // before the referral with no owner (TICKET-08 trigger 1). The demo then records the
    // patient's move to clinic B, asks hospital B a consultation and answers it, which
    // gives the case an owner again (docs/api.md, "Demo case 2 through the API").
    id: "CX-1002",
    patient_name: "R. Kumar",
    patient_age: 47,
    patient_language: "en",
    patient_identifier: "NX-P-1002",
    expect: { stage: "patient_notified", owner_actor_id: null, final_outcome: null },
    events: [
      {
        id: "e_1002_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-11-12T08:00:00+07:00",
        summary: "Case created from FIT result 4377/26 at clinic A",
        payload: { owner_actor_id: "act_001", provider_id: "prov_clinic_a" },
      },
      {
        id: "e_1002_2",
        type: "patient_notified",
        actor_id: "act_001",
        at: "2026-11-13T09:30:00+07:00",
        summary: "Patient told the result by phone and agreed to a colonoscopy",
      },
      {
        id: "e_1002_3",
        type: "referral_sent",
        actor_id: "act_001",
        at: "2026-11-14T10:00:00+07:00",
        summary: "Referral sent to hospital B through e-Referral",
        payload: {
          referral: {
            referral_id: "REF-4377-1",
            from_provider_id: "prov_clinic_a",
            to_provider_id: "prov_hospital_b",
            status: "pending",
            priority: "routine",
            specialty: GASTROENTEROLOGY,
          },
        },
      },
      {
        id: "e_1002_4",
        type: "referral_rejected",
        actor_id: "act_system",
        at: "2026-11-16T15:40:00+07:00",
        summary: "Referral rejected by hospital B: colonoscopy request incomplete",
        payload: {
          previous_owner_actor_id: "act_001",
          reason: "Colonoscopy request incomplete (hospital B)",
        },
      },
    ],
  },
  {
    // 3. "Done" that is not done: every step was recorded as complete and closure was
    // proposed, but the colonoscopy report says the caecum was never reached. The
    // cached verification proposes reopening; the physician has not decided yet.
    id: "CX-1003",
    patient_name: "L. Fernandes",
    patient_age: 52,
    patient_language: "en",
    patient_identifier: "NX-P-1003",
    expect: {
      stage: "closure_proposed",
      owner_actor_id: "act_003",
      final_outcome: "returned_to_routine_screening",
    },
    events: [
      {
        id: "e_1003_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-10-14T09:00:00+07:00",
        summary: "Case created from FIT result 4302/26",
        payload: { owner_actor_id: "act_005", provider_id: "prov_clinic_b" },
      },
      {
        id: "e_1003_2",
        type: "patient_notified",
        actor_id: "act_005",
        at: "2026-10-15T10:30:00+07:00",
        summary: "Patient told the result in clinic",
      },
      {
        id: "e_1003_3",
        type: "referral_sent",
        actor_id: "act_005",
        at: "2026-10-16T09:00:00+07:00",
        summary: "Referral sent to the endoscopy unit through e-Referral",
        payload: {
          referral: {
            referral_id: "REF-4302-1",
            from_provider_id: "prov_clinic_b",
            to_provider_id: "prov_endo_e",
            status: "pending",
            priority: "routine",
            specialty: GASTROENTEROLOGY,
          },
        },
      },
      {
        id: "e_1003_4",
        type: "referral_accepted",
        actor_id: "act_system",
        at: "2026-10-17T14:00:00+07:00",
        summary: "Endoscopy unit accepted the referral",
      },
      {
        id: "e_1003_5",
        type: "colonoscopy_booked",
        actor_id: "act_005",
        at: "2026-10-19T11:00:00+07:00",
        summary: "Colonoscopy booked for 5 Nov",
      },
      {
        id: "e_1003_6",
        type: "colonoscopy_performed",
        actor_id: "act_005",
        at: "2026-11-05T10:00:00+07:00",
        summary: "Colonoscopy recorded as completed",
      },
      {
        id: "e_1003_7",
        type: "pathology_ordered",
        actor_id: "act_005",
        at: "2026-11-05T10:30:00+07:00",
        summary: "Pathology step opened by the endoscopy unit",
      },
      {
        id: "e_1003_8",
        type: "pathology_received",
        actor_id: "act_system",
        at: "2026-11-10T09:00:00+07:00",
        summary: "Pathology return received: no specimen submitted",
      },
      {
        id: "e_1003_9",
        type: "owner_assigned",
        actor_id: "act_005",
        at: "2026-11-10T09:05:00+07:00",
        summary: "Handed to Dr. Fulan for the closure decision",
        payload: { owner_actor_id: "act_003", previous_owner_actor_id: "act_005" },
      },
      {
        id: "e_1003_10",
        type: "closure_proposed",
        actor_id: "act_005",
        at: "2026-11-12T09:00:00+07:00",
        summary: "Closure proposed: returned to routine screening",
        payload: { outcome: "returned_to_routine_screening" },
      },
      {
        id: "e_1003_11",
        type: "extraction_completed",
        actor_id: "act_system",
        at: "2026-11-17T09:14:00+07:00",
        summary: "2 findings extracted with citations; proposal reopen",
      },
    ],
  },
];

// ---- TICKET-18: three mammography cases on the second pathway ------------------------
// Fictional, on server/pathways/mammography-biopsy.json, which is a configuration
// demonstration and not clinically reviewed. They run on the same engine and sit in the
// same worklist as the FIT cases. Owned by the breast care navigator and the breast
// imaging centre's physician, so the coordinator's register is the FIT one it was.
// Their deadlines fall after day 2 on purpose: advancing the demo clock 3 days escalates
// MM-2001, 4 days escalates MM-2002.
const MAMMOGRAPHY = "mammography-biopsy";

const MAMMOGRAPHY_CASES: SeedCase[] = [
  {
    // Recalled on day 0 but the assessment referral has not gone out: due 20 Nov 09:00.
    id: "MM-2001",
    patient_name: "F. Al Mazrouei",
    patient_age: 49,
    patient_language: "ar",
    patient_identifier: "NX-P-2001",
    pathway_id: MAMMOGRAPHY,
    expect: { stage: "patient_recalled", owner_actor_id: "act_007", final_outcome: null },
    events: [
      {
        id: "e_2001_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-11-14T09:00:00+07:00",
        summary: "Case created from screening mammogram 8812/26: recall for assessment",
        payload: { owner_actor_id: "act_007", provider_id: "prov_clinic_b" },
      },
      {
        id: "e_2001_2",
        type: "patient_recalled",
        actor_id: "act_007",
        at: "2026-11-17T09:00:00+07:00",
        summary: "Patient told the result by phone and agreed to come for assessment",
      },
    ],
  },
  {
    // Imaging asked for tissue; the core biopsy was taken on 14 Nov and the pathology is
    // due 21 Nov 10:00.
    id: "MM-2002",
    patient_name: "J. Santos",
    patient_age: 56,
    patient_language: "en",
    patient_identifier: "NX-P-2002",
    pathway_id: MAMMOGRAPHY,
    expect: { stage: "biopsy_done", owner_actor_id: "act_008", final_outcome: null },
    events: [
      {
        id: "e_2002_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-10-27T10:00:00+07:00",
        summary: "Case created from screening mammogram 8790/26: recall for assessment",
        payload: { owner_actor_id: "act_007", provider_id: "prov_clinic_b" },
      },
      {
        id: "e_2002_2",
        type: "patient_recalled",
        actor_id: "act_007",
        at: "2026-10-28T09:00:00+07:00",
        summary: "Patient told the result in clinic",
      },
      {
        id: "e_2002_3",
        type: "assessment_referred",
        actor_id: "act_007",
        at: "2026-10-29T10:00:00+07:00",
        summary: "Referral for diagnostic assessment sent to Breast Imaging Centre C",
        payload: {
          referral: {
            referral_id: "REF-8790-1",
            from_provider_id: "prov_clinic_b",
            to_provider_id: "prov_breast_c",
            status: "pending",
            priority: "asap",
            specialty: RADIOLOGY,
          },
        },
      },
      {
        id: "e_2002_4",
        type: "assessment_accepted",
        actor_id: "act_system",
        at: "2026-10-30T12:00:00+07:00",
        summary: "Breast Imaging Centre C accepted the referral",
      },
      {
        id: "e_2002_5",
        type: "diagnostic_imaging_booked",
        actor_id: "act_007",
        at: "2026-10-30T12:30:00+07:00",
        summary: "Diagnostic mammogram and ultrasound booked for 6 Nov",
      },
      {
        id: "e_2002_6",
        type: "diagnostic_imaging_done",
        actor_id: "act_system",
        at: "2026-11-06T11:00:00+07:00",
        summary: "Diagnostic imaging done: biopsy recommended",
      },
      {
        id: "e_2002_7",
        type: "owner_assigned",
        actor_id: "act_007",
        at: "2026-11-06T12:00:00+07:00",
        summary: "Handed to Dr. Hessa for the biopsy and its pathology",
        payload: { owner_actor_id: "act_008", previous_owner_actor_id: "act_007" },
      },
      {
        id: "e_2002_8",
        type: "biopsy_performed",
        actor_id: "act_008",
        at: "2026-11-14T10:00:00+07:00",
        summary: "Ultrasound-guided core biopsy performed",
      },
    ],
  },
  {
    // Closed: diagnostic imaging found nothing that needs tissue, so the physician closed
    // the case with the imaging report as evidence.
    id: "MM-2003",
    patient_name: "A. Rahimi",
    patient_age: 61,
    patient_language: "en",
    patient_identifier: "NX-P-2003",
    pathway_id: MAMMOGRAPHY,
    expect: { stage: "closed", owner_actor_id: "act_008", final_outcome: "returned_to_routine_screening" },
    events: [
      {
        id: "e_2003_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-10-06T09:00:00+07:00",
        summary: "Case created from screening mammogram 8701/26: recall for assessment",
        payload: { owner_actor_id: "act_007", provider_id: "prov_clinic_b" },
      },
      {
        id: "e_2003_2",
        type: "patient_recalled",
        actor_id: "act_007",
        at: "2026-10-07T10:00:00+07:00",
        summary: "Patient told the result by phone",
      },
      {
        id: "e_2003_3",
        type: "assessment_referred",
        actor_id: "act_007",
        at: "2026-10-08T09:30:00+07:00",
        summary: "Referral for diagnostic assessment sent to Breast Imaging Centre C",
        payload: {
          referral: {
            referral_id: "REF-8701-1",
            from_provider_id: "prov_clinic_b",
            to_provider_id: "prov_breast_c",
            status: "pending",
            priority: "routine",
            specialty: RADIOLOGY,
          },
        },
      },
      {
        id: "e_2003_4",
        type: "assessment_accepted",
        actor_id: "act_system",
        at: "2026-10-09T14:00:00+07:00",
        summary: "Breast Imaging Centre C accepted the referral",
      },
      {
        id: "e_2003_5",
        type: "diagnostic_imaging_booked",
        actor_id: "act_007",
        at: "2026-10-09T15:00:00+07:00",
        summary: "Diagnostic mammogram and ultrasound booked for 16 Oct",
      },
      {
        id: "e_2003_6",
        type: "diagnostic_imaging_done",
        actor_id: "act_system",
        at: "2026-10-16T10:00:00+07:00",
        summary: "Diagnostic imaging done: benign finding, no biopsy recommended",
      },
      {
        id: "e_2003_7",
        type: "owner_assigned",
        actor_id: "act_007",
        at: "2026-10-16T11:00:00+07:00",
        summary: "Handed to Dr. Hessa for the closure decision",
        payload: { owner_actor_id: "act_008", previous_owner_actor_id: "act_007" },
      },
      {
        id: "e_2003_8",
        type: "closure_proposed",
        actor_id: "act_008",
        at: "2026-10-17T09:00:00+07:00",
        summary: "Closure proposed: returned to routine screening",
        payload: { outcome: "returned_to_routine_screening" },
      },
      {
        id: "e_2003_9",
        type: "closure_confirmed",
        actor_id: "act_008",
        at: "2026-10-17T15:00:00+07:00",
        summary: "Closure confirmed with the diagnostic imaging report as evidence",
        payload: { finalises: true },
      },
    ],
  },
];

const MAMMOGRAPHY_IMAGING_REPORT =
  "Synthetic report. Diagnostic mammography and targeted ultrasound of the recalled area. " +
  "Findings are benign. No biopsy recommended. Return to routine screening.";
// ---- end TICKET-18 ---------------------------------------------------------------------

const ROLE_OF = new Map(ACTORS.map((a) => [a.id, a.role]));

function recorded(e: SeedEvent): RecordedEvent {
  return {
    type: e.type,
    actor_id: e.actor_id,
    actor_role: ROLE_OF.get(e.actor_id) ?? "system",
    occurred_at: e.at,
    payload: { ...(e.payload ?? {}), summary: e.summary },
  };
}

// The cached columns for one seed case, computed the way rebuildCase computes them.
function replay(c: SeedCase): CaseState {
  const state = foldEvents(c.events.map(recorded), c.pathway_id);
  if (state === null) throw new Error(`Seed case ${c.id} has no case creation event.`);
  const mismatch = (["stage", "owner_actor_id", "final_outcome"] as const).filter(
    (key) => state[key] !== c.expect[key],
  );
  if (mismatch.length > 0) {
    throw new Error(
      `Seed case ${c.id} replays to ${JSON.stringify(state)}, which disagrees with its story on ` +
        mismatch.join(", "),
    );
  }
  return state;
}

// TICKET-08: the referral rows and ownership gaps a seed history implies, computed from
// its events the way the write path produces them (referral payloads insert, events the
// template marks with referral_status update the latest referral, ownershipGaps folds).
function ownershipRows(db: Db, c: SeedCase): InStatement[] {
  const out: InStatement[] = [];
  const referrals: Record<string, unknown>[] = [];

  for (const e of c.events) {
    const status = eventDefinition(e.type, c.pathway_id)?.referral_status ?? null;
    const latest = referrals.at(-1);
    if (status !== null && latest) {
      latest.status = status;
      latest.updated_at = e.at;
    }
    const referral = e.payload?.referral as
      | { referral_id: string; from_provider_id: string | null; to_provider_id: string; status: string; priority: string; specialty: { system: string; code: string; display: string } }
      | undefined;
    if (referral) {
      referrals.push({
        id: referral.referral_id,
        case_id: c.id,
        from_provider_id: referral.from_provider_id,
        to_provider_id: referral.to_provider_id,
        status: referral.status,
        priority: referral.priority,
        specialty_system: referral.specialty.system,
        specialty_code: referral.specialty.code,
        specialty_display: referral.specialty.display,
        replaces_referral_id: (latest?.id as string | undefined) ?? null,
        sent_event_id: e.id,
        sent_at: e.at,
        updated_at: e.at,
      });
    }
  }

  const upsertReferral = db.prepare(
    `INSERT INTO referrals (
       id, case_id, from_provider_id, to_provider_id, status, priority, specialty_system,
       specialty_code, specialty_display, replaces_referral_id, sent_event_id, sent_at, updated_at
     ) VALUES (
       @id, @case_id, @from_provider_id, @to_provider_id, @status, @priority, @specialty_system,
       @specialty_code, @specialty_display, @replaces_referral_id, @sent_event_id, @sent_at, @updated_at
     )
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
  );
  for (const row of referrals) out.push(upsertReferral.bind(row as Record<string, string | null>));

  const upsertGap = db.prepare(
    `INSERT INTO ownership_gaps (
       id, case_id, trigger_event_id, trigger_type, reason, previous_owner_actor_id, unowned_at,
       owner_event_id, owner_event_type, owner_actor_id, owned_at, hours_to_owner
     ) VALUES (
       @id, @case_id, @trigger_event_id, @trigger_type, @reason, @previous_owner_actor_id, @unowned_at,
       @owner_event_id, @owner_event_type, @owner_actor_id, @owned_at, @hours_to_owner
     )
     ON CONFLICT(id) DO UPDATE SET
       owner_event_id = excluded.owner_event_id, owner_event_type = excluded.owner_event_type,
       owner_actor_id = excluded.owner_actor_id, owned_at = excluded.owned_at,
       hours_to_owner = excluded.hours_to_owner`,
  );
  for (const gap of ownershipGaps(c.events.map(recorded), c.pathway_id)) {
    const trigger = c.events[gap.trigger_index];
    if (!trigger) continue;
    out.push(
      upsertGap.bind({
        id: `g_${trigger.id}`,
        case_id: c.id,
        trigger_event_id: trigger.id,
        trigger_type: gap.trigger_type,
        reason: gap.reason,
        previous_owner_actor_id: gap.previous_owner_actor_id,
        unowned_at: gap.unowned_at,
        owner_event_id: gap.owner_index === null ? null : (c.events[gap.owner_index]?.id ?? null),
        owner_event_type: gap.owner_event_type,
        owner_actor_id: gap.owner_actor_id,
        owned_at: gap.owned_at,
        hours_to_owner: gap.hours_to_owner,
      }),
    );
  }
  return out;
}

const REPORT_TEXT =
  "Procedure: colonoscopy. Preparation was inadequate. The cecum was not reached. " +
  "No polyp identified in the examined segment. Recommend repeat examination.";

// Offsets are located in the text, never typed by hand: a citation that points at the
// wrong sentence is worse than no citation, and a hardcoded offset silently rots.
function offsetOf(quote: string): [number, number] {
  const start = REPORT_TEXT.indexOf(quote);
  if (start < 0) throw new Error(`Seed quote not found in report text: ${quote}`);
  return [start, start + quote.length];
}

const CACHED_FIELDS = [
  {
    key: "adequate_prep",
    value: "no",
    quote: "Preparation was inadequate.",
    quote_offset: offsetOf("Preparation was inadequate."),
    source: "colonoscopy-report-05-11.pdf",
    read_at: "2026-11-17T09:14:00+07:00",
    validated: true,
  },
  {
    key: "complete_exam",
    value: "no",
    quote: "The cecum was not reached.",
    quote_offset: offsetOf("The cecum was not reached."),
    source: "colonoscopy-report-05-11.pdf",
    read_at: "2026-11-17T09:14:00+07:00",
    validated: true,
  },
  {
    key: "pathology_available",
    value: "unknown",
    quote: null,
    quote_offset: [0, 0],
    source: "colonoscopy-report-05-11.pdf",
    read_at: "2026-11-17T09:14:00+07:00",
    validated: false,
  },
];

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function seed(
  target?: Db,
): Promise<{ actors: number; cases: number; events: number }> {
  const db = target ?? (await getDb());
  const statements: InStatement[] = [];

  const upsertProvider = db.prepare(
    `INSERT INTO providers (id, name, kind) VALUES (@id, @name, @kind)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind`,
  );

  const upsertActor = db.prepare(
    `INSERT INTO actors (id, role, display_name, provider_id)
     VALUES (@id, @role, @display_name, @provider_id)
     ON CONFLICT(id) DO UPDATE SET role = excluded.role, display_name = excluded.display_name,
       provider_id = excluded.provider_id`,
  );

  const upsertCase = db.prepare(
    `INSERT INTO cases (
       id, patient_name, patient_age, patient_language, pathway_id,
       owner_actor_id, stage, status, final_outcome, stage_entered_at, created_at, updated_at,
       provider_id, patient_identifier
     ) VALUES (
       @id, @patient_name, @patient_age, @patient_language, @pathway_id,
       @owner_actor_id, @stage, @status, @final_outcome, @stage_entered_at, @created_at, @updated_at,
       @provider_id, @patient_identifier
     )
     ON CONFLICT(id) DO UPDATE SET
       provider_id = excluded.provider_id,
       patient_identifier = excluded.patient_identifier,
       patient_name = excluded.patient_name,
       patient_age = excluded.patient_age,
       patient_language = excluded.patient_language,
       owner_actor_id = excluded.owner_actor_id,
       stage = excluded.stage,
       status = excluded.status,
       final_outcome = excluded.final_outcome,
       stage_entered_at = excluded.stage_entered_at,
       updated_at = excluded.updated_at`,
  );

  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO events (
       id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload
     ) VALUES (
       @id, @case_id, @type, @actor_id, @actor_role, @occurred_at, @recorded_at, @payload
     )`,
  );

  const upsertDocument = db.prepare(
    `INSERT INTO documents (id, case_id, kind, title, text)
     VALUES (@id, @case_id, @kind, @title, @text)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, text = excluded.text`,
  );

  const upsertExtraction = db.prepare(
    `INSERT INTO extractions (
       id, case_id, document_id, prompt_version, model, proposal,
       proposal_reason, fields, text_hash, created_at
     ) VALUES (
       @id, @case_id, @document_id, @prompt_version, @model, @proposal,
       @proposal_reason, @fields, @text_hash, @created_at
     )
     ON CONFLICT(text_hash) DO UPDATE SET
       proposal = excluded.proposal,
       proposal_reason = excluded.proposal_reason,
       fields = excluded.fields`,
  );

  const upsertTask = db.prepare(
    `INSERT INTO tasks (id, case_id, kind, owner_actor_id, due_at, status)
     VALUES (@id, @case_id, @kind, @owner_actor_id, @due_at, @status)
     ON CONFLICT(id) DO UPDATE SET
       owner_actor_id = excluded.owner_actor_id,
       due_at = excluded.due_at,
       status = excluded.status`,
  );

  // One atomic batch: a seed that fails halfway leaves the database as it was.
  {
    for (const p of PROVIDERS) statements.push(upsertProvider.bind(p));
    for (const a of ACTORS) statements.push(upsertActor.bind(a));

    for (const c of [...CASES, ...MAMMOGRAPHY_CASES]) {
      const state = replay(c);
      statements.push(upsertCase.bind({
        provider_id: state.provider_id ?? null,
        patient_identifier: c.patient_identifier,
        id: c.id,
        patient_name: c.patient_name,
        patient_age: c.patient_age,
        patient_language: c.patient_language,
        pathway_id: c.pathway_id ?? "fit-colonoscopy",
        owner_actor_id: state.owner_actor_id,
        stage: state.stage,
        status: state.status,
        final_outcome: state.final_outcome,
        stage_entered_at: state.stage_entered_at,
        created_at: c.events[0]?.at ?? NOW,
        updated_at: NOW,
      }));

      for (const e of c.events) {
        const event = recorded(e);
        statements.push(insertEvent.bind({
          id: e.id,
          case_id: c.id,
          type: event.type,
          actor_id: event.actor_id,
          actor_role: event.actor_role,
          occurred_at: event.occurred_at,
          recorded_at: e.at,
          payload: JSON.stringify(event.payload),
        }));
      }

      // TICKET-08 rows derived from the same history the engine replays.
      statements.push(...ownershipRows(db, c));
    }

    statements.push(upsertDocument.bind({
      id: "d_1003",
      case_id: "CX-1003",
      kind: "colonoscopy",
      title: "Colonoscopy report",
      text: REPORT_TEXT,
    }));

    // Cached so the demo never needs the network (TICKET-17).
    statements.push(upsertExtraction.bind({
      id: "x_1003",
      case_id: "CX-1003",
      document_id: "d_1003",
      prompt_version: "v1",
      model: "deepseek/deepseek-v4.1-flash-1017",
      proposal: "reopen",
      proposal_reason: "Incomplete exam and inadequate prep",
      fields: JSON.stringify(CACHED_FIELDS),
      text_hash: textHash(REPORT_TEXT),
      created_at: "2026-11-17T09:14:00+07:00",
    }));

    // ---- TICKET-10: the link and the fired message step for CX-1001 ----------------
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO outreach_links (token, case_id, created_at) VALUES (?, ?, ?)")
        .bind(CX1001_TOKEN, "CX-1001", CX1001_MESSAGE_AT),
      db
        .prepare(
          `INSERT OR IGNORE INTO outreach_steps
             (id, case_id, run_id, step, fired_at, reason, task_id, event_id)
           VALUES (?, ?, ?, 'message', ?, 'case_at_stage', NULL, ?)`,
        )
        .bind("os_1001_message", "CX-1001", CX1001_RUN, CX1001_MESSAGE_AT, "e_1001_2"),
    );
    // ---- end TICKET-10 ------------------------------------------------------------

    // The owner's standing to-do on the case (tell the patient). The ladder's own call and
    // navigator tasks are created by tick() when their deadlines pass.
    statements.push(upsertTask.bind({
      id: "t_1001_outreach",
      case_id: "CX-1001",
      kind: "patient_outreach",
      owner_actor_id: "act_005",
      due_at: "2026-11-18T09:00:00+07:00",
      status: "open",
    }));
    // TICKET-08: the assign-owner task a rejected referral opens, for coordination staff
    // at the case's provider (clinic A), due the template's 24 hours after the trigger.
    statements.push(upsertTask.bind({
      id: "t_1002_owner",
      case_id: "CX-1002",
      kind: "assign_owner",
      owner_actor_id: "act_001",
      due_at: "2026-11-17T15:40:00+07:00",
      status: "open",
    }));
    statements.push(upsertTask.bind({
      id: "t_1003_closure",
      case_id: "CX-1003",
      kind: "confirm_closure",
      owner_actor_id: "act_003",
      due_at: "2026-11-17T14:00:00+07:00",
      status: "open",
    }));

    // TICKET-18: the evidence MM-2003 was closed on.
    statements.push(upsertDocument.bind({
      id: "d_2003",
      case_id: "MM-2003",
      kind: "diagnostic_imaging",
      title: "Diagnostic imaging report",
      text: MAMMOGRAPHY_IMAGING_REPORT,
    }));
  }

  await db.batch(statements);

  const count = async (table: string) =>
    (await db.prepare(`SELECT count(*) AS n FROM ${table}`).get<{ n: number }>())?.n ?? 0;

  return {
    actors: await count("actors"),
    cases: await count("cases"),
    events: await count("events"),
  };
}

// `tsx server/seed.ts` prints what it did; importing it (tests) just gets the function.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("server/seed.ts")) {
  const result = await seed();
  console.log(`seeded ${databaseLabel()}`);
  console.log(
    `actors=${result.actors} cases=${result.cases} events=${result.events} demo_day=${DEMO_DAY_ZERO}`,
  );
}
