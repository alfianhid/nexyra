// The case engine (TICKET-05). Every rule about which stage a case may move to, who
// may act on it, and whether it may be closed lives here and nowhere else.
//
// The rules are generic; the pathway they run is data (TICKET-04). Stage names,
// deadlines, owners, escalation ladders, outcomes and the evidence each outcome needs
// come from the case's own template in server/pathways/ (TICKET-18: `cases.pathway_id`)
// through server/pathways/index.ts. Nothing in this file names a stage or a deadline.
//
// The HTTP layer renders these answers; it never re-implements them. That is what
// keeps `available_actions` and the guards from drifting apart: one function
// (`availableActions`) produces the payload, and every guard asks the same function
// or the transition table the template defines.

import {
  CONSULTATION_ANSWERS,
  DEFAULT_PATHWAY,
  PATHWAYS,
  getPathway,
  type ConsultationAnswer,
  type Pathway,
  type PathwayConsultation,
  type PathwayEvent,
  type PathwayLimit,
  type PathwayStage,
  type PathwayStitching,
  type PathwayUnowned,
  type StitchingRule,
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

// The default pathway: what a rule runs when its caller names no pathway.
export const PATHWAY: Pathway = DEFAULT_PATHWAY;

export type StageKey = string;
export type StageDefinition = PathwayStage;

export type Outcome = {
  key: string;
  label: string;
};

// ---- TICKET-18: routing by the case's own pathway --------------------------------
// Every rule below takes the pathway it runs as an optional last argument: a template,
// or a pathway id as stored in `cases.pathway_id`. Rules that take a case read
// `pathway_id` from it. An id no template carries throws UnknownPathwayError. Leaving
// the argument out runs the default pathway, which is how every caller worked before a
// second template existed; the exported constants below are the default's.
export type PathwayRef = Pathway | string | null | undefined;

export function pathwayOf(ref?: PathwayRef): Pathway {
  if (ref === undefined || ref === null) return PATHWAY;
  return typeof ref === "string" ? getPathway(ref) : ref;
}

// What a pathway's template implies once, so callers do not each re-derive it.
export type PathwayRules = {
  pathway: Pathway;
  stages: readonly StageDefinition[];
  initialStage: string;
  terminalStage: string;
  // The event that records the physician's closure confirmation (the one the three
  // conditions guard), read from the template's `confirm_closure` action.
  closureConfirmationEvent: string | null;
  reopenEvent: string | null;
  assignOwnerEvent: string | null;
  // The limit the worklist and the clock report (the referral limit).
  reportedLimit: PathwayLimit | null;
  // The closed vocabulary a closure decision may choose from (docs/api.md).
  outcomes: readonly Outcome[];
  unowned: PathwayUnowned | null;
  consultation: PathwayConsultation | null;
  stitching: PathwayStitching | null;
};

const RULES = new WeakMap<Pathway, PathwayRules>();

export function rulesOf(ref?: PathwayRef): PathwayRules {
  const pathway = pathwayOf(ref);
  const known = RULES.get(pathway);
  if (known) return known;
  const rules: PathwayRules = Object.freeze({
    pathway,
    stages: pathway.stages,
    initialStage: pathway.trigger.initial_stage,
    terminalStage: pathway.terminal_stage,
    closureConfirmationEvent: pathway.actions.confirm_closure?.event ?? null,
    reopenEvent: pathway.actions.reopen_case?.event ?? null,
    assignOwnerEvent: pathway.actions.assign_owner?.event ?? null,
    reportedLimit: pathway.limits.find((limit) => limit.reported_as !== null) ?? null,
    outcomes: pathway.outcomes.map((o) => ({ key: o.key, label: o.label })),
    unowned: pathway.unowned,
    consultation: pathway.consultation,
    stitching: pathway.stitching,
  });
  RULES.set(pathway, rules);
  return rules;
}
// ---- end TICKET-18 ------------------------------------------------------------------

const DEFAULT_RULES = rulesOf(PATHWAY);

export const STAGES: readonly StageDefinition[] = DEFAULT_RULES.stages;

export const INITIAL_STAGE: string = DEFAULT_RULES.initialStage;
export const TERMINAL_STAGE: string = DEFAULT_RULES.terminalStage;

export function stageDefinition(stage: string, pathway?: PathwayRef): StageDefinition | undefined {
  return pathwayOf(pathway).stages.find((s) => s.key === stage);
}

export function stageLabel(stage: string, pathway?: PathwayRef): string {
  return stageDefinition(stage, pathway)?.label ?? stage;
}

export function stageOrder(stage: string, pathway?: PathwayRef): number {
  return stageDefinition(stage, pathway)?.order ?? -1;
}

export function eventDefinition(type: string, pathway?: PathwayRef): PathwayEvent | undefined {
  return pathwayOf(pathway).events[type];
}

// The stage(s) where a closure decision is waiting on the responsible physician.
export function isAwaitingClosure(stage: string, pathway?: PathwayRef): boolean {
  return stageDefinition(stage, pathway)?.awaiting_closure === true;
}

export const CLOSURE_CONFIRMATION_EVENT: string | null = DEFAULT_RULES.closureConfirmationEvent;

export const REOPEN_EVENT: string | null = DEFAULT_RULES.reopenEvent;

export const ASSIGN_OWNER_EVENT: string | null = DEFAULT_RULES.assignOwnerEvent;

// The limit the clock reports (the referral limit in the FIT pathway).
export const REPORTED_LIMIT: PathwayLimit | null = DEFAULT_RULES.reportedLimit;

export const OUTCOMES: readonly Outcome[] = DEFAULT_RULES.outcomes;

export function isValidOutcome(key: unknown, pathway?: PathwayRef): key is string {
  return typeof key === "string" && rulesOf(pathway).outcomes.some((outcome) => outcome.key === key);
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
  // TICKET-11: true while a consultation on the case is waiting for its answer.
  open_consultation?: boolean;
  // TICKET-18: the case's template; absent means the default pathway.
  pathway_id?: string | null;
};

type CaseRef = { stage: string; status: string; pathway_id?: string | null };

export function isClosed(c: CaseRef): boolean {
  return c.stage === pathwayOf(c.pathway_id).terminal_stage || c.status === CASE_CLOSED;
}

export function isOpen(c: CaseRef): boolean {
  return !isClosed(c);
}

export type OwnershipState = "owned" | "unowned";

export function ownershipState(c: { owner_actor_id: string | null }): OwnershipState {
  return c.owner_actor_id === null ? "unowned" : "owned";
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export function rolesForEvent(type: string, pathway?: PathwayRef): readonly EventRole[] | null {
  return eventDefinition(type, pathway)?.roles ?? null;
}

// The template's exits from one stage, with each exit's event definition.
export function exitsFrom(stage: string, pathway?: PathwayRef): { event: PathwayEvent; to: string }[] {
  const definition = stageDefinition(stage, pathway);
  if (!definition) return [];
  return definition.exits.flatMap((exit) => {
    const event = eventDefinition(exit.event, pathway);
    return event ? [{ event, to: exit.to }] : [];
  });
}

function isForward(from: string, to: string, pathway: Pathway): boolean {
  return stageOrder(to, pathway) > stageOrder(from, pathway);
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
  pathway?: PathwayRef,
): TransitionResult {
  const p = pathwayOf(pathway);
  const event = eventDefinition(type, p);
  if (!event) {
    return { ok: false, code: "invalid_transition", message: `Unknown event type "${type}".` };
  }

  let to: string;
  if (event.moves_stage) {
    const exit = stageDefinition(stage, p)?.exits.find((e) => e.event === type);
    if (!exit) {
      return {
        ok: false,
        code: "invalid_transition",
        message: `"${type}" cannot follow stage "${stage}".`,
      };
    }
    to = exit.to;
  } else {
    if (!stageDefinition(stage, p) || stage === p.terminal_stage) {
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
  pathway?: PathwayRef,
): string | null {
  const event = eventDefinition(type, pathway);
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
  // TICKET-08: the case's current provider, set by events the template marks
  // `sets_provider` (payload.provider_id). Optional so older call sites still type.
  provider_id?: string | null;
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
export function nextState(
  state: CaseState | null,
  event: RecordedEvent,
  pathway?: PathwayRef,
): CaseState | null {
  const p = pathwayOf(pathway);
  const definition = eventDefinition(event.type, p);
  if (!definition) return state;

  const role = event.actor_role as EventRole;
  if (!definition.roles.includes(role)) {
    throw new ReplayError(
      "role_not_permitted",
      `The ${event.actor_role} role may not record a "${event.type}" event.`,
    );
  }

  if (event.type === p.trigger.event) {
    if (state !== null) {
      throw new ReplayError("invalid_transition", `"${event.type}" on a case that already exists.`);
    }
    const owner = payloadOwner(event);
    if (owner === null) {
      throw new ReplayError("validation_failed", `"${event.type}" must name owner_actor_id.`);
    }
    return {
      stage: p.trigger.initial_stage,
      status: CASE_OPEN,
      owner_actor_id: owner,
      final_outcome: null,
      stage_entered_at: event.occurred_at,
      provider_id: payloadProvider(event),
    };
  }

  if (state === null) {
    throw new ReplayError(
      "invalid_transition",
      `"${event.type}" recorded before the case was created.`,
    );
  }

  const transition = transitionFor(state.stage, event.type, role, p);
  if (!transition.ok) throw new ReplayError(transition.code, transition.message);

  const fallback = payloadOwner(event) ?? (role === "system" ? null : event.actor_id);
  const owner = ownerAfter(state, event.type, fallback, p);
  if (owner === null && (definition.owner === "assign" || definition.owner === "assign_if_unowned")) {
    throw new ReplayError("validation_failed", `"${event.type}" must name owner_actor_id.`);
  }

  const finalises = definition.finalises_to !== null && event.payload.finalises === true;
  const target = finalises ? (definition.finalises_to as string) : transition.to;

  const outcome = event.payload.outcome;
  const finalOutcome = definition.clears_outcome
    ? null
    : isValidOutcome(outcome, p)
      ? outcome
      : state.final_outcome;

  let provider = state.provider_id ?? null;
  if (definition.sets_provider) {
    provider = payloadProvider(event);
    if (provider === null) {
      throw new ReplayError("validation_failed", `"${event.type}" must name provider_id.`);
    }
  }

  return {
    stage: target,
    status: target === p.terminal_stage ? CASE_CLOSED : CASE_OPEN,
    owner_actor_id: owner,
    final_outcome: finalOutcome,
    stage_entered_at:
      definition.moves_stage || target !== state.stage ? event.occurred_at : state.stage_entered_at,
    provider_id: provider,
  };
}

function payloadProvider(event: RecordedEvent): string | null {
  const provider = event.payload.provider_id;
  return typeof provider === "string" && provider.length > 0 ? provider : null;
}

export function foldEvents(events: readonly RecordedEvent[], pathway?: PathwayRef): CaseState | null {
  const p = pathwayOf(pathway);
  return events.reduce<CaseState | null>((state, event) => nextState(state, event, p), null);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

function actionAllowedByTemplate(action: Action, stage: string, role: Role, p: Pathway): boolean {
  const definition = p.actions[action];
  if (!definition) return false;
  if (definition.roles !== null && !definition.roles.includes(role)) return false;
  if (definition.event !== null) {
    const event = eventDefinition(definition.event, p);
    if (!event || !event.roles.includes(role)) return false;
    if (event.moves_stage && !stageDefinition(stage, p)?.exits.some((e) => e.event === definition.event)) {
      return false;
    }
  }
  return true;
}

// THE function. The case view sends its result as `available_actions`, and the
// guards ask it rather than keeping a second copy of these rules.
export function availableActions(c: EngineCase, role: Role): Action[] {
  const p = pathwayOf(c.pathway_id);
  const open = isOpen(c);
  const stage = stageDefinition(c.stage, p);
  if (!stage) return [];

  const allowed = (action: Action): boolean => {
    switch (action) {
      case "advance_case":
        // A forward exit this role may record, other than a closure: closing has its
        // own action and its own three conditions.
        // A consultation answer is not a way to advance a case: it is recorded only by
        // answering an open consultation (TICKET-11).
        return (
          open &&
          exitsFrom(c.stage, p).some(
            ({ event, to }) =>
              !event.closure &&
              event.consultation_answer === null &&
              isForward(c.stage, to, p) &&
              event.roles.includes(role),
          )
        );
      case "log_outreach":
        return open && actionAllowedByTemplate(action, c.stage, role, p);
      case "assign_owner":
        return open && c.owner_actor_id === null && actionAllowedByTemplate(action, c.stage, role, p);
      // TICKET-11: a question can be asked at a stage the template marks `consultation`,
      // one at a time, and answered only while one is open.
      case "answer_consultation":
        return (
          open &&
          c.open_consultation === true &&
          consultationRoleAllowed("answer", role, p) &&
          actionAllowedByTemplate(action, c.stage, role, p)
        );
      case "request_consultation":
        return (
          open &&
          stage.consultation &&
          c.open_consultation !== true &&
          consultationRoleAllowed("request", role, p) &&
          actionAllowedByTemplate(action, c.stage, role, p)
        );
      case "reject_proposal":
        return open && stage.awaiting_closure && actionAllowedByTemplate(action, c.stage, role, p);
      case "confirm_closure":
        return actionAllowedByTemplate(action, c.stage, role, p);
      case "reopen_case":
        return reopenEventFor(c, role) !== null;
      case "record_provider_move":
        return open && actionAllowedByTemplate(action, c.stage, role, p);
    }
  };

  return ACTIONS.filter(allowed);
}

// Which event "reopen" records on this case for this role, or null when it cannot be
// reopened here. A closed (or confirmed) case leaves through the template's reopen event.
// An open case past the procedure is reopened through the exit that sends it back and
// clears the outcome (in the FIT template: the incomplete examination, back to Referral sent):
// the same transition the template already defines, so reopening never bypasses it.
export function reopenEventFor(
  c: { stage: string; status: string; pathway_id?: string | null },
  role: Role | "system",
): string | null {
  const p = pathwayOf(c.pathway_id);
  const reopen = rulesOf(p).reopenEvent;
  const exits = exitsFrom(c.stage, p).filter(({ event }) => event.roles.includes(role));
  if (reopen !== null) {
    const direct = exits.find(({ event }) => event.type === reopen);
    if (direct) return direct.event.type;
  }
  if (!isOpen(c)) return null;
  const back = exits.find(
    ({ event, to }) =>
      event.type !== reopen &&
      event.clears_outcome &&
      !event.closure &&
      event.consultation_answer === null &&
      !isForward(c.stage, to, p),
  );
  return back?.event.type ?? null;
}

// ---------------------------------------------------------------------------
// The steps a role may record next (the case page's generic "Record next step")
// ---------------------------------------------------------------------------

export type NextStep = {
  event: string;
  label: string;
  // The stage the case is in after the step; the current stage for a step that does not move it.
  to: string;
  to_label: string;
  moves_stage: boolean;
  // The step needs an outcome from the closed vocabulary (a closure proposal).
  needs_outcome: boolean;
  // The step names a new owner (a hand-over while the case is owned).
  needs_owner: boolean;
};

// Every event this role may record on the case now, read from the template: the exits
// from the current stage plus the events that do not move it. Left out, because each has
// its own control and its own rules: the closure confirmation (the physician's closure
// screen), consultation answers (the answer form), the provider move (its own form), the
// system's triggers, and an assignment while the case is unowned (the assign-owner form).
// A proposal to close is offered only once a document that could support some outcome is
// attached; the closure itself still checks all three conditions.
export function nextSteps(c: EngineCase, role: Role): NextStep[] {
  const p = pathwayOf(c.pathway_id);
  if (!isOpen(c) || !stageDefinition(c.stage, p)) return [];
  const owned = c.owner_actor_id !== null;
  // Forward steps first, then the ones that do not move the case, then the ones that
  // send it back, so the usual next step heads the list.
  const forward: NextStep[] = [];
  const stay: NextStep[] = [];
  const back: NextStep[] = [];

  for (const { event, to } of exitsFrom(c.stage, p)) {
    if (!event.roles.includes(role) || event.closure || event.consultation_answer !== null) continue;
    const proposesClosure = isAwaitingClosure(to, p);
    if (proposesClosure && !evidenceAttached(null, c.documents, p)) continue;
    (isForward(c.stage, to, p) ? forward : back).push({
      event: event.type,
      label: event.label,
      to,
      to_label: stageLabel(to, p),
      moves_stage: true,
      needs_outcome: proposesClosure,
      needs_owner: false,
    });
  }

  for (const event of Object.values(p.events)) {
    if (event.moves_stage || !event.roles.includes(role)) continue;
    if (event.sets_provider || event.consultation_answer !== null || event.owner === "clear") continue;
    if (event.owner === "assign" && !owned) continue;
    stay.push({
      event: event.type,
      label: event.label,
      to: c.stage,
      to_label: stageLabel(c.stage, p),
      moves_stage: false,
      needs_outcome: false,
      needs_owner: event.owner === "assign",
    });
  }
  return [...forward, ...stay, ...back];
}

export function canPerform(c: EngineCase, role: Role, action: Action): boolean {
  return availableActions(c, role).includes(action);
}

// ---------------------------------------------------------------------------
// TICKET-08 / TICKET-11: unowned triggers, consultations, stitching (all template data)
// ---------------------------------------------------------------------------

export const UNOWNED: PathwayUnowned | null = DEFAULT_RULES.unowned;
export const CONSULTATION: PathwayConsultation | null = DEFAULT_RULES.consultation;
export const STITCHING: PathwayStitching | null = DEFAULT_RULES.stitching;

function consultationRoleAllowed(kind: "request" | "answer", role: Role, p: Pathway): boolean {
  const consultation = p.consultation;
  if (!consultation) return false;
  return (kind === "request" ? consultation.request_roles : consultation.answer_roles).includes(role);
}

// Every event the template marks `owner: "clear"` is an unowned trigger.
export function clearsOwner(type: string, pathway?: PathwayRef): boolean {
  return eventDefinition(type, pathway)?.owner === "clear";
}

export function isConsultationAnswerEvent(type: string, pathway?: PathwayRef): boolean {
  return (eventDefinition(type, pathway)?.consultation_answer ?? null) !== null;
}

// The event that records one kind of consultation answer.
export function consultationAnswerEvent(
  answer: ConsultationAnswer,
  pathway?: PathwayRef,
): PathwayEvent | null {
  return (
    Object.values(pathwayOf(pathway).events).find((event) => event.consultation_answer === answer) ??
    null
  );
}

export function isConsultationAnswer(value: unknown): value is ConsultationAnswer {
  return typeof value === "string" && (CONSULTATION_ANSWERS as readonly string[]).includes(value);
}

// The stitching rule for an incoming resource: by type, status and (for reports) the
// kind of document it carries. Null when the template has no rule for it.
export function stitchingRule(
  resource: string,
  status: string,
  documentKind: string | null,
  pathway?: PathwayRef,
): StitchingRule | null {
  const stitching = pathwayOf(pathway).stitching;
  if (!stitching) return null;
  return (
    stitching.rules.find(
      (rule) =>
        rule.resource === resource &&
        rule.statuses.includes(status) &&
        (rule.document_kind === null || rule.document_kind === documentKind),
    ) ?? null
  );
}

// The resource types any pathway stitches: ingest checks the type before it knows which
// case (and so which pathway) a resource belongs to.
export function stitchedResourceTypes(): string[] {
  const rules = PATHWAYS.flatMap((p) => p.stitching?.rules ?? []);
  return [...new Set(rules.map((rule) => rule.resource))];
}

// ---------------------------------------------------------------------------
// Closure rules
// ---------------------------------------------------------------------------

export type ClosureDetails = {
  final_outcome: boolean;
  evidence_attached: boolean;
  physician_confirmation: boolean;
};

function evidenceSatisfies(outcomeKey: string, kinds: ReadonlySet<string>, p: Pathway): boolean {
  const outcome = p.outcomes.find((o) => o.key === outcomeKey);
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
  pathway?: PathwayRef,
): boolean {
  const p = pathwayOf(pathway);
  const kinds = new Set(documents.map((doc) => doc.kind));
  if (isValidOutcome(finalOutcome, p)) return evidenceSatisfies(finalOutcome, kinds, p);
  return p.outcomes.some((outcome) => evidenceSatisfies(outcome.key, kinds, p));
}

// The three conditions from TICKET-05. `actingRole` is passed only by the confirm
// endpoint, where the physician's own act is the confirmation; a pre-existing
// confirmation event satisfies it on every other read.
export function closureConditions(c: EngineCase, actingRole?: Role | "system"): ClosureDetails {
  return {
    final_outcome: isValidOutcome(c.final_outcome, c.pathway_id),
    evidence_attached: evidenceAttached(c.final_outcome, c.documents, c.pathway_id),
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
