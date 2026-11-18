import { DEMO_START, addHours } from "../../server/clock.js";
import {
  CODE_SYSTEM,
  EXT,
  SYNTHETIC_TAG,
  type Appointment,
  type Bundle,
  type DiagnosticReport,
  type Observation,
  type Patient,
  type Procedure,
  type Resource,
  type ServiceRequest,
} from "./fhir.js";
import { Params } from "./params.js";
import { Rng } from "./prng.js";

// Everything in this file is pure: the same parameters and seed give the same cohort. It
// plans each patient's journey through the pathway (where they stall, how long each step
// takes), then writes it out as FHIR resources plus the few workflow facts FHIR has no
// resource for. Nothing here touches a database; ingest.ts feeds the output to the engine.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const NOW_MS = Date.parse(DEMO_START);
export const CASE_PREFIX = "SY-";

export function isoAt(ms: number): string {
  return addHours(DEMO_START, (ms - NOW_MS) / HOUR);
}

type PathologyOutcome =
  | "returned_to_routine_screening"
  | "surveillance_scheduled"
  | "oncology_accepted_therapy_started";

type Step =
  | { k: "notified"; at: number }
  | { k: "referral"; at: number; kind: "initial" | "re-referral"; provider: number }
  | { k: "rejected"; at: number; reason: "rejected" | "patient_changed_provider" }
  | { k: "reowned"; at: number }
  | { k: "accepted"; at: number }
  | { k: "booked"; at: number; start: number; noShow: boolean }
  | { k: "performed"; at: number; complete: boolean }
  | { k: "incomplete"; at: number }
  | { k: "handover"; at: number }
  | { k: "path_ordered"; at: number }
  | { k: "path_received"; at: number; result: PathologyOutcome }
  | { k: "proposed"; at: number; outcome: PathologyOutcome }
  | { k: "confirmed"; at: number; outcome: PathologyOutcome };

export type StepKind = Step["k"];

// A fact the engine needs that FHIR has no resource for: the programme's own workflow.
// `by` is a role, resolved to a real actor id at ingest.
export type WorkflowEvent = {
  at: string;
  type: "patient_notified" | "owner_assigned" | "procedure_incomplete" | "closure_proposed" | "closure_confirmed";
  by: "coordinator" | "physician";
  assignTo?: "coordinator" | "physician";
  outcome?: PathologyOutcome;
  summary: string;
};

export type GeneratedCase = {
  caseId: string;
  // Which coordinator holds the case, as an index into the coordinators the database has.
  coordinatorSlot: number;
  bundle: Bundle;
  workflow: WorkflowEvent[];
  // For the funnel: the step kinds this case reached, in order. Derived from the plan, not
  // from the database.
  reached: StepKind[];
};

const LANGUAGE_DISPLAY: Record<string, string> = {
  ar: "Arabic",
  en: "English",
  ur: "Urdu",
  hi: "Hindi",
  ml: "Malayalam",
  tl: "Tagalog",
};

const PROVIDER_COUNT = 5;
const ENDOSCOPIST_COUNT = 8;

const two = (n: number) => String(n).padStart(2, "0");

function planCase(index: number, params: Params, seed: number): { steps: Step[]; fitAt: number; rng: Rng } {
  // One generator per case, so cases do not shift each other's draws when a parameter moves.
  const rng = new Rng((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  const fitAt =
    Math.floor((NOW_MS - rng.next() * params.num("fit_window_days") * DAY) / 60_000) * 60_000;
  // The draws that decide the patient come first and never depend on the pathway
  // parameters, so changing a drop-off cannot change who the patients are.
  return { steps: [], fitAt, rng };
}

function planJourney(
  fitAt: number,
  rng: Rng,
  params: Params,
  forcedDraws: number[],
): Step[] {
  const steps: Step[] = [];
  let t = fitAt;
  // forcedDraws are pre-drawn uniforms, one per decision, so a case that survives a
  // decision under one parameter value makes the same later draws under another.
  let d = 0;
  const draw = () => forcedDraws[d++] as number;
  const hours = (name: string) => {
    const p = params.time(name);
    return rng.lognormalHours(p.median_hours, p.sigma);
  };
  const push = (step: Step) => {
    steps.push(step);
  };
  const advance = (name: string) => {
    t += hours(name) * HOUR;
    return t;
  };
  const pathologyMix = params.mix("pathology_mix_") as Record<PathologyOutcome, number>;

  if (draw() < params.num("dropoff_result_to_notified")) return steps;
  push({ k: "notified", at: advance("time_result_to_notified") });
  if (draw() < params.num("dropoff_notified_to_referral")) return steps;

  const pChange = params.num("provider_change_share");
  const pReject = params.num("referral_rejection_share");
  const pSilent = params.num("dropoff_referral_unanswered");
  const maxAttempts = params.num("max_referral_attempts");
  let attempt = 1;
  for (;;) {
    push({
      k: "referral",
      at: advance(attempt === 1 ? "time_notified_to_referral" : "time_reowned_to_rereferral"),
      kind: attempt === 1 ? "initial" : "re-referral",
      provider: rng.int(0, PROVIDER_COUNT - 1),
    });
    const u = draw();
    if (u < pChange + pReject) {
      push({
        k: "rejected",
        at: advance("time_referral_to_response"),
        reason: u < pChange ? "patient_changed_provider" : "rejected",
      });
      if (attempt >= maxAttempts || draw() >= params.num("rereferral_after_rejection")) return steps;
      push({ k: "reowned", at: advance("time_rejection_to_reowned") });
      attempt += 1;
      continue;
    }
    if (u < pChange + pReject + pSilent) return steps;
    push({ k: "accepted", at: advance("time_referral_to_response") });
    break;
  }

  for (let colonoscopy = 1; colonoscopy <= 2; colonoscopy += 1) {
    if (draw() < params.num("dropoff_accepted_to_booked")) return steps;
    const bookedAt = advance("time_accepted_to_booked");
    const start = bookedAt + hours("time_booked_to_performed") * HOUR;
    const noShow = draw() < params.num("dropoff_booked_no_show");
    push({ k: "booked", at: bookedAt, start, noShow });
    if (noShow) return steps;
    t = start;
    const incomplete =
      draw() <
      params.num(colonoscopy === 1 ? "incomplete_procedure_share" : "repeat_procedure_incomplete_share");
    push({ k: "performed", at: start, complete: !incomplete });
    if (!incomplete) break;
    push({ k: "incomplete", at: advance("time_performed_to_incomplete") });
    if (colonoscopy === 2) return steps;
    // The case is back at "referral sent": the repeat referral needs an answer.
    if (draw() < params.num("dropoff_referral_unanswered")) return steps;
    push({ k: "accepted", at: advance("time_referral_to_response") });
  }

  push({ k: "handover", at: advance("time_performed_to_handover") });
  if (draw() < params.num("dropoff_performed_to_pathology_ordered")) return steps;
  push({ k: "path_ordered", at: advance("time_handover_to_pathology_ordered") });
  if (draw() < params.num("dropoff_pathology_ordered_to_received")) return steps;
  const result = pickWeighted(draw(), pathologyMix);
  push({ k: "path_received", at: advance("time_pathology_ordered_to_received"), result });
  if (draw() < params.num("dropoff_pathology_to_closure_proposed")) return steps;
  push({ k: "proposed", at: advance("time_pathology_to_closure_proposed"), outcome: result });
  if (draw() < params.num("dropoff_closure_proposed_to_confirmed")) return steps;
  push({ k: "confirmed", at: advance("time_closure_proposed_to_confirmed"), outcome: result });
  return steps;
}

function pickWeighted<T extends string>(u: number, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let at = u * total;
  for (const [key, weight] of entries) {
    at -= weight;
    if (at < 0) return key;
  }
  return (entries[entries.length - 1] as [T, number])[0];
}

function tag() {
  return { tag: [SYNTHETIC_TAG] };
}

function localDate(ms: number): string {
  return isoAt(ms).slice(0, 10);
}

function buildCase(index: number, params: Params, seed: number): GeneratedCase {
  const caseId = `${CASE_PREFIX}${String(index + 1).padStart(4, "0")}`;
  const number = String(index + 1).padStart(4, "0");
  const { fitAt, rng } = planCase(index, params, seed);

  // Patient first, then every pathway decision, all drawn up front in a fixed order.
  const age = rng.int(params.num("age_min"), params.num("age_max"));
  const language = rng.weighted(params.mix("language_mix_"));
  const birthOffsetDays = rng.int(0, 364);
  const coordinatorSlot = rng.int(0, 1_000_000);
  const forced = Array.from({ length: 40 }, () => rng.next());

  const allSteps = planJourney(fitAt, rng, params, forced);
  // The demo's "now" is a hard edge: a step planned after it has not happened yet.
  const steps = allSteps.filter((s) => s.at <= NOW_MS);

  const patientRef = { reference: `Patient/${caseId}-pt`, display: `Test Patient ${number}` };
  const fitDay = new Date(`${localDate(fitAt)}T00:00:00Z`);
  const birth = new Date(
    Date.UTC(fitDay.getUTCFullYear() - age, fitDay.getUTCMonth(), fitDay.getUTCDate()) -
      birthOffsetDays * DAY,
  );

  const resources: Resource[] = [];
  const patient: Patient = {
    resourceType: "Patient",
    id: `${caseId}-pt`,
    meta: tag(),
    identifier: [{ system: "https://nexyra.example/synthetic-id", value: `SYN-${number}` }],
    name: [{ text: `Test Patient ${number}`, family: `Patient ${number}`, given: ["Test"] }],
    birthDate: birth.toISOString().slice(0, 10),
    communication: [
      {
        language: {
          coding: [{ system: "urn:ietf:bcp:47", code: language, display: LANGUAGE_DISPLAY[language] }],
        },
        preferred: true,
      },
    ],
  };
  resources.push(patient);

  const observation: Observation = {
    resourceType: "Observation",
    id: `${caseId}-fit`,
    meta: tag(),
    status: "final",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "2335-8",
          display: "Hemoglobin.gastrointestinal [Presence] in Stool by Immunoassay",
        },
      ],
      text: "Faecal immunochemical test (FIT)",
    },
    subject: patientRef,
    effectiveDateTime: isoAt(fitAt),
    issued: isoAt(fitAt),
    valueCodeableConcept: { text: "Positive" },
    interpretation: [
      { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "POS", display: "Positive" }] },
    ],
  };
  resources.push(observation);

  const workflow: WorkflowEvent[] = [];
  const reached: StepKind[] = [];
  let referralCount = 0;
  let current: ServiceRequest | null = null;
  let providerName = "";
  let procedureCount = 0;
  let endoscopist = "";
  const bookedAppointments: Appointment[] = [];

  const referralRequest = (id: string, at: number, kind: string, who: string): ServiceRequest => ({
    resourceType: "ServiceRequest",
    id,
    meta: tag(),
    status: "active",
    intent: "order",
    code: { coding: [{ system: CODE_SYSTEM, code: "colonoscopy-referral" }], text: "Referral for colonoscopy" },
    subject: patientRef,
    authoredOn: isoAt(at),
    requester: { display: who },
    performer: [{ display: providerName }],
    extension: [{ url: EXT.referralKind, valueString: kind }],
  });

  for (const [i, step] of steps.entries()) {
    reached.push(step.k);
    switch (step.k) {
      case "notified":
        workflow.push({
          at: isoAt(step.at),
          type: "patient_notified",
          by: "coordinator",
          summary: `Patient told the result in ${LANGUAGE_DISPLAY[language]} and the next step`,
        });
        break;
      case "referral": {
        referralCount += 1;
        providerName = `Test Endoscopy Unit ${two(step.provider + 1)}`;
        current = referralRequest(`${caseId}-sr${referralCount}`, step.at, step.kind, "Test Coordinator");
        resources.push(current);
        break;
      }
      case "rejected":
        if (current) {
          current.status = "revoked";
          current.extension.push(
            { url: EXT.rejectedAt, valueDateTime: isoAt(step.at) },
            { url: EXT.rejectionReason, valueString: step.reason },
          );
        }
        break;
      case "reowned":
        workflow.push({
          at: isoAt(step.at),
          type: "owner_assigned",
          by: "coordinator",
          assignTo: "coordinator",
          summary: "Case taken over after the referral was rejected",
        });
        break;
      case "accepted":
        current?.extension.push({ url: EXT.acceptedAt, valueDateTime: isoAt(step.at) });
        break;
      case "booked": {
        const performedLater = steps.slice(i + 1).some((s) => s.k === "performed");
        const appointment: Appointment = {
          resourceType: "Appointment",
          id: `${caseId}-appt${bookedAppointments.length + 1}`,
          meta: tag(),
          status: performedLater ? "fulfilled" : step.noShow && step.start <= NOW_MS ? "noshow" : "booked",
          created: isoAt(step.at),
          start: isoAt(step.start),
          basedOn: current ? [{ reference: `ServiceRequest/${current.id}` }] : [],
          participant: [{ actor: { display: providerName }, status: "accepted" }],
        };
        bookedAppointments.push(appointment);
        resources.push(appointment);
        break;
      }
      case "performed": {
        procedureCount += 1;
        endoscopist = `Dr. Test Endoscopist ${two(rng.int(1, ENDOSCOPIST_COUNT))}`;
        const procedure: Procedure = {
          resourceType: "Procedure",
          id: `${caseId}-proc${procedureCount}`,
          meta: tag(),
          status: "completed",
          code: { coding: [{ system: CODE_SYSTEM, code: "colonoscopy" }], text: "Colonoscopy" },
          subject: patientRef,
          performedDateTime: isoAt(step.at),
          performer: [{ actor: { display: endoscopist } }],
          outcome: { text: step.complete ? "complete" : "incomplete" },
        };
        resources.push(procedure);
        const report: DiagnosticReport = {
          resourceType: "DiagnosticReport",
          id: `${caseId}-colrep${procedureCount}`,
          meta: tag(),
          status: "final",
          category: [{ coding: [{ system: CODE_SYSTEM, code: "colonoscopy" }] }],
          code: { coding: [{ system: CODE_SYSTEM, code: "colonoscopy-report" }], text: "Colonoscopy report" },
          subject: patientRef,
          issued: isoAt(step.at),
          performer: [{ display: endoscopist }],
          conclusion: step.complete
            ? "Synthetic report: complete examination to the caecum, adequate preparation."
            : "Synthetic report: examination incomplete, caecum not reached. Repeat examination recommended.",
          conclusionCode: [{ text: step.complete ? "complete" : "incomplete" }],
        };
        resources.push(report);
        break;
      }
      case "incomplete": {
        workflow.push({
          at: isoAt(step.at),
          type: "procedure_incomplete",
          by: "physician",
          summary: "Examination incomplete, a new referral is needed",
        });
        referralCount += 1;
        current = referralRequest(`${caseId}-sr${referralCount}`, step.at, "repeat-after-incomplete", endoscopist);
        resources.push(current);
        break;
      }
      case "handover":
        workflow.push({
          at: isoAt(step.at),
          type: "owner_assigned",
          by: "coordinator",
          assignTo: "physician",
          summary: "Handed to the responsible physician after the colonoscopy",
        });
        break;
      case "path_ordered": {
        const order: ServiceRequest = {
          resourceType: "ServiceRequest",
          id: `${caseId}-sr-path`,
          meta: tag(),
          status: "active",
          intent: "order",
          code: { coding: [{ system: CODE_SYSTEM, code: "pathology-order" }], text: "Pathology order" },
          subject: patientRef,
          authoredOn: isoAt(step.at),
          requester: { display: endoscopist },
          performer: [{ display: "Test Pathology Lab 01" }],
          extension: [],
        };
        resources.push(order);
        break;
      }
      case "path_received": {
        const text: Record<PathologyOutcome, string> = {
          returned_to_routine_screening: "Synthetic pathology: no significant pathology.",
          surveillance_scheduled: "Synthetic pathology: adenoma, surveillance indicated.",
          oncology_accepted_therapy_started: "Synthetic pathology: adenocarcinoma, oncology review.",
        };
        const report: DiagnosticReport = {
          resourceType: "DiagnosticReport",
          id: `${caseId}-pathrep`,
          meta: tag(),
          status: "final",
          category: [{ coding: [{ system: CODE_SYSTEM, code: "pathology" }] }],
          code: { coding: [{ system: CODE_SYSTEM, code: "pathology-report" }], text: "Pathology report" },
          subject: patientRef,
          issued: isoAt(step.at),
          performer: [{ display: "Test Pathology Lab 01" }],
          conclusion: text[step.result],
          conclusionCode: [{ coding: [{ system: CODE_SYSTEM, code: step.result }] }],
        };
        resources.push(report);
        break;
      }
      case "proposed":
        workflow.push({
          at: isoAt(step.at),
          type: "closure_proposed",
          by: "physician",
          outcome: step.outcome,
          summary: `Closure proposed: ${step.outcome.replace(/_/g, " ")}`,
        });
        break;
      case "confirmed":
        workflow.push({
          at: isoAt(step.at),
          type: "closure_confirmed",
          by: "physician",
          outcome: step.outcome,
          summary: "Responsible physician confirmed closure",
        });
        break;
    }
  }

  return {
    caseId,
    coordinatorSlot,
    bundle: {
      resourceType: "Bundle",
      type: "collection",
      id: `${caseId}-bundle`,
      meta: tag(),
      entry: resources.map((resource) => ({ resource })),
    },
    workflow,
    reached,
  };
}

export type CohortOptions = { overrides?: Record<string, number>; size?: number };

export function generateCohort(options: CohortOptions = {}): GeneratedCase[] {
  const params = Params.load(options.overrides);
  const seed = params.num("random_seed");
  const size = options.size ?? params.num("cohort_size");
  return Array.from({ length: size }, (_, index) => buildCase(index, params, seed));
}

// The funnel as counts of cases that reached each step at least once.
export function funnel(cohort: readonly GeneratedCase[]): Record<StepKind | "fit_positive", number> {
  const kinds: StepKind[] = [
    "notified",
    "referral",
    "rejected",
    "reowned",
    "accepted",
    "booked",
    "performed",
    "incomplete",
    "handover",
    "path_ordered",
    "path_received",
    "proposed",
    "confirmed",
  ];
  const out = { fit_positive: cohort.length } as Record<StepKind | "fit_positive", number>;
  for (const kind of kinds) out[kind] = cohort.filter((c) => c.reached.includes(kind)).length;
  return out;
}
