// The case engine (TICKET-05). Every rule about which stage a case may move to, who
// may act on it, and whether it may be closed lives here and nowhere else.
//
// The rules are generic; the pathway they run is data (TICKET-04). Stage names,
// deadlines, owners, escalation ladders, outcomes and the evidence each outcome needs
// come from server/pathways/fit-colonoscopy.json through server/pathways/index.ts.
// Nothing in this file names a FIT stage or a deadline.
//
// The HTTP layer renders these answers; it never re-implements them. That is what
// keeps `available_actions` and the guards from drifting apart: one function
// (`availableActions`) produces the payload, and every guard asks the same function
// or the transition table the template defines.

import {
  DEFAULT_PATHWAY,
  type Pathway,
  type PathwayEvent,
  type PathwayLimit,
  type PathwayStage,
} from "./pathways/index.js";
import {
  ACTIONS,
  CASE_CLOSED,
  CASE_OPEN,
  isRole,
  ROLES,
  type Action,
  type CaseStatus,
  type EventRole,
  type Role,
} from "./vocabulary.js";

export { ACTIONS, isRole, ROLES };
export type { Action, EventRole, Role };

// ---------------------------------------------------------------------------
// The pathway template
// ---------------------------------------------------------------------------

export const PATHWAY: Pathway = DEFAULT_PATHWAY;

export type StageKey = string;
export type StageDefinition = PathwayStage;

export const STAGES: readonly StageDefinition[] = PATHWAY.stages;

export const INITIAL_STAGE: string = PATHWAY.trigger.initial_stage;
export const TERMINAL_STAGE: string = PATHWAY.terminal_stage;

export function stageDefinition(stage: string): StageDefinition | undefined {
  return STAGES.find((s) => s.key === stage);
}

export function stageLabel(stage: string): string {
  return stageDefinition(stage)?.label ?? stage;
}

export function stageOrder(stage: string): number {
  return stageDefinition(stage)?.order ?? -1;
}

export function eventDefinition(type: string): PathwayEvent | undefined {
  return PATHWAY.events[type];
}

// The stage(s) where a closure decision is waiting on the responsible physician.
export function isAwaitingClosure(stage: string): boolean {
  return stageDefinition(stage)?.awaiting_closure === true;
}

// The event that records the physician's closure confirmation (the one the three
// conditions guard), read from the template's `confirm_closure` action.
export const CLOSURE_CONFIRMATION_EVENT: string | null =
  PATHWAY.actions.confirm_closure?.event ?? null;

export const REOPEN_EVENT: string | null = PATHWAY.actions.reopen_case?.event ?? null;

export const ASSIGN_OWNER_EVENT: string | null = PATHWAY.actions.assign_owner?.event ?? null;

// The limit the clock reports (the referral limit in the FIT pathway).
export const REPORTED_LIMIT: PathwayLimit | null =
  PATHWAY.limits.find((limit) => limit.reported_as !== null) ?? null;

export type Outcome = {
  key: string;
  label: string;
};

// The closed vocabulary a closure decision may choose from (docs/api.md).
export const OUTCOMES: readonly Outcome[] = PATHWAY.outcomes.map((o) => ({
  key: o.key,
  label: o.label,
}));

export function isValidOutcome(key: unknown): key is string {
  return typeof key === "string" && OUTCOMES.some((outcome) => outcome.key === key);
}

// ---------------------------------------------------------------------------
// Case shape the engine reasons about
// ---------------------------------------------------------------------------

export type EngineCase = {
  stage: string;
  status: string;
  owner_actor_id: string | null;
  final_outcome: string | null;
  documents: readonly { kind: string }[];
  // True when a closure confirmation written by a physician already exists.
  physician_confirmed: boolean;
};

export function isClosed(c: { stage: string; status: string }): boolean {
  return c.stage === TERMINAL_STAGE || c.status === CASE_CLOSED;
}

export function isOpen(c: { stage: string; status: string }): boolean {
  return !isClosed(c);
}

export type OwnershipState = "owned" | "unowned";

export function ownershipState(c: { owner_actor_id: string | null }): OwnershipState {
  return c.owner_actor_id === null ? "unowned" : "owned";
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export function rolesForEvent(type: string): readonly EventRole[] | null {
  return eventDefinition(type)?.roles ?? null;
}

// The template's exits from one stage, with each exit's event definition.
export function exitsFrom(stage: string): { event: PathwayEvent; to: string }[] {
  const definition = stageDefinition(stage);
  if (!definition) return [];
  return definition.exits.flatMap((exit) => {
    const event = eventDefinition(exit.event);
    return event ? [{ event, to: exit.to }] : [];
  });
}

function isForward(from: string, to: string): boolean {
  return stageOrder(to) > stageOrder(from);
}

export type TransitionResult =
  | {
      ok: true;
      to: StageKey;
      clears_owner: boolean;
      activates_owner: boolean;
      moves_stage: boolean;
    }
  | { ok: false; code: "invalid_transition" | "role_not_permitted"; message: string };

// A human advances a case by naming an event; the event type selects the transition
// and the server knows where the case is. The client never sends a stage.
//
// Human roles are checked by `rolesForEvent` in the write path (server/events.ts);
// this function only refuses the system role an event the template does not give it,
// so a timer, an ingest or the AI can never close a case.
export function transitionFor(
  stage: string,
  type: string,
  role: Role | "system",
): TransitionResult {
  const event = eventDefinition(type);
  if (!event) {
    return { ok: false, code: "invalid_transition", message: `Unknown event type "${type}".` };
  }

  let to: string;
  if (event.moves_stage) {
    const exit = stageDefinition(stage)?.exits.find((e) => e.event === type);
    if (!exit) {
      return {
        ok: false,
        code: "invalid_transition",
        message: `"${type}" cannot follow stage "${stage}".`,
      };
    }
    to = exit.to;
  } else {
    if (!stageDefinition(stage) || stage === TERMINAL_STAGE) {
      return {
        ok: false,
        code: "invalid_transition",
        message: `"${type}" cannot be recorded on a case at stage "${stage}".`,
      };
    }
    to = stage;
  }

  if (role === "system" && !event.roles.includes("system")) {
    return {
      ok: false,
      code: "role_not_permitted",
      message: `The system role may not record "${type}".`,
    };
  }

  return {
    ok: true,
    to,
    clears_owner: event.owner === "clear",
    activates_owner: event.owner === "assign_if_unowned" || event.owner === "assign",
    moves_stage: event.moves_stage,
  };
}

// Ownership rule: a forward transition never produces an ownerless open case. The
// only legal ownerless state is the explicit unowned one produced by an event the
// template marks `owner: "clear"` (the rejected referral, TICKET-05 and TICKET-08).
export function ownerAfter(
  c: { owner_actor_id: string | null },
  type: string,
  fallbackOwnerId: string | null,
): string | null {
  const event = eventDefinition(type);
  if (!event) return c.owner_actor_id;
  switch (event.owner) {
    case "clear":
      return null;
    case "assign":
      return fallbackOwnerId ?? c.owner_actor_id;
    case "assign_if_unowned":
      return c.owner_actor_id ?? fallbackOwnerId;
    case "keep":
      return c.owner_actor_id;
  }
}

// ---------------------------------------------------------------------------
// Replaying events: the case row is a cache of this fold (TICKET-03)
// ---------------------------------------------------------------------------

export type CaseState = {
  stage: string;
  status: CaseStatus;
  owner_actor_id: string | null;
  final_outcome: string | null;
  stage_entered_at: string | null;
};

export type RecordedEvent = {
  type: string;
  actor_id: string;
  actor_role: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};

export class ReplayError extends Error {
  constructor(
    readonly code: "invalid_transition" | "role_not_permitted" | "validation_failed",
    message: string,
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

function payloadOwner(event: RecordedEvent): string | null {
  const owner = event.payload.owner_actor_id;
  return typeof owner === "string" && owner.length > 0 ? owner : null;
}

// One step of the fold. `applyEvent` uses it to compute the row it writes and
// `rebuildCase` uses it to replay the timeline, so the two cannot disagree.
// Event types the template does not define (outreach, tasks, escalations, extraction)
// are recorded history but do not change the cached columns.
export function nextState(state: CaseState | null, event: RecordedEvent): CaseState | null {
  const definition = eventDefinition(event.type);
  if (!definition) return state;

  const role = event.actor_role as EventRole;
  if (!definition.roles.includes(role)) {
    throw new ReplayError(
      "role_not_permitted",
      `The ${event.actor_role} role may not record a "${event.type}" event.`,
    );
  }

  if (event.type === PATHWAY.trigger.event) {
    if (state !== null) {
      throw new ReplayError("invalid_transition", `"${event.type}" on a case that already exists.`);
    }
    const owner = payloadOwner(event);
    if (owner === null) {
      throw new ReplayError("validation_failed", `"${event.type}" must name owner_actor_id.`);
    }
    return {
      stage: INITIAL_STAGE,
      status: CASE_OPEN,
      owner_actor_id: owner,
      final_outcome: null,
      stage_entered_at: event.occurred_at,
    };
  }

  if (state === null) {
    throw new ReplayError(
      "invalid_transition",
      `"${event.type}" recorded before the case was created.`,
    );
  }

  const transition = transitionFor(state.stage, event.type, role);
  if (!transition.ok) throw new ReplayError(transition.code, transition.message);

  const fallback = payloadOwner(event) ?? (role === "system" ? null : event.actor_id);
  const owner = ownerAfter(state, event.type, fallback);
  if (owner === null && (definition.owner === "assign" || definition.owner === "assign_if_unowned")) {
    throw new ReplayError("validation_failed", `"${event.type}" must name owner_actor_id.`);
  }

  const finalises = definition.finalises_to !== null && event.payload.finalises === true;
  const target = finalises ? (definition.finalises_to as string) : transition.to;

  const outcome = event.payload.outcome;
  const finalOutcome = definition.clears_outcome
    ? null
    : isValidOutcome(outcome)
      ? outcome
      : state.final_outcome;

  return {
    stage: target,
    status: target === TERMINAL_STAGE ? CASE_CLOSED : CASE_OPEN,
    owner_actor_id: owner,
    final_outcome: finalOutcome,
    stage_entered_at:
      definition.moves_stage || target !== state.stage ? event.occurred_at : state.stage_entered_at,
  };
}

export function foldEvents(events: readonly RecordedEvent[]): CaseState | null {
  return events.reduce<CaseState | null>((state, event) => nextState(state, event), null);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

function actionAllowedByTemplate(action: Action, stage: string, role: Role): boolean {
  const definition = PATHWAY.actions[action];
  if (!definition) return false;
  if (definition.roles !== null && !definition.roles.includes(role)) return false;
  if (definition.event !== null) {
    const event = eventDefinition(definition.event);
    if (!event || !event.roles.includes(role)) return false;
    if (event.moves_stage && !stageDefinition(stage)?.exits.some((e) => e.event === definition.event)) {
      return false;
    }
  }
  return true;
}

// THE function. The case view sends its result as `available_actions`, and the
// guards ask it rather than keeping a second copy of these rules.
export function availableActions(c: EngineCase, role: Role): Action[] {
  const open = isOpen(c);
  const stage = stageDefinition(c.stage);
  if (!stage) return [];

  const allowed = (action: Action): boolean => {
    switch (action) {
      case "advance_case":
        // A forward exit this role may record, other than a closure: closing has its
        // own action and its own three conditions.
        return (
          open &&
          exitsFrom(c.stage).some(
            ({ event, to }) => !event.closure && isForward(c.stage, to) && event.roles.includes(role),
          )
        );
      case "log_outreach":
        return open && actionAllowedByTemplate(action, c.stage, role);
      case "assign_owner":
        return open && c.owner_actor_id === null && actionAllowedByTemplate(action, c.stage, role);
      case "answer_consultation":
        return open && stage.consultation && actionAllowedByTemplate(action, c.stage, role);
      case "reject_proposal":
        return open && stage.awaiting_closure && actionAllowedByTemplate(action, c.stage, role);
      case "confirm_closure":
      case "reopen_case":
        return actionAllowedByTemplate(action, c.stage, role);
    }
  };

  return ACTIONS.filter(allowed);
}

export function canPerform(c: EngineCase, role: Role, action: Action): boolean {
  return availableActions(c, role).includes(action);
}

// ---------------------------------------------------------------------------
// Closure rules
// ---------------------------------------------------------------------------

export type ClosureDetails = {
  final_outcome: boolean;
  evidence_attached: boolean;
  physician_confirmation: boolean;
};

function evidenceSatisfies(outcomeKey: string, kinds: ReadonlySet<string>): boolean {
  const outcome = PATHWAY.outcomes.find((o) => o.key === outcomeKey);
  if (!outcome) return false;
  const all = outcome.evidence.all_of.every((kind) => kinds.has(kind));
  const any =
    outcome.evidence.any_of.length === 0 || outcome.evidence.any_of.some((kind) => kinds.has(kind));
  return all && any;
}

// Evidence is judged against the outcome on the case. Without a valid outcome there is
// nothing specific to judge against, so any document that would support some outcome
// counts; the missing outcome is reported by its own condition.
export function evidenceAttached(
  finalOutcome: string | null,
  documents: readonly { kind: string }[],
): boolean {
  const kinds = new Set(documents.map((doc) => doc.kind));
  if (isValidOutcome(finalOutcome)) return evidenceSatisfies(finalOutcome, kinds);
  return PATHWAY.outcomes.some((outcome) => evidenceSatisfies(outcome.key, kinds));
}

// The three conditions from TICKET-05. `actingRole` is passed only by the confirm
// endpoint, where the physician's own act is the confirmation; a pre-existing
// confirmation event satisfies it on every other read.
export function closureConditions(c: EngineCase, actingRole?: Role | "system"): ClosureDetails {
  return {
    final_outcome: isValidOutcome(c.final_outcome),
    evidence_attached: evidenceAttached(c.final_outcome, c.documents),
    physician_confirmation: c.physician_confirmed || actingRole === "responsible_physician",
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
