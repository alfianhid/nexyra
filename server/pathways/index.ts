import { readFileSync } from "node:fs";
import {
  ACTIONS,
  EVENT_ROLES,
  ROLES,
  type Action,
  type EventRole,
  type Role,
} from "../vocabulary.js";
import fitColonoscopy from "./fit-colonoscopy.json" with { type: "json" };

// TICKET-04: a pathway is data. This file reads a template, checks it by hand (no schema
// library), and hands the engine a typed, frozen object. A template that fails a check
// throws at import time, so the server refuses to start and says which field is wrong.

export type OwnerEffect = "keep" | "clear" | "assign" | "assign_if_unowned";

export type PathwayEvent = {
  type: string;
  label: string;
  roles: readonly EventRole[];
  // What the event does to the case owner. `clear` is the only way into the explicit
  // unowned state; `assign` and `assign_if_unowned` read the owner from the payload.
  owner: OwnerEffect;
  clears_outcome: boolean;
  // Closing events: never writable by `system` or coordination staff (checked below).
  closure: boolean;
  // When the payload carries `finalises: true`, the event moves the case straight to
  // this stage (the closure endpoint's one-step confirmation).
  finalises_to: string | null;
  moves_stage: boolean;
  // TICKET-08/11 (all optional in the file): the event sets the case's current provider
  // from payload.provider_id; it sets the case's latest referral to this status; it is
  // the answer to a consultation and may only be recorded through the answer endpoint.
  sets_provider: boolean;
  referral_status: string | null;
  consultation_answer: ConsultationAnswer | null;
};

// --- TICKET-08 / TICKET-11 template blocks --------------------------------------

export const CONSULTATION_ANSWERS = ["accepted", "redirected", "more_data_requested"] as const;
export type ConsultationAnswer = (typeof CONSULTATION_ANSWERS)[number];

export const REFERRAL_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "expired",
  "redirected",
] as const;

export type PathwayUnowned = {
  acceptance_stage: string;
  unanswered_event: string;
  moved_event: string;
  assign_owner_role: Role;
  assign_owner_hours: number;
  source: string;
};

export type PathwayConsultation = {
  request_roles: readonly Role[];
  answer_roles: readonly Role[];
  answer_hours: number;
  more_data_hours: number;
  escalation: readonly Role[];
  source: string;
};

export type StitchingRule = {
  resource: string;
  statuses: readonly string[];
  document_kind: string | null;
  event: string | null;
};

export type PathwayStitching = { source: string; rules: readonly StitchingRule[] };

export type StageExit = { event: string; to: string };

export type PathwayStage = {
  key: string;
  label: string;
  short_label: string;
  order: number;
  owner_role: Role;
  sla_hours: number | null;
  urgency: number;
  escalation: readonly Role[];
  exits: readonly StageExit[];
  consultation: boolean;
  awaiting_closure: boolean;
  source: string;
  notes: string | null;
};

export type PathwayOutcome = {
  key: string;
  label: string;
  evidence: { any_of: readonly string[]; all_of: readonly string[] };
  source: string;
};

export type PathwayLimit = {
  key: string;
  label: string;
  from_stage: string;
  to_stage: string;
  max_days: number;
  reported_as: string | null;
  source: string;
};

export type PathwayAction = { roles: readonly Role[] | null; event: string | null };

export type Pathway = {
  id: string;
  version: number;
  label: string;
  trigger: { description: string; event: string; initial_stage: string; source: string };
  terminal_stage: string;
  escalation_spacing_hours: number;
  stages: readonly PathwayStage[];
  events: Readonly<Record<string, PathwayEvent>>;
  actions: Readonly<Partial<Record<Action, PathwayAction>>>;
  limits: readonly PathwayLimit[];
  outcomes: readonly PathwayOutcome[];
  // TICKET-08 / TICKET-11; null when a template has no such block.
  unowned: PathwayUnowned | null;
  consultation: PathwayConsultation | null;
  stitching: PathwayStitching | null;
};

export class PathwayTemplateError extends Error {
  constructor(
    readonly origin: string,
    readonly problems: readonly string[],
  ) {
    super(
      `Pathway template ${origin} is invalid; the server will not start until it is fixed:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
    this.name = "PathwayTemplateError";
  }
}

const OWNER_EFFECTS: readonly OwnerEffect[] = ["keep", "clear", "assign", "assign_if_unowned"];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Collects every problem instead of stopping at the first, so one run of the server
// lists everything a reviewer has to fix in the file.
class Checker {
  readonly problems: string[] = [];

  fail(path: string, message: string): void {
    this.problems.push(`${path} ${message}`);
  }

  string(obj: Json, key: string, path: string): string {
    const value = obj[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      this.fail(`${path}.${key}`, "must be a non-empty string");
      return "";
    }
    return value;
  }

  optionalString(obj: Json, key: string, path: string): string | null {
    if (obj[key] === undefined) return null;
    return this.string(obj, key, path);
  }

  number(obj: Json, key: string, path: string, rule: "positive" | "any" = "any"): number {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.fail(`${path}.${key}`, "must be a number");
      return 0;
    }
    if (rule === "positive" && value <= 0) {
      this.fail(`${path}.${key}`, "must be greater than 0");
    }
    return value;
  }

  boolean(obj: Json, key: string, path: string): boolean {
    const value = obj[key];
    if (value === undefined) return false;
    if (typeof value !== "boolean") {
      this.fail(`${path}.${key}`, "must be true or false");
      return false;
    }
    return value;
  }

  object(obj: Json, key: string, path: string): Json {
    const value = obj[key];
    if (!isObject(value)) {
      this.fail(`${path}.${key}`, "must be an object");
      return {};
    }
    return value;
  }

  array(obj: Json, key: string, path: string, allowEmpty = false): unknown[] {
    const value = obj[key];
    if (!Array.isArray(value)) {
      this.fail(`${path}.${key}`, "must be an array");
      return [];
    }
    if (!allowEmpty && value.length === 0) this.fail(`${path}.${key}`, "must not be empty");
    return value;
  }

  roles<T extends string>(
    obj: Json,
    key: string,
    path: string,
    allowed: readonly T[],
    allowEmpty = false,
  ): T[] {
    const list = this.array(obj, key, path, allowEmpty);
    const out: T[] = [];
    list.forEach((value, index) => {
      if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
        this.fail(`${path}.${key}[${index}]`, `must be one of ${allowed.join(", ")}`);
      } else {
        out.push(value as T);
      }
    });
    return out;
  }

  strings(obj: Json, key: string, path: string): string[] {
    if (obj[key] === undefined) return [];
    const list = this.array(obj, key, path, true);
    return list.filter((value, index) => {
      if (typeof value !== "string" || value.length === 0) {
        this.fail(`${path}.${key}[${index}]`, "must be a non-empty string");
        return false;
      }
      return true;
    }) as string[];
  }
}

export function validatePathway(raw: unknown, origin: string): Pathway {
  const c = new Checker();
  if (!isObject(raw)) throw new PathwayTemplateError(origin, ["the template must be a JSON object"]);

  const id = c.string(raw, "id", "template");
  const version = c.number(raw, "version", "template", "positive");
  const label = c.string(raw, "label", "template");
  const terminal = c.string(raw, "terminal_stage", "template");
  const spacing = c.number(raw, "escalation_spacing_hours", "template", "positive");

  // --- events -------------------------------------------------------------------
  const rawEvents = c.object(raw, "events", "template");
  const events: Record<string, PathwayEvent> = {};
  for (const [type, value] of Object.entries(rawEvents)) {
    const path = `events.${type}`;
    if (!isObject(value)) {
      c.fail(path, "must be an object");
      continue;
    }
    const owner = value.owner === undefined ? "keep" : value.owner;
    if (!(OWNER_EFFECTS as readonly unknown[]).includes(owner)) {
      c.fail(`${path}.owner`, `must be one of ${OWNER_EFFECTS.join(", ")}`);
    }
    events[type] = {
      type,
      label: c.string(value, "label", path),
      roles: c.roles(value, "roles", path, EVENT_ROLES),
      owner: (OWNER_EFFECTS as readonly unknown[]).includes(owner) ? (owner as OwnerEffect) : "keep",
      clears_outcome: c.boolean(value, "clears_outcome", path),
      closure: c.boolean(value, "closure", path),
      finalises_to: c.optionalString(value, "finalises_to", path),
      moves_stage: value.moves_stage === undefined ? true : c.boolean(value, "moves_stage", path),
      sets_provider: c.boolean(value, "sets_provider", path),
      referral_status: c.optionalString(value, "referral_status", path),
      consultation_answer: c.optionalString(value, "consultation_answer", path) as ConsultationAnswer | null,
    };
  }

  // --- stages -------------------------------------------------------------------
  const rawStages = c.array(raw, "stages", "template");
  const stages: PathwayStage[] = [];
  rawStages.forEach((value, index) => {
    const path = `stages[${index}]`;
    if (!isObject(value)) {
      c.fail(path, "must be an object");
      return;
    }
    const key = c.string(value, "key", path);
    const where = key ? `stages[${index}] (${key})` : path;

    let sla: number | null = null;
    if (value.sla_hours === null) {
      sla = null;
    } else {
      sla = c.number(value, "sla_hours", where, "positive");
    }

    const exits: StageExit[] = [];
    c.array(value, "exits", where, true).forEach((exit, exitIndex) => {
      const exitPath = `${where}.exits[${exitIndex}]`;
      if (!isObject(exit)) {
        c.fail(exitPath, "must be an object");
        return;
      }
      exits.push({ event: c.string(exit, "event", exitPath), to: c.string(exit, "to", exitPath) });
    });

    const ownerRole = value.owner_role;
    if (!(ROLES as readonly unknown[]).includes(ownerRole)) {
      c.fail(`${where}.owner_role`, `must be one of ${ROLES.join(", ")}`);
    }

    stages.push({
      key,
      label: c.string(value, "label", where),
      short_label: c.string(value, "short_label", where),
      order: index,
      owner_role: ownerRole as Role,
      sla_hours: sla,
      urgency: c.number(value, "urgency", where),
      escalation: c.roles(value, "escalation", where, ROLES, true),
      exits,
      consultation: c.boolean(value, "consultation", where),
      awaiting_closure: c.boolean(value, "awaiting_closure", where),
      source: c.string(value, "source", where),
      notes: c.optionalString(value, "notes", where),
    });
  });

  const stageKeys = new Set<string>();
  for (const stage of stages) {
    if (stage.key && stageKeys.has(stage.key)) c.fail(`stages (${stage.key})`, "is defined twice");
    stageKeys.add(stage.key);
  }
  const orderOf = new Map(stages.map((s) => [s.key, s.order]));

  if (terminal && !stageKeys.has(terminal)) {
    c.fail("template.terminal_stage", `names "${terminal}", which is not a stage`);
  }

  for (const stage of stages) {
    const where = `stages (${stage.key})`;
    const isTerminal = stage.key === terminal;

    if (stage.sla_hours === null && !isTerminal) {
      c.fail(`${where}.sla_hours`, "may be null only on the terminal stage");
    }
    if (!isTerminal && stage.escalation.length === 0) {
      c.fail(`${where}.escalation`, "must name at least one role for an open stage");
    }

    for (const exit of stage.exits) {
      const event = events[exit.event];
      if (!event) {
        c.fail(`${where}.exits`, `uses the event "${exit.event}", which is not in events`);
        continue;
      }
      if (!stageKeys.has(exit.to)) {
        c.fail(`${where}.exits`, `sends "${exit.event}" to "${exit.to}", which is not a stage`);
      }
      if (!event.moves_stage) {
        c.fail(`${where}.exits`, `uses "${exit.event}", which is marked moves_stage: false`);
      }
      if (exit.to === terminal && !event.closure) {
        c.fail(`${where}.exits`, `reaches the terminal stage with "${exit.event}", which is not a closure event`);
      }
    }
    const eventsHere = stage.exits.map((exit) => exit.event);
    if (new Set(eventsHere).size !== eventsHere.length) {
      c.fail(`${where}.exits`, "lists the same event twice");
    }

    // Every open stage must be able to move forward, or a case could get stuck there.
    const forward = stage.exits.some((exit) => (orderOf.get(exit.to) ?? -1) > stage.order);
    if (!isTerminal && !forward) {
      c.fail(`${where}.exits`, "has no exit to a later stage, so a case would stop here");
    }
  }

  // The closure guard from TICKET-05 lives in data too: a template that would let the
  // system role or coordination staff close a case does not load.
  for (const event of Object.values(events)) {
    const path = `events.${event.type}`;
    if (event.closure) {
      for (const forbidden of ["system", "coordination_staff"] as const) {
        if (event.roles.includes(forbidden)) {
          c.fail(`${path}.roles`, `includes "${forbidden}", which may never close a case`);
        }
      }
    }
    if (event.finalises_to !== null) {
      if (!event.closure) c.fail(`${path}.finalises_to`, "is allowed only on a closure event");
      if (event.finalises_to !== terminal) {
        c.fail(`${path}.finalises_to`, `must be the terminal stage "${terminal}"`);
      }
    }
    if (!event.moves_stage && event.owner === "keep") {
      c.fail(path, "neither moves the stage nor changes the owner, so it is not a case event");
    }
  }

  // --- trigger ------------------------------------------------------------------
  const rawTrigger = c.object(raw, "trigger", "template");
  const trigger = {
    description: c.string(rawTrigger, "description", "trigger"),
    event: c.string(rawTrigger, "event", "trigger"),
    initial_stage: c.string(rawTrigger, "initial_stage", "trigger"),
    source: c.string(rawTrigger, "source", "trigger"),
  };
  if (trigger.initial_stage && !stageKeys.has(trigger.initial_stage)) {
    c.fail("trigger.initial_stage", `names "${trigger.initial_stage}", which is not a stage`);
  }
  const triggerEvent = events[trigger.event];
  if (trigger.event && !triggerEvent) {
    c.fail("trigger.event", `names "${trigger.event}", which is not in events`);
  } else if (triggerEvent && triggerEvent.owner !== "assign") {
    c.fail(`events.${trigger.event}.owner`, 'must be "assign": a new case starts with an owner');
  }

  // --- outcomes -----------------------------------------------------------------
  const outcomes: PathwayOutcome[] = [];
  c.array(raw, "outcomes", "template").forEach((value, index) => {
    const path = `outcomes[${index}]`;
    if (!isObject(value)) {
      c.fail(path, "must be an object");
      return;
    }
    const evidence = c.object(value, "evidence", path);
    const anyOf = c.strings(evidence, "any_of", `${path}.evidence`);
    const allOf = c.strings(evidence, "all_of", `${path}.evidence`);
    if (anyOf.length === 0 && allOf.length === 0) {
      c.fail(`${path}.evidence`, "must require at least one document kind (any_of or all_of)");
    }
    outcomes.push({
      key: c.string(value, "key", path),
      label: c.string(value, "label", path),
      evidence: { any_of: anyOf, all_of: allOf },
      source: c.string(value, "source", path),
    });
  });
  if (new Set(outcomes.map((o) => o.key)).size !== outcomes.length) {
    c.fail("outcomes", "lists the same key twice");
  }

  // --- limits -------------------------------------------------------------------
  const limits: PathwayLimit[] = [];
  c.array(raw, "limits", "template", true).forEach((value, index) => {
    const path = `limits[${index}]`;
    if (!isObject(value)) {
      c.fail(path, "must be an object");
      return;
    }
    const limit: PathwayLimit = {
      key: c.string(value, "key", path),
      label: c.string(value, "label", path),
      from_stage: c.string(value, "from_stage", path),
      to_stage: c.string(value, "to_stage", path),
      max_days: c.number(value, "max_days", path, "positive"),
      reported_as: c.optionalString(value, "reported_as", path),
      source: c.string(value, "source", path),
    };
    const from = orderOf.get(limit.from_stage);
    const to = orderOf.get(limit.to_stage);
    if (from === undefined) c.fail(`${path}.from_stage`, `names "${limit.from_stage}", which is not a stage`);
    if (to === undefined) c.fail(`${path}.to_stage`, `names "${limit.to_stage}", which is not a stage`);
    if (from !== undefined && to !== undefined) {
      if (from >= to) {
        c.fail(path, "must run from an earlier stage to a later one");
      } else {
        // The stage deadlines inside a limit must fit within it, or a case could be on
        // time at every stage and still break the limit.
        const budget = stages
          .slice(from, to)
          .reduce((sum, stage) => sum + (stage.sla_hours ?? 0), 0);
        if (budget > limit.max_days * 24) {
          c.fail(
            path,
            `allows ${limit.max_days} days, but the stage deadlines from ${limit.from_stage} ` +
              `to ${limit.to_stage} add up to ${budget / 24} days`,
          );
        }
      }
    }
    limits.push(limit);
  });
  if (limits.filter((limit) => limit.reported_as !== null).length > 1) {
    c.fail("limits", "may mark only one limit with reported_as");
  }

  // --- actions ------------------------------------------------------------------
  const rawActions = c.object(raw, "actions", "template");
  const actions: Partial<Record<Action, PathwayAction>> = {};
  for (const [name, value] of Object.entries(rawActions)) {
    const path = `actions.${name}`;
    if (!(ACTIONS as readonly string[]).includes(name) || name === "advance_case") {
      c.fail(path, `is not an action the engine knows (advance_case is derived from exits)`);
      continue;
    }
    if (!isObject(value)) {
      c.fail(path, "must be an object");
      continue;
    }
    const event = c.optionalString(value, "event", path);
    if (event !== null && !events[event]) c.fail(`${path}.event`, `names "${event}", which is not in events`);
    const roles = value.roles === undefined ? null : c.roles(value, "roles", path, ROLES);
    if (roles === null && event === null) c.fail(path, "needs roles, an event, or both");
    actions[name as Action] = { roles, event };
  }

  const { unowned, consultation, stitching } = validateOwnershipBlocks(c, raw, events, stageKeys, terminal);

  if (c.problems.length > 0) throw new PathwayTemplateError(origin, c.problems);

  return deepFreeze({
    id,
    version,
    label,
    trigger,
    terminal_stage: terminal,
    escalation_spacing_hours: spacing,
    stages,
    events,
    actions,
    limits,
    outcomes,
    unowned,
    consultation,
    stitching,
  });
}

// --- TICKET-08 / TICKET-11 validation ---------------------------------------------
// The unowned triggers, the consultation rules and the FHIR stitching rules. Each block
// is optional (a second pathway may have none), but a block that is present must point
// at real stages and events, or the server does not start.
function validateOwnershipBlocks(
  c: Checker,
  raw: Json,
  events: Record<string, PathwayEvent>,
  stageKeys: ReadonlySet<string>,
  terminal: string,
): {
  unowned: PathwayUnowned | null;
  consultation: PathwayConsultation | null;
  stitching: PathwayStitching | null;
} {
  for (const event of Object.values(events)) {
    const path = `events.${event.type}`;
    if (
      event.referral_status !== null &&
      !(REFERRAL_STATUSES as readonly string[]).includes(event.referral_status)
    ) {
      c.fail(`${path}.referral_status`, `must be one of ${REFERRAL_STATUSES.join(", ")}`);
    }
    if (event.consultation_answer !== null) {
      if (!(CONSULTATION_ANSWERS as readonly string[]).includes(event.consultation_answer)) {
        c.fail(`${path}.consultation_answer`, `must be one of ${CONSULTATION_ANSWERS.join(", ")}`);
      }
      // An answered question always leaves the case with an owner.
      if (event.owner !== "assign_if_unowned" && event.owner !== "assign") {
        c.fail(`${path}.owner`, "must assign an owner: a consultation answer never leaves a case unowned");
      }
      if (event.roles.includes("system")) {
        c.fail(`${path}.roles`, "includes system, but a consultation is answered by a person");
      }
    }
  }

  let unowned: PathwayUnowned | null = null;
  if (raw.unowned !== undefined) {
    const block = c.object(raw, "unowned", "template");
    const role = block.assign_owner_role;
    if (!(ROLES as readonly unknown[]).includes(role)) {
      c.fail("unowned.assign_owner_role", `must be one of ${ROLES.join(", ")}`);
    }
    unowned = {
      acceptance_stage: c.string(block, "acceptance_stage", "unowned"),
      unanswered_event: c.string(block, "unanswered_event", "unowned"),
      moved_event: c.string(block, "moved_event", "unowned"),
      assign_owner_role: role as Role,
      assign_owner_hours: c.number(block, "assign_owner_hours", "unowned", "positive"),
      source: c.string(block, "source", "unowned"),
    };
    if (unowned.acceptance_stage && !stageKeys.has(unowned.acceptance_stage)) {
      c.fail("unowned.acceptance_stage", `names "${unowned.acceptance_stage}", which is not a stage`);
    }
    if (unowned.acceptance_stage === terminal) {
      c.fail("unowned.acceptance_stage", "may not be the terminal stage");
    }
    const unanswered = events[unowned.unanswered_event];
    if (!unanswered) {
      c.fail("unowned.unanswered_event", `names "${unowned.unanswered_event}", which is not in events`);
    } else if (unanswered.owner !== "clear" || unanswered.moves_stage || !unanswered.roles.includes("system")) {
      c.fail("unowned.unanswered_event", "must clear the owner, keep the stage and be writable by system");
    }
    const moved = events[unowned.moved_event];
    if (!moved) {
      c.fail("unowned.moved_event", `names "${unowned.moved_event}", which is not in events`);
    } else if (moved.owner !== "clear" || moved.moves_stage || !moved.sets_provider) {
      c.fail("unowned.moved_event", "must clear the owner, keep the stage and set the provider");
    }
  }

  let consultation: PathwayConsultation | null = null;
  if (raw.consultation !== undefined) {
    const block = c.object(raw, "consultation", "template");
    consultation = {
      request_roles: c.roles(block, "request_roles", "consultation", ROLES),
      answer_roles: c.roles(block, "answer_roles", "consultation", ROLES),
      answer_hours: c.number(block, "answer_hours", "consultation", "positive"),
      more_data_hours: c.number(block, "more_data_hours", "consultation", "positive"),
      escalation: c.roles(block, "escalation", "consultation", ROLES),
      source: c.string(block, "source", "consultation"),
    };
    for (const answer of CONSULTATION_ANSWERS) {
      const matching = Object.values(events).filter((e) => e.consultation_answer === answer);
      if (matching.length !== 1) {
        c.fail("consultation", `needs exactly one event with consultation_answer "${answer}" (found ${matching.length})`);
      }
    }
  }

  let stitching: PathwayStitching | null = null;
  if (raw.stitching !== undefined) {
    const block = c.object(raw, "stitching", "template");
    const rules: StitchingRule[] = [];
    c.array(block, "rules", "stitching").forEach((value, index) => {
      const path = `stitching.rules[${index}]`;
      if (!isObject(value)) {
        c.fail(path, "must be an object");
        return;
      }
      const event = value.event === null ? null : c.string(value, "event", path);
      if (event !== null && event !== "" && !events[event]) {
        c.fail(`${path}.event`, `names "${event}", which is not in events`);
      } else if (event && !events[event]?.roles.includes("system")) {
        c.fail(`${path}.event`, `names "${event}", which the system role may not record`);
      }
      rules.push({
        resource: c.string(value, "resource", path),
        statuses: c.strings(value, "statuses", path),
        document_kind: c.optionalString(value, "document_kind", path),
        event,
      });
    });
    stitching = { source: c.string(block, "source", "stitching"), rules };
  }

  return { unowned, consultation, stitching };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

// For tests and the deadlines printout: the same checks against a file on disk.
export function loadPathwayFile(path: string): Pathway {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new PathwayTemplateError(path, [
      `could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  return validatePathway(raw, path);
}

// Imported, not read from disk at runtime, so the template travels inside the Vercel
// function bundle. Validation runs on import: a broken file stops the server here.
export const FIT_COLONOSCOPY: Pathway = validatePathway(
  fitColonoscopy,
  "server/pathways/fit-colonoscopy.json",
);

const REGISTRY: Readonly<Record<string, Pathway>> = { [FIT_COLONOSCOPY.id]: FIT_COLONOSCOPY };

export const DEFAULT_PATHWAY: Pathway = FIT_COLONOSCOPY;

export function getPathway(id: string): Pathway {
  const pathway = REGISTRY[id];
  if (!pathway) throw new Error(`No pathway template carries the id "${id}".`);
  return pathway;
}
