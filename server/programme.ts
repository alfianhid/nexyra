import { addHours, DEMO_START, embeddedClock, formatDue, getClock, hoursBetween } from "./clock.js";
import type { Db } from "./db.js";
import {
  PATHWAY,
  REPORTED_LIMIT,
  ReplayError,
  STAGES,
  TERMINAL_STAGE,
  eventDefinition,
  isAwaitingClosure,
  isClosed,
  nextState,
  stageDefinition,
  stageLabel,
  type CaseState,
  type Role,
} from "./engine.js";
import { HttpError } from "./errors.js";

// GET /api/program/summary (TICKET-16). Read only. Every number is computed at request
// time from `cases`, `events` and `extractions`, at the demo clock's `now`; nothing is
// stored and nothing comes from a fixture. Stage history comes from replaying each
// case's events with the engine's own `nextState`, so the funnel cannot disagree with
// the timeline the case detail page shows.
//
// Cost: a fixed number of queries whatever the cohort size (cases, events, extractions,
// one sqlite_master check, and the unstitched queue when that table exists). There is
// no per-case query.

export const SYNTHETIC_DATA_LABEL =
  "Synthetic data. Drop-off rates are input assumptions, not results.";

// docs/api.md permission table: "Read the program view" is the responsible physician
// and the program manager.
export const PROGRAMME_READ_ROLES: readonly Role[] = ["responsible_physician", "program_manager"];

export function assertMayReadProgramme(role: Role): void {
  if (!PROGRAMME_READ_ROLES.includes(role)) {
    throw new HttpError(
      403,
      "role_not_permitted",
      `The ${role} role may not read the program view.`,
    );
  }
}

// The closed set from POST /api/tasks/{task_id}/complete (TICKET-10).
const DELAY_REASONS = [
  { key: "fear", label: "Fear" },
  { key: "transport", label: "Transport" },
  { key: "cost", label: "Cost" },
  { key: "language", label: "Language" },
  { key: "other", label: "Other" },
] as const;

// Staff record a delay reason on an outreach attempt or when completing a task, one count
// per barrier. A `task_completed` the outreach ladder writes for a logged call carries the
// call's reason as a copy (`outreach_event_id` names the call), so it is not counted again.
function carriesStaffDelayReason(type: string, payload: Record<string, unknown>): boolean {
  if (type.startsWith("outreach_")) return true;
  return type === "task_completed" && typeof payload.outreach_event_id !== "string";
}

const ROLE_LABELS: Record<string, string> = {
  coordination_staff: "Coordination staff",
  navigator: "Navigator",
  responsible_physician: "Responsible physician",
  program_manager: "Program manager",
};

// Atlas et al., JAMA 2023 (docs/evidence.md): usual care against the reminder, letter
// and phone outreach arm. The only effect size the scenario panel uses.
const SCENARIO = {
  baseline_rate: 0.229,
  outreach_rate: 0.31,
  source: "Atlas et al., JAMA 2023: follow-up completed 22.9% with usual care, 31.0% with reminder, letter and phone outreach",
  caveat:
    "One trial in one US health system. It does not say what would happen in Abu Dhabi, and it is not a result of Nexyra.",
};

// Referral-to-colonoscopy distribution, in days. The bucket edge at the limit is the
// limit itself, so every bucket is either within it or over it.
function limitBuckets(maxDays: number): { min: number; max: number | null }[] {
  const edges = [7, 14, 21, maxDays, maxDays + 14].filter(
    (edge, index, all) => edge > 0 && (index === 0 || edge > all[index - 1]!),
  );
  const buckets: { min: number; max: number | null }[] = [];
  let min = 0;
  for (const edge of edges) {
    buckets.push({ min, max: edge });
    min = edge + 1;
  }
  buckets.push({ min, max: null });
  return buckets;
}

type CaseRow = {
  id: string;
  stage: string;
  status: string;
  owner_actor_id: string | null;
  owner_name: string | null;
  stage_entered_at: string | null;
  created_at: string;
};

type EventRow = {
  case_id: string;
  type: string;
  actor_id: string;
  actor_role: string;
  occurred_at: string;
  payload: string;
};

type Trace = {
  state: CaseState | null;
  // The first time the case entered each stage, demo-clock time.
  firstEntered: Map<string, string>;
  unownedSince: string | null;
  closedAt: string | null;
  replayed: boolean;
};

function parsePayload(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function step(trace: Trace, event: EventRow, payload: Record<string, unknown>): void {
  const previous = trace.state;
  const next = nextState(previous, {
    type: event.type,
    actor_id: event.actor_id,
    actor_role: event.actor_role,
    occurred_at: event.occurred_at,
    payload,
  });
  if (next === previous || next === null) return;
  trace.state = next;

  const enter = (stage: string) => {
    if (!trace.firstEntered.has(stage)) trace.firstEntered.set(stage, event.occurred_at);
  };

  // The closure endpoint's confirmation finalises straight to closed; the case still
  // passed through the stage the event names, so both count as reached.
  const definition = eventDefinition(event.type);
  if (previous && definition?.finalises_to && payload.finalises === true) {
    const via = stageDefinition(previous.stage)?.exits.find((exit) => exit.event === event.type)?.to;
    if (via && via !== next.stage) enter(via);
  }
  if (previous === null || next.stage !== previous.stage || next.stage_entered_at !== previous.stage_entered_at) {
    enter(next.stage);
  }

  if (next.stage === TERMINAL_STAGE && previous?.stage !== TERMINAL_STAGE) trace.closedAt = event.occurred_at;
  if (next.stage !== TERMINAL_STAGE) trace.closedAt = null;

  if (next.owner_actor_id === null) {
    if (previous === null || previous.owner_actor_id !== null) trace.unownedSince = event.occurred_at;
  } else {
    trace.unownedSince = null;
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.round(value * 10) / 10;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function durationWords(hours: number): string {
  const h = Math.max(0, hours);
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.floor(h / 24)} days`;
}

function stageDeadline(stage: string, entered: string): string | null {
  const definition = stageDefinition(stage);
  if (!definition || definition.sla_hours === null) return null;
  return addHours(entered, definition.sla_hours);
}

// Calendar date in the demo offset (+07:00), e.g. "2026-11-18".
function demoDate(iso: string): string {
  return addHours(iso, 0).slice(0, 10);
}

// The unstitched queue belongs to TICKET-08. Until that table exists the section says
// so (`available: false`) instead of failing; once it exists it is read as it is, with
// the column names that ticket is most likely to use.
async function unstitchedQueue(db: Db) {
  const table = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unstitched'")
    .get<{ name: string }>();
  if (!table) return { available: false, count: 0, rows: [] as UnstitchedRow[] };

  // Schema from TICKET-08 (server/db.ts). A row matched to a case later is 'stitched'
  // and is no longer an exception.
  const raw = await db
    .prepare(
      `SELECT id, resource_type, resource_id, reason, received_at
         FROM unstitched
        WHERE status = 'queued'
        ORDER BY received_at, id`,
    )
    .all<{
      id: string;
      resource_type: string;
      resource_id: string;
      reason: string;
      received_at: string | null;
    }>();

  const rows: UnstitchedRow[] = raw.map((row) => ({
    id: row.id,
    received_at: row.received_at,
    received_label: row.received_at ? formatDue(row.received_at) : "—",
    reason: row.reason || "Matched no case",
    summary: `${row.resource_type} ${row.resource_id}`,
  }));
  return { available: true, count: rows.length, rows };
}

type UnstitchedRow = {
  id: string;
  received_at: string | null;
  received_label: string;
  reason: string;
  summary: string;
};

export type ProgrammeException = {
  case_id: string;
  kind: "unowned" | "past_referral_limit" | "closure_held";
  reason: string;
  owner: string;
  stage_label: string;
  due_at: string | null;
  due_label: string;
};

export async function programmeSummary(db: Db, role: Role) {
  assertMayReadProgramme(role);
  const now = (await getClock(db)).now;
  const clock = await embeddedClock(db);

  // TICKET-18: the programme view is one pathway's funnel (the default, FIT). Cases on
  // another template have other stages and another limit, so they are left out here
  // rather than mixed into this funnel.
  const cases = await db
    .prepare(
      `SELECT c.id, c.stage, c.status, c.owner_actor_id, c.stage_entered_at, c.created_at,
              a.display_name AS owner_name
         FROM cases c
         LEFT JOIN actors a ON a.id = c.owner_actor_id
        WHERE c.pathway_id = ?
        ORDER BY c.id`,
    )
    .all<CaseRow>(PATHWAY.id);

  const events = await db
    .prepare(
      `SELECT case_id, type, actor_id, actor_role, occurred_at, payload
         FROM events
        WHERE case_id IN (SELECT id FROM cases WHERE pathway_id = ?)
        ORDER BY rowid`,
    )
    .all<EventRow>(PATHWAY.id);

  // The latest reading per case, the same row the case detail's `verification` reads.
  const readings = await db
    .prepare("SELECT case_id, proposal FROM extractions ORDER BY created_at, rowid")
    .all<{ case_id: string; proposal: string }>();
  const proposalByCase = new Map<string, string>();
  for (const row of readings) proposalByCase.set(row.case_id, row.proposal);

  // ---- one pass over the event trail -----------------------------------------------
  const traces = new Map<string, Trace>();
  const delayCounts = new Map<string, number>();
  const escalations: { day: number; role: string }[] = [];

  // TICKET-15: where the physician and the AI reading parted ways. A rejected proposal, or
  // a closure confirmed while the reading on the case proposed something other than closure.
  const lastProposal = new Map<string, string>();
  const divergence = { proposals_rejected: 0, closed_against_reading: 0 };

  for (const event of events) {
    const payload = parsePayload(event.payload);

    if (carriesStaffDelayReason(event.type, payload) && typeof payload.delay_reason === "string") {
      delayCounts.set(payload.delay_reason, (delayCounts.get(payload.delay_reason) ?? 0) + 1);
    }
    if (event.type === "extraction_completed" && typeof payload.proposal === "string") {
      lastProposal.set(event.case_id, payload.proposal);
    }
    if (event.type === "proposal_rejected" && event.actor_role === "responsible_physician") {
      divergence.proposals_rejected += 1;
    }
    if (event.type === "closure_confirmed" && event.actor_role === "responsible_physician") {
      const reading = lastProposal.get(event.case_id);
      if (reading !== undefined && reading !== "propose_closure") divergence.closed_against_reading += 1;
    }
    if (event.type === "deadline_missed" && typeof payload.escalated_to === "string") {
      escalations.push({
        day: Math.floor(hoursBetween(DEMO_START, event.occurred_at) / 24),
        role: payload.escalated_to,
      });
    }

    let trace = traces.get(event.case_id);
    if (!trace) {
      trace = { state: null, firstEntered: new Map(), unownedSince: null, closedAt: null, replayed: true };
      traces.set(event.case_id, trace);
    }
    if (!trace.replayed) continue;
    try {
      step(trace, event, payload);
    } catch (error) {
      // A history the engine cannot replay (a row written straight into the table by a
      // test) keeps what it had; its current stage then comes from the case row.
      if (!(error instanceof ReplayError)) throw error;
      trace.replayed = false;
    }
  }

  // ---- per-case current position ------------------------------------------------------
  type Position = {
    row: CaseRow;
    trace: Trace | undefined;
    stage: string;
    open: boolean;
    unowned: boolean;
    entered: string;
  };
  const positions: Position[] = cases.map((row) => {
    const trace = traces.get(row.id);
    const state = trace?.replayed && trace.state ? trace.state : null;
    const stage = state?.stage ?? row.stage;
    const status = state?.status ?? row.status;
    const owner = state ? state.owner_actor_id : row.owner_actor_id;
    const open = !isClosed({ stage, status });
    return {
      row,
      trace,
      stage,
      open,
      unowned: open && owner === null,
      entered: state?.stage_entered_at ?? row.stage_entered_at ?? row.created_at,
    };
  });

  const limit = REPORTED_LIMIT;

  // Referral-limit span, measured exactly as the worklist's days_left_referral_limit:
  // from first entering the start stage (or the result, before any referral) to first
  // reaching the end stage (or now).
  const limitOf = (p: Position) => {
    if (!limit) return null;
    const start = p.trace?.firstEntered.get(limit.from_stage) ?? null;
    const end = p.trace?.firstEntered.get(limit.to_stage) ?? null;
    const daysLeft = Math.round(
      limit.max_days - hoursBetween(start ?? p.row.created_at, end ?? now) / 24,
    );
    return { start, end, daysLeft, elapsed: limit.max_days - daysLeft };
  };

  // ---- exceptions -----------------------------------------------------------------------
  const unowned: (ProgrammeException & { _hours: number })[] = [];
  const pastLimit: (ProgrammeException & { _over: number })[] = [];
  const held: (ProgrammeException & { _since: string })[] = [];

  for (const p of positions) {
    if (!p.open) continue;
    const deadline = stageDeadline(p.stage, p.entered);
    const base = {
      case_id: p.row.id,
      owner: p.unowned ? "—" : (p.row.owner_name ?? p.row.owner_actor_id ?? "—"),
      stage_label: stageLabel(p.stage),
      due_at: deadline,
      due_label: deadline ? formatDue(deadline) : "—",
    };

    if (p.unowned) {
      const since = p.trace?.unownedSince ?? p.entered;
      const hours = hoursBetween(since, now);
      unowned.push({ ...base, kind: "unowned", reason: `Unowned ${durationWords(hours)}`, _hours: hours });
    }

    const span = limitOf(p);
    if (limit && span && span.end === null && span.daysLeft < 0) {
      const limitDue = addHours(span.start ?? p.row.created_at, limit.max_days * 24);
      const reason = span.start
        ? `${span.elapsed} days since referral, no colonoscopy yet (limit ${limit.max_days})`
        : `${span.elapsed} days since result, not referred yet (limit ${limit.max_days})`;
      pastLimit.push({
        ...base,
        kind: "past_referral_limit",
        reason,
        due_at: limitDue,
        due_label: formatDue(limitDue),
        _over: -span.daysLeft,
      });
    }

    const proposal = proposalByCase.get(p.row.id);
    if (isAwaitingClosure(p.stage) && proposal !== undefined && proposal !== "propose_closure") {
      held.push({
        ...base,
        kind: "closure_held",
        reason: `Closure held: the latest reading proposes "${proposal.replace(/_/g, " ")}"`,
        _since: p.entered,
      });
    }
  }

  unowned.sort((a, b) => b._hours - a._hours || a.case_id.localeCompare(b.case_id));
  pastLimit.sort((a, b) => b._over - a._over || a.case_id.localeCompare(b.case_id));
  held.sort((a, b) => a._since.localeCompare(b._since) || a.case_id.localeCompare(b.case_id));
  const strip = <T extends ProgrammeException>(row: T): ProgrammeException => ({
    case_id: row.case_id,
    kind: row.kind,
    reason: row.reason,
    owner: row.owner,
    stage_label: row.stage_label,
    due_at: row.due_at,
    due_label: row.due_label,
  });
  const exceptions = [...unowned, ...pastLimit, ...held].map(strip);

  // ---- funnel ---------------------------------------------------------------------------
  const order = STAGES.map((stage) => stage.key);
  const funnel = STAGES.map((stage, index) => {
    let reached = 0;
    const gaps: number[] = [];
    for (const p of positions) {
      const at = p.trace?.firstEntered.get(stage.key);
      if (!at) continue;
      reached += 1;
      // From the latest earlier stage this case reached, so a stage the case skipped
      // (closure confirmed by the closure endpoint goes straight to closed) does not
      // leave a gap in the medians.
      for (let back = index - 1; back >= 0; back -= 1) {
        const before = p.trace?.firstEntered.get(order[back]!);
        if (!before) continue;
        const days = hoursBetween(before, at) / 24;
        if (days >= 0) gaps.push(days);
        break;
      }
    }
    const here = positions.filter((p) => p.open && p.stage === stage.key);
    return {
      key: stage.key,
      stage: stage.label,
      reached,
      open: here.length,
      unowned: here.filter((p) => p.unowned).length,
      median_days_from_previous: index === 0 ? null : median(gaps),
      terminal: stage.key === TERMINAL_STAGE,
    };
  });

  // ---- referral to colonoscopy against the limit -----------------------------------------
  const referral = limit
    ? (() => {
        const buckets = limitBuckets(limit.max_days).map((bucket) => ({
          label: bucket.max === null ? `${bucket.min}+ days` : `${bucket.min}–${bucket.max} days`,
          min_days: bucket.min,
          max_days: bucket.max,
          over_limit: bucket.min > limit.max_days,
          completed: 0,
          waiting: 0,
        }));
        const completedDays: number[] = [];
        let completedOver = 0;
        let waitingOver = 0;
        for (const p of positions) {
          const span = limitOf(p);
          if (!span || span.start === null) continue;
          const isCompleted = span.end !== null;
          if (!isCompleted && !p.open) continue;
          const days = Math.max(0, span.elapsed);
          const bucket = buckets.find(
            (b) => days >= b.min_days && (b.max_days === null || days <= b.max_days),
          );
          if (!bucket) continue;
          if (isCompleted) {
            bucket.completed += 1;
            completedDays.push(days);
            if (span.daysLeft < 0) completedOver += 1;
          } else {
            bucket.waiting += 1;
            if (span.daysLeft < 0) waitingOver += 1;
          }
        }
        return {
          limit_days: limit.max_days,
          label: limit.label,
          source: limit.source,
          completed: completedDays.length,
          completed_within_limit: completedDays.length - completedOver,
          completed_over_limit: completedOver,
          waiting: buckets.reduce((sum, b) => sum + b.waiting, 0),
          waiting_over_limit: waitingOver,
          median_days_completed: median(completedDays),
          buckets,
        };
      })()
    : null;

  // ---- delay reasons --------------------------------------------------------------------
  const known = new Set<string>(DELAY_REASONS.map((r) => r.key));
  const delay_reasons: { delay_reason: string; label: string; count: number }[] = DELAY_REASONS.map((reason) => ({
    delay_reason: reason.key,
    label: reason.label,
    count: delayCounts.get(reason.key) ?? 0,
  }));
  // A value outside the closed set (written before validation existed) is still counted.
  const otherUnknown = [...delayCounts.entries()].filter(([key]) => !known.has(key));
  for (const [key, count] of otherUnknown) {
    delay_reasons.push({ delay_reason: key, label: key, count });
  }

  // ---- escalations per role per demo day ------------------------------------------------
  const ladderRoles = new Set<string>();
  for (const stage of STAGES) for (const role of stage.escalation) ladderRoles.add(role);
  for (const e of escalations) ladderRoles.add(e.role);
  const roles = [...ladderRoles];
  const lastDay = Math.max(clock.day, ...escalations.map((e) => e.day), 0);
  const days = lastDay + 1;
  const escalations_by_day = Array.from({ length: days }, (_, day) => {
    const start = addHours(DEMO_START, day * 24);
    return {
      day,
      label: `Day ${day} · ${formatDue(start).split(" ").slice(0, 2).join(" ")}`,
      per_role: roles.map((role) => ({
        role,
        count: escalations.filter((e) => e.day === day && e.role === role).length,
      })),
    };
  });
  const escalations_per_role_per_day = roles.map((role) => {
    const total = escalations.filter((e) => e.role === role).length;
    return {
      role,
      role_label: ROLE_LABELS[role] ?? role,
      total,
      per_day: round1(total / days),
    };
  });

  // ---- counts ---------------------------------------------------------------------------
  const open = positions.filter((p) => p.open);
  const today = demoDate(now);
  const dueToday = open.filter((p) => {
    const deadline = stageDeadline(p.stage, p.entered);
    return deadline !== null && demoDate(deadline) === today;
  });
  const weekAgo = addHours(now, -24 * 7);
  const closedThisWeek = positions.filter((p) => {
    const at = p.trace?.closedAt;
    return (
      !p.open &&
      at !== null &&
      at !== undefined &&
      hoursBetween(weekAgo, at) > 0 &&
      hoursBetween(at, now) >= 0
    );
  });

  const scenarioCohort = positions.length;
  const scenario = {
    title: "Scenario based on assumptions",
    cohort_cases: scenarioCohort,
    baseline_rate: SCENARIO.baseline_rate,
    outreach_rate: SCENARIO.outreach_rate,
    additional_completed: Math.round(
      scenarioCohort * (SCENARIO.outreach_rate - SCENARIO.baseline_rate),
    ),
    source: SCENARIO.source,
    caveat: SCENARIO.caveat,
  };

  return {
    clock,
    synthetic_data_label: SYNTHETIC_DATA_LABEL,
    counts: {
      total: positions.length,
      open: open.length,
      unowned: open.filter((p) => p.unowned).length,
      due_today: dueToday.length,
      due_today_unowned: dueToday.filter((p) => p.unowned).length,
      closed_this_week: closedThisWeek.length,
      past_referral_limit: pastLimit.length,
      closures_held: held.length,
    },
    exceptions,
    unstitched: await unstitchedQueue(db),
    funnel,
    referral_to_colonoscopy: referral,
    delay_reasons,
    ai_divergence: {
      count: divergence.proposals_rejected + divergence.closed_against_reading,
      ...divergence,
    },
    escalations_per_role_per_day,
    escalations_by_day,
    scenario,
    pathway: { id: PATHWAY.id, label: PATHWAY.label },
  };
}

export type ProgrammeSummary = Awaited<ReturnType<typeof programmeSummary>>;
