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

export type CaseDetailResponse = {
  case: {
    case_id: string;
    patient: { display_name: string; age: number; language: string };
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
  available_actions: string[];
  verification: VerificationSummary;
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

// docs/api.md fixes only the five keys of the program summary, not the shape of the
// rows inside them. These item types mirror the programme summary in src/data.ts.
export type ProgramException = {
  case_id: string;
  reason: string;
  owner: string;
  due_at: string;
};

export type FunnelRow = {
  stage: string;
  open: number;
  unowned: number;
};

export type RoleDayCount = {
  role: Role;
  per_day: number;
};

export type DelayReasonCount = {
  delay_reason: DelayReason;
  count: number;
};

export type ProgramSummary = {
  counts: {
    open: number;
    unowned: number;
    due_today: number;
    closed_this_week: number;
  };
  exceptions: ProgramException[];
  funnel: FunnelRow[];
  escalations_per_role_per_day: RoleDayCount[];
  delay_reasons: DelayReasonCount[];
  synthetic_data_label: string;
};

export type MutationResult = {
  recorded: string;
};
