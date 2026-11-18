// Shapes from docs/api.md. Field names are copied from the contract; nothing here
// is a field the contract does not write.

export type Role =
  | "coordination_staff"
  | "navigator"
  | "responsible_physician"
  | "program_manager";

export type Actor = {
  actor_id: string;
  role: Role;
  display_name: string;
};

export type Clock = {
  now: string;
  is_demo: boolean;
  day: number;
  referral_limit_days?: number;
  // Display text from the server, e.g. "17 Nov 2026 · 11:42". The client prints it
  // rather than deriving a date, the same rule as stage_due_label.
  label?: string;
};

export type AdvanceResult = {
  clock: Clock;
  escalations: number;
  cases_advanced: number;
  escalations_per_role?: { role: Role; count: number }[];
};

export type CaseFilter = "late" | "unowned" | "awaiting_closure_confirmation";

export type CaseSummary = {
  case_id: string;
  patient: { display_name: string; age: number; language: string };
  stage: string;
  stage_label: string;
  owner: Actor | null;
  hours_left_stage: number | null;
  days_left_stage: number;
  days_left_referral_limit: number;
  flags: string[];
  flags_renderable: string[];
};

export type CaseListCounts = {
  open: number;
  unowned: number;
  past_deadline: number;
  awaiting_clinician: number;
  closed_this_week: number;
};

export type CaseListResponse = {
  clock: Clock;
  counts: CaseListCounts;
  cases: CaseSummary[];
};

export type TimelineEvent = {
  event_id: string;
  type: string;
  actor: Actor | null;
  occurred_at: string;
  recorded_at: string;
  summary: string;
  payload: Record<string, unknown>;
};

// TICKET-13 proposal vocabulary. Decided by rules in server/verify/proposal.ts, never by
// the model, and always shown as an AI proposal, never as a decision.
export type Proposal =
  | "reopen"
  | "wait_for_pathology"
  | "needs_human_reading"
  | "propose_closure";

export type VerificationSummary = {
  status: string;
  proposal: Proposal;
};

export type OutcomeOption = {
  key: string;
  label: string;
};

export type OutreachAttempt = {
  n: number;
  at: string;
  channel: "call" | "sms" | "letter";
  result: string;
  minutes: number;
};

// The closed set the engine sends as `available_actions` (server/vocabulary.ts, ACTIONS).
// A typo in a page's `includes(...)` is a compile error instead of a button that never shows.
export type Action =
  | "log_outreach"
  | "advance_case"
  | "assign_owner"
  | "answer_consultation"
  | "confirm_closure"
  | "reject_proposal"
  | "reopen_case"
  | "request_consultation";

// ---- TICKET-08 / TICKET-11: provider, ownership, referrals, consultations ------------

export type Provider = { provider_id: string; name: string };

export type ProviderOption = Provider & { kind: string };

export type OwnershipTrigger = {
  event_id: string | null;
  type: string;
  label: string;
  reason: string;
};

export type OwnershipGap = {
  trigger: OwnershipTrigger;
  previous_owner_actor_id: string | null;
  unowned_at: string;
  owned_at: string | null;
  owner_actor_id: string | null;
  owner_event_type: string | null;
  // null while the spell is still open.
  hours_to_owner: number | null;
};

export type Ownership = {
  state: "owned" | "unowned";
  unowned_since: string | null;
  gaps: OwnershipGap[];
};

export type Referral = {
  referral_id: string;
  from_provider_id: string | null;
  to_provider: Provider | null;
  // pending, accepted, rejected, expired or redirected
  status: string;
  // routine, asap or stat (the HL7 v2 referral priorities)
  priority: string;
  specialty: { system: string; code: string; display: string };
  replaces_referral_id: string | null;
  sent_at: string;
  updated_at: string;
};

export type ConsultationOutcome = "accepted" | "redirected" | "more_data_requested";

export type Consultation = {
  consultation_id: string;
  question: string;
  requested_by_actor_id: string;
  to_provider: Provider | null;
  to_actor_id: string | null;
  referral_id: string | null;
  requested_at: string;
  due_at: string;
  task_id: string;
  // open or answered
  status: string;
  outcome: ConsultationOutcome | null;
  answer_note: string | null;
  answered_by_actor_id: string | null;
  answered_at: string | null;
  hours_to_answer: number | null;
};

// Body of POST /api/consultations/{id}/answer.
export type ConsultationAnswer = {
  outcome: ConsultationOutcome;
  note?: string;
  owner_actor_id?: string;
  redirect_to_provider_id?: string;
};

// GET /api/unowned
export type UnownedRow = {
  case_id: string;
  patient: { display_name: string; age: number; language: string };
  stage: string;
  stage_label: string;
  provider: Provider | null;
  unowned_since: string;
  hours_unowned: number;
  unowned_label: string;
  trigger: OwnershipTrigger | null;
  previous_owner: { actor_id: string; display_name: string } | null;
  assign_owner_task: { task_id: string; owner: Actor | null; due_at: string | null } | null;
};

export type UnownedResponse = { clock: Clock; count: number; cases: UnownedRow[] };

// GET /api/ingest/unstitched. reason_code is one of no_patient_identifier,
// no_referral_reference, unknown_referral, patient_mismatch, case_closed.
export type UnstitchedItem = {
  unstitched_id: string;
  resource_type: string;
  resource_id: string;
  source_provider: Provider | null;
  patient_identifier: string | null;
  referral_id: string | null;
  reason_code: string;
  reason: string;
  received_at: string;
  recorded_at: string;
  // queued or stitched
  status: string;
  stitched_case_id: string | null;
};

export type UnstitchedResponse = { count: number; items: UnstitchedItem[] };

// ---- end TICKET-08 / TICKET-11 -------------------------------------------------------

export type CaseDetailResponse = {
  case: {
    case_id: string;
    // `identifier` is what incoming FHIR resources are matched on (TICKET-08).
    patient: { display_name: string; age: number; language: string; identifier?: string };
    stage: string;
    stage_label: string;
    owner: Actor | null;
    status: string;
    stage_due_label: string;
    final_outcome: string | null;
    outcomes: OutcomeOption[];
  };
  stages: { key: string; state: string; label: string; short_label: string }[];
  timeline: TimelineEvent[];
  documents: { document_id: string; kind: string; title: string }[];
  tasks: {
    task_id: string;
    kind: string;
    owner: Actor | null;
    due_at: string;
    status: string;
  }[];
  outreach_attempts: OutreachAttempt[];
  available_actions: Action[];
  verification: VerificationSummary;
  // TICKET-08 / TICKET-11
  provider: Provider | null;
  ownership: Ownership;
  referrals: Referral[];
  consultations: Consultation[];
};

export type VerificationField = {
  key: string;
  value: string;
  quote: string | null;
  quote_offset: [number, number];
  source: string;
  read_at: string;
  validated: boolean;
};

export type Verification = {
  report: { document_id: string; text: string };
  extraction: {
    prompt_version: string;
    model: string;
    fields: VerificationField[];
    proposal: Proposal;
    proposal_reason: string;
    // POST only (docs/api.md): the outcome a propose_closure asks the physician to confirm.
    proposed_outcome?: string | null;
  };
};

export type DelayReason = "fear" | "transport" | "cost" | "language" | "other";

export type OutreachInput = {
  outcome: string;
  delay_reason?: DelayReason;
  // The server accepts these too (docs/api.md, POST /api/cases/{id}/outreach); the
  // outreach screen already has a channel select, so it sends what it shows.
  channel?: OutreachAttempt["channel"];
  minutes?: number;
  // TICKET-10: whether the call reached the patient, and free text kept apart from the reason.
  connected?: boolean;
  note?: string;
};

// GET /api/program/summary (docs/api.md, TICKET-16). Every string a row prints
// (`reason`, `owner`, `due_label`, `label`) is formatted by the server.
export type ProgramExceptionKind = "unowned" | "past_referral_limit" | "closure_held";

// ---- TICKET-10: outreach ladder and patient page (GET /api/cases/{id}/outreach,
// GET /api/patient/{token}) ------------------------------------------------------------

export type LadderTask = {
  task_id: string;
  kind: string;
  owner: { actor_id: string; role: string; display_name: string } | null;
  due_at: string;
  due_label: string;
  status: string;
};

export type LadderStep = {
  key: "message" | "staff_call" | "callback" | "navigator";
  n: number;
  label: string;
  role: string;
  state: "done" | "scheduled" | "not_needed" | "stopped";
  at_label: string | null;
  due_label: string | null;
  detail: string;
  task: LadderTask | null;
};

export type OutreachLadder = {
  case_id: string;
  patient_language: string;
  active: boolean;
  status: "acknowledged" | "stopped" | "navigator" | "staff_call" | "waiting_for_patient" | "not_started";
  status_label: string;
  stopped_reason: string | null;
  link: { token: string; path: string } | null;
  message: {
    sent: boolean;
    sent_at: string | null;
    sent_label: string | null;
    channel: string;
    delivery: string;
    language: string;
    dir: "ltr" | "rtl";
    text: string;
    language_fallback: boolean;
    review_status: string;
    review_note: string;
  };
  ladder: LadderStep[];
  patient_response: { response: "understood" | "request_call"; at_label: string } | null;
  delay_reasons: { key: DelayReason; label: string }[];
  parameters: { key: string; hours: number; label: string; source: string }[];
  template_note: string;
  navigator_task_kind: string;
};

export type PatientPageText = {
  sms: string;
  page_title: string;
  greeting: string;
  result_heading: string;
  result: string;
  next_step_heading: string;
  next_step: string;
  urgency_heading: string;
  urgency: string;
  contact_heading: string;
  contact: string;
  acknowledge: string;
  callback: string;
  acknowledged: string;
  callback_requested: string;
  language_label: string;
  draft_notice: string;
};

export type PatientPage = {
  patient_name: string;
  language: string;
  language_name: string;
  content_language: string;
  dir: "ltr" | "rtl";
  fallback: boolean;
  fallback_notice: string | null;
  review_status: string;
  review_note: string;
  languages: { code: string; name: string; dir: "ltr" | "rtl"; review_status: string; label: string | null }[];
  content: PatientPageText;
  response: "understood" | "request_call" | null;
  response_text: string | null;
  phone: string;
  recorded?: string | null;
};
// ---- end TICKET-10 ----------------------------------------------------------------------

export type ProgramException = {
  case_id: string;
  kind: ProgramExceptionKind;
  reason: string;
  owner: string;
  stage_label: string;
  due_at: string | null;
  due_label: string;
};

export type UnstitchedRow = {
  id: string;
  received_at: string | null;
  received_label: string;
  reason: string;
  summary: string;
};

export type FunnelRow = {
  key: string;
  // The stage label, printed as written.
  stage: string;
  reached: number;
  open: number;
  unowned: number;
  median_days_from_previous: number | null;
  terminal: boolean;
};

export type ReferralBucket = {
  label: string;
  min_days: number;
  max_days: number | null;
  over_limit: boolean;
  completed: number;
  waiting: number;
};

export type ReferralToColonoscopy = {
  limit_days: number;
  label: string;
  source: string;
  completed: number;
  completed_within_limit: number;
  completed_over_limit: number;
  waiting: number;
  waiting_over_limit: number;
  median_days_completed: number | null;
  buckets: ReferralBucket[];
};

export type RoleDayCount = {
  role: Role;
  role_label: string;
  total: number;
  per_day: number;
};

export type EscalationDay = {
  day: number;
  label: string;
  per_role: { role: Role; count: number }[];
};

export type DelayReasonCount = {
  delay_reason: DelayReason | string;
  label: string;
  count: number;
};

export type ProgramScenario = {
  title: string;
  cohort_cases: number;
  baseline_rate: number;
  outreach_rate: number;
  additional_completed: number;
  source: string;
  caveat: string;
};

export type ProgramSummary = {
  clock: Clock;
  synthetic_data_label: string;
  counts: {
    total: number;
    open: number;
    unowned: number;
    due_today: number;
    due_today_unowned: number;
    closed_this_week: number;
    past_referral_limit: number;
    closures_held: number;
  };
  exceptions: ProgramException[];
  unstitched: { available: boolean; count: number; rows: UnstitchedRow[] };
  funnel: FunnelRow[];
  referral_to_colonoscopy: ReferralToColonoscopy | null;
  delay_reasons: DelayReasonCount[];
  escalations_per_role_per_day: RoleDayCount[];
  escalations_by_day: EscalationDay[];
  scenario: ProgramScenario;
  pathway: { id: string; label: string };
};

export type MutationResult = {
  recorded: string;
};
