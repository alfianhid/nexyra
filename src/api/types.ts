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
};

// GET /api/program/summary (docs/api.md, TICKET-16). Every string a row prints
// (`reason`, `owner`, `due_label`, `label`) is formatted by the server.
export type ProgramExceptionKind = "unowned" | "past_referral_limit" | "closure_held";

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
