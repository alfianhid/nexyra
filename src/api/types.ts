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

export type VerificationSummary = {
  status: string;
  proposal: string;
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
    proposal: string;
    proposal_reason: string;
  };
};

export type DelayReason = "fear" | "transport" | "cost" | "language" | "other";

export type OutreachInput = {
  outcome: string;
  delay_reason?: DelayReason;
};

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
