// The case engine (TICKET-05). Every rule about which stage a case may move to, who
// may act on it, and whether it may be closed lives here and nowhere else.
//
// The HTTP layer renders these answers; it never re-implements them. That is what
// keeps `available_actions` and the guards from drifting apart: one function
// (`availableActions`) produces the payload, and every guard asks the same function
// or the transition table below.

export type Role =
  | "coordination_staff"
  | "navigator"
  | "responsible_physician"
  | "program_manager";

export const ROLES: readonly Role[] = [
  "coordination_staff",
  "navigator",
  "responsible_physician",
  "program_manager",
];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The pathway template
// ---------------------------------------------------------------------------

export type StageKey =
  | "result_received"
  | "colonoscopy_booked"
  | "pathology_ordered"
  | "pathology_received"
  | "closure_proposed"
  | "closure_confirmed"
  | "closed";

export type StageDefinition = {
  key: StageKey;
  label: string;
  short_label: string;
  // Position in the pathway, used to render passed/current/ahead.
  order: number;
  // Hours allowed at this stage from the moment it was entered. `null` for `closed`.
  sla_hours: number | null;
  // Lower is more urgent. The worklist orders by this, then by time left.
  urgency: number;
};

export const STAGES: readonly StageDefinition[] = [
  {
    key: "result_received",
    label: "Result received",
    short_label: "Result",
    order: 0,
    sla_hours: 168,
    urgency: 6,
  },
  {
    key: "colonoscopy_booked",
    label: "Colonoscopy booked",
    short_label: "Colonoscopy",
    order: 1,
    sla_hours: 336,
    urgency: 5,
  },
  {
    key: "pathology_ordered",
    label: "Pathology ordered",
    short_label: "Ordered",
    order: 2,
    sla_hours: 336,
    urgency: 4,
  },
  {
    key: "pathology_received",
    label: "Pathology received",
    short_label: "Received",
    order: 3,
    sla_hours: 168,
    urgency: 3,
  },
  {
    key: "closure_proposed",
    label: "Closure proposed",
    short_label: "Proposed",
    order: 4,
    sla_hours: 48,
    urgency: 1,
  },
  {
    key: "closure_confirmed",
    label: "Closure confirmed",
    short_label: "Confirmed",
    order: 5,
    sla_hours: 24,
    urgency: 2,
  },
  { key: "closed", label: "Closed", short_label: "Closed", order: 6, sla_hours: null, urgency: 7 },
];

export function stageDefinition(stage: string): StageDefinition | undefined {
  return STAGES.find((s) => s.key === stage);
}

export function stageLabel(stage: string): string {
  return stageDefinition(stage)?.label ?? stage;
}

export function stageOrder(stage: string): number {
  return stageDefinition(stage)?.order ?? -1;
}

// Stages a human may advance through, i.e. up to referral/hand-off. `closure_proposed`
// is decided by the physician, not advanced by coordination staff.
export const EARLY_STAGES: readonly StageKey[] = [
  "result_received",
  "colonoscopy_booked",
  "pathology_ordered",
  "pathology_received",
];

export type Outcome = {
  key: string;
  label: string;
};

// The closed vocabulary a closure decision may choose from (docs/api.md).
export const OUTCOMES: readonly Outcome[] = [
  { key: "returned_to_routine_screening", label: "Returned to routine screening" },
  { key: "surveillance_scheduled", label: "Surveillance scheduled" },
  { key: "oncology_accepted_therapy_started", label: "Oncology accepted, therapy started" },
];

// Evidence kinds that can support a closure. The prototype accepts a colonoscopy or
// pathology document; TICKET-05 requires *the evidence for that outcome*, which in
// this pathway is the examination report.
export const CLOSURE_EVIDENCE_KINDS: readonly string[] = ["colonoscopy", "pathology"];

// ---------------------------------------------------------------------------
// Case shape the engine reasons about
// ---------------------------------------------------------------------------

export type EngineCase = {
  stage: string;
  status: string;
  owner_actor_id: string | null;
  final_outcome: string | null;
  documents: readonly { kind: string }[];
  // True when a `closure_confirmed` event written by a physician already exists.
  physician_confirmed: boolean;
};

export function isClosed(c: EngineCase): boolean {
  return c.stage === "closed" || c.status === "closed";
}

export function isOpen(c: EngineCase): boolean {
  return !isClosed(c);
}

export type OwnershipState = "owned" | "unowned";

export function ownershipState(c: EngineCase): OwnershipState {
  return c.owner_actor_id === null ? "unowned" : "owned";
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type Action =
  | "advance_case"
  | "log_outreach"
  | "assign_owner"
  | "answer_consultation"
  | "confirm_closure"
  | "reopen_case"
  | "reject_proposal";

// THE function. The case view sends its result as `available_actions`, and the
// guards below ask it rather than keeping a second copy of these rules.
export function availableActions(c: EngineCase, role: Role): Action[] {
  if (isClosed(c)) {
    return role === "responsible_physician" ? ["reopen_case"] : [];
  }

  const actions: Action[] = [];
  const stage = c.stage;

  if (role === "coordination_staff" || role === "navigator") {
    actions.push("log_outreach");
    if ((EARLY_STAGES as readonly string[]).includes(stage)) actions.push("advance_case");
    if (c.owner_actor_id === null) actions.push("assign_owner");
  }

  if (role === "responsible_physician") {
    if (c.owner_actor_id === null) actions.push("assign_owner");
    if (stage === "pathology_received" || stage === "closure_proposed") {
      actions.push("answer_consultation");
    }
    if (stage === "closure_proposed") {
      actions.push("confirm_closure", "reject_proposal");
    }
    if (stage === "closure_confirmed") actions.push("reopen_case");
  }

  // program_manager reads the program view and takes no case action.

  return actions;
}

export function canPerform(c: EngineCase, role: Role, action: Action): boolean {
  return availableActions(c, role).includes(action);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export type Transition = {
  from: readonly string[];
  to: StageKey;
  clears_owner?: boolean;
  activates_owner?: boolean;
};

// A human advances a case by naming an event; the event type selects the transition
// and the server knows where the case is. The client never sends a stage.
export const TRANSITIONS: Readonly<Record<string, Transition>> = {
  colonoscopy_booked: { from: ["result_received"], to: "colonoscopy_booked" },
  pathology_ordered: { from: ["colonoscopy_booked"], to: "pathology_ordered" },
  pathology_received: { from: ["pathology_ordered"], to: "pathology_received" },
  closure_proposed: { from: ["pathology_received"], to: "closure_proposed" },
  closure_confirmed: { from: ["closure_proposed"], to: "closure_confirmed" },
  case_closed: { from: ["closure_confirmed"], to: "closed" },

  // Backward paths (TICKET-05). This pathway has no `referral_sent` stage in the
  // prototype's vocabulary, so an incomplete examination returns the case to the
  // stage where a new booking is made, with an owner assigned.
  procedure_incomplete: {
    from: ["colonoscopy_booked", "pathology_ordered", "pathology_received"],
    to: "result_received",
    activates_owner: true,
  },

  // A rejected referral returns the case to its previous owner and marks it unowned
  // until someone claims it; TICKET-08 owns the explicit unowned list.
  referral_rejected: {
    from: ["result_received", "colonoscopy_booked"],
    to: "result_received",
    clears_owner: true,
  },

  // Reopen never leaves the case unowned: the caller supplies the owner to assign.
  reopened: {
    from: ["closure_confirmed", "closed"],
    to: "result_received",
    activates_owner: true,
  },
};

export type TransitionResult =
  | { ok: true; to: StageKey; clears_owner: boolean; activates_owner: boolean }
  | { ok: false; code: "invalid_transition" | "role_not_permitted"; message: string };

export function transitionFor(
  stage: string,
  type: string,
  role: Role | "system",
): TransitionResult {
  const transition = TRANSITIONS[type];
  if (!transition) {
    return { ok: false, code: "invalid_transition", message: `Unknown event type "${type}".` };
  }
  if (!transition.from.includes(stage)) {
    return {
      ok: false,
      code: "invalid_transition",
      message: `"${type}" cannot follow stage "${stage}".`,
    };
  }
  if (role === "system" && type !== "case_closed") {
    return {
      ok: false,
      code: "role_not_permitted",
      message: "The system role may only close a case it did not decide to close.",
    };
  }
  return {
    ok: true,
    to: transition.to,
    clears_owner: transition.clears_owner === true,
    activates_owner: transition.activates_owner === true,
  };
}

// Ownership rule: a forward transition never produces an ownerless open case. The
// only legal ownerless state is the explicit unowned one produced by a rejected
// referral (TICKET-05 and TICKET-08).
export function ownerAfter(
  c: EngineCase,
  type: string,
  fallbackOwnerId: string | null,
): string | null {
  const transition = TRANSITIONS[type];
  if (!transition) return c.owner_actor_id;
  if (transition.clears_owner) return null;
  if (c.owner_actor_id !== null) return c.owner_actor_id;
  return transition.activates_owner ? fallbackOwnerId : c.owner_actor_id;
}

// ---------------------------------------------------------------------------
// Closure rules
// ---------------------------------------------------------------------------

export type ClosureDetails = {
  final_outcome: boolean;
  evidence_attached: boolean;
  physician_confirmation: boolean;
};

// The three conditions from TICKET-05. `actingRole` is passed only by the confirm
// endpoint, where the physician's own act is the confirmation; a pre-existing
// `closure_confirmed` event satisfies it on every other read.
export function closureConditions(c: EngineCase, actingRole?: Role | "system"): ClosureDetails {
  return {
    final_outcome:
      c.final_outcome !== null && OUTCOMES.some((outcome) => outcome.key === c.final_outcome),
    evidence_attached: c.documents.some((doc) =>
      CLOSURE_EVIDENCE_KINDS.includes(doc.kind),
    ),
    physician_confirmation:
      c.physician_confirmed || actingRole === "responsible_physician",
  };
}

export type ClosureResult =
  | { allowed: true; conditions: ClosureDetails }
  | {
      allowed: false;
      code: "closure_conditions_unmet" | "role_not_permitted";
      message: string;
      details?: ClosureDetails;
    };

// The guard the endpoint calls. Role first: a coordinator or the system role is
// refused even when all three conditions happen to be met.
export function confirmClosure(c: EngineCase, role: Role | "system"): ClosureResult {
  if (role !== "responsible_physician") {
    return {
      allowed: false,
      code: "role_not_permitted",
      message: "Only the responsible physician confirms closure.",
    };
  }

  const conditions = closureConditions(c, role);
  if (!conditions.final_outcome || !conditions.evidence_attached || !conditions.physician_confirmation) {
    return {
      allowed: false,
      code: "closure_conditions_unmet",
      message: "Closure requires all three conditions.",
      details: conditions,
    };
  }

  return { allowed: true, conditions };
}
