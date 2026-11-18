import type { InStatement } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { addHours, advanceDays, getClock, hoursBetween, setClock, type Clock } from "./clock.js";
import { type Db } from "./db.js";
import { CONSULTATION, PATHWAY, UNOWNED, stageDefinition, type Role } from "./engine.js";
import { SYSTEM_ACTOR, consultationTimerStage, prepareEvent } from "./events.js";
// TICKET-17
import { cohortFilterSql, type TickOptions } from "./cohort.js";
// TICKET-10
import { tickOutreach, type OutreachTickResult } from "./outreach/ladder.js";

// TICKET-06: a case that passes its stage deadline escalates on its own, without anyone
// pressing a button. The escalation lives in three tables that already exist: an event
// (the audit line), a task (the work the next role now has) and a timer row (the proof
// that this level fired, which is what makes tick idempotent).

// Level n alerts the n-th role in the stage's `escalation` ladder, read from the pathway
// template (TICKET-04); the ladder's length is the top level. In the FIT template every
// open stage escalates responsible physician -> program manager -> program manager.
export type EscalationLevel = number;

export function escalationLadder(stage: string): readonly Role[] {
  return stageDefinition(stage)?.escalation ?? [];
}

// A level may fire at most once per case per stage, and only after the previous level
// has had time to be seen (the template's escalation_spacing_hours, demo-clock hours).
// That spacing is what makes "advance 1 day" produce one new escalation, not three.
export const ESCALATION_SPACING_HOURS = PATHWAY.escalation_spacing_hours;

type OpenCaseRow = {
  id: string;
  stage: string;
  status: string;
  stage_entered_at: string | null;
  created_at: string;
  owner_actor_id: string | null;
};

export type TickResult = {
  escalations: number;
  escalations_per_case: {
    case_id: string;
    level: EscalationLevel;
    role: Role;
    consultation_id?: string;
  }[];
  per_role: { role: Role; count: number }[];
  // TICKET-08: cases this tick made unowned because their referral went unanswered.
  unowned_triggered?: number;
  unowned_cases?: string[];
  // TICKET-10
  outreach?: OutreachTickResult;
};

function stageDeadline(row: OpenCaseRow): string | null {
  const definition = stageDefinition(row.stage);
  if (!definition || definition.sla_hours === null) return null;
  return addHours(row.stage_entered_at ?? row.created_at, definition.sla_hours);
}

// ---- TICKET-17: one query per lookup for all cases, never one per case -------------
// Deployed, every query is a round trip to Turso, so a tick must cost the same handful of
// round trips however many cases are open.

// The first actor of each role (by id), the owner an escalation task goes to.
async function actorsByRole(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .prepare("SELECT role, id FROM actors ORDER BY id")
    .all<{ role: string; id: string }>();
  const map = new Map<string, string>();
  for (const row of rows) if (!map.has(row.role)) map.set(row.role, row.id);
  return map;
}

type LastFired = { level: number; fired_at: string };

const timerKey = (caseId: string, stage: string, dueAt: string) => `${caseId}|${stage}|${dueAt}`;

// The highest fired level per (case, stage, due_at). A cancelled timer does not count.
async function lastFiredByKey(db: Db, includeCohort = false): Promise<Map<string, LastFired>> {
  const rows = await db
    .prepare(
      `SELECT case_id, stage, due_at, level, fired_at FROM timers
        WHERE status = 'fired' AND ${cohortFilterSql("case_id", includeCohort)}
        ORDER BY case_id, stage, due_at, level DESC`,
    )
    .all<{ case_id: string; stage: string; due_at: string; level: number; fired_at: string }>();
  const map = new Map<string, LastFired>();
  for (const row of rows) {
    const key = timerKey(row.case_id, row.stage, row.due_at);
    if (!map.has(key)) map.set(key, { level: row.level, fired_at: row.fired_at });
  }
  return map;
}

// Live cases only: the synthetic cohort is history and the clock never escalates it
// (server/cohort.ts).
async function openCases(db: Db, includeCohort = false): Promise<OpenCaseRow[]> {
  return db
    .prepare(
      `SELECT id, stage, status, stage_entered_at, created_at, owner_actor_id
         FROM cases
        WHERE status != 'closed' AND ${cohortFilterSql("id", includeCohort)}`,
    )
    .all<OpenCaseRow>();
}
// ---- end TICKET-17 ----------------------------------------------------------------

// `tick(now)` processes every open case whose stage deadline has passed. It records a
// `deadline_missed` event, opens a task for the escalated role and writes the timer row.
// Every row from one tick goes out in a single batch, so a failure cannot leave an
// event without its timer.
export async function tick(db: Db, now?: string, options: TickOptions = {}): Promise<TickResult> {
  const includeCohort = options.includeCohort === true;
  const at = now ?? (await getClock(db)).now;
  const open = await openCases(db, includeCohort);
  const fired = await lastFiredByKey(db, includeCohort);
  const byRole = await actorsByRole(db);

  const result: TickResult = { escalations: 0, escalations_per_case: [], per_role: [] };
  const counts = new Map<Role, number>();
  const owners = new Map<Role, string | null>();
  const statements: InStatement[] = [];

  for (const row of open) {
    const deadline = stageDeadline(row);
    if (deadline === null) continue;
    if (hoursBetween(deadline, at) < 0) continue; // not late yet

    const ladder = escalationLadder(row.stage);
    const last = fired.get(timerKey(row.id, row.stage, deadline)) ?? null;
    if (last && last.level >= ladder.length) continue; // the ladder is exhausted
    if (last && hoursBetween(last.fired_at, at) < ESCALATION_SPACING_HOURS) continue;
    const level: EscalationLevel = (last?.level ?? 0) + 1;

    const role = ladder[level - 1];
    if (!role) continue;
    if (!owners.has(role)) owners.set(role, byRole.get(role) ?? null);
    const overHours = Math.round(hoursBetween(deadline, at));

    // The unique (case_id, stage, due_at, level) index is the real guard: if two ticks
    // race, the second batch fails on the timer insert and none of its rows land.
    statements.push(
      db
        .prepare(
          `INSERT INTO timers (id, case_id, stage, due_at, level, role, status, fired_at)
           VALUES (?, ?, ?, ?, ?, ?, 'fired', ?)`,
        )
        .bind(`t_${randomUUID().slice(0, 8)}`, row.id, row.stage, deadline, level, role, at),
      db
        .prepare(
          `INSERT INTO events
             (id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload)
           VALUES (?, ?, 'deadline_missed', 'act_system', 'system', ?, ?, ?)`,
        )
        .bind(
          `e_${randomUUID().slice(0, 8)}`,
          row.id,
          at,
          new Date().toISOString(),
          JSON.stringify({
            level,
            escalated_to: role,
            stage: row.stage,
            due_at: deadline,
            hours_over: overHours,
            summary:
              `Escalated to ${role.replace(/_/g, " ")}: ${overHours}h past the ` +
              `${stageDefinition(row.stage)?.label ?? row.stage} deadline`,
          }),
        ),
      db
        .prepare(
          `INSERT INTO tasks (id, case_id, kind, owner_actor_id, due_at, status)
           VALUES (?, ?, 'escalation', ?, ?, 'open')`,
        )
        .bind(`t_${randomUUID().slice(0, 8)}`, row.id, owners.get(role) ?? null, addHours(at, 24)),
    );

    result.escalations += 1;
    result.escalations_per_case.push({ case_id: row.id, level, role });
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }

  // TICKET-08 trigger 2 and TICKET-11: same batch, same idempotency guard (timer rows).
  const unowned = await unansweredReferrals(db, open, at);
  statements.push(...unowned.statements);
  result.unowned_triggered = unowned.cases.length;
  result.unowned_cases = unowned.cases;

  const overdue = await overdueConsultations(db, at, fired, byRole, includeCohort);
  statements.push(...overdue.statements);
  for (const fired of overdue.fired) {
    result.escalations += 1;
    result.escalations_per_case.push(fired);
    counts.set(fired.role, (counts.get(fired.role) ?? 0) + 1);
  }

  await db.batch(statements);

  result.per_role = [...counts.entries()].map(([role, count]) => ({ role, count }));

  // ---- TICKET-10: the patient outreach ladder runs on the same clock ----------------
  // Its steps are not stage escalations, so they are reported apart and never counted in
  // `escalations` (the alert-fatigue figure TICKET-06 asks for).
  result.outreach = await tickOutreach(db, at, options);
  // ---- end TICKET-10 ------------------------------------------------------------------

  return result;
}

// Every stage deadline among open cases, for POST /api/clock/advance {until}.
export async function openDeadlines(db: Db): Promise<string[]> {
  const rows = await openCases(db);
  return rows.map(stageDeadline).filter((iso): iso is string => iso !== null);
}

export type AdvanceResult = {
  clock: Clock;
  escalations: number;
  cases_advanced: number;
  escalations_per_role: { role: Role; count: number }[];
  unowned_triggered: number;
  // TICKET-10
  outreach?: OutreachTickResult;
};

// Advance is: move the clock, then tick. The clock moves first so every event the tick
// writes carries the new time, and `recorded_at` keeps the real time beside it.
export async function advanceClock(
  db: Db,
  input: { days?: number; until?: "next_deadline" },
): Promise<AdvanceResult> {
  const current = await getClock(db);

  let clock: Clock;
  if (input.until === "next_deadline") {
    const deadline = (await openDeadlines(db))
      .filter((iso) => Date.parse(iso) > Date.parse(current.now))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];

    if (!deadline) {
      clock = current;
    } else {
      const days = Math.max(1, Math.round(hoursBetween(current.now, deadline) / 24));
      clock = await setClock(db, deadline, current.day + days);
    }
  } else {
    const days = Math.trunc(input.days ?? 1);
    clock = await advanceDays(db, days);
  }

  const ticked = await tick(db, clock.now);

  return {
    clock,
    escalations: ticked.escalations,
    cases_advanced: 0,
    escalations_per_role: ticked.per_role,
    unowned_triggered: ticked.unowned_triggered ?? 0,
    // TICKET-10
    ...(ticked.outreach ? { outreach: ticked.outreach } : {}),
  };
}

// ---------------------------------------------------------------------------
// TICKET-08 trigger 2: a referral not answered by the acceptance deadline
// ---------------------------------------------------------------------------

// The acceptance deadline is the acceptance stage's own deadline (template
// `unowned.acceptance_stage`). A case still owned and still at that stage past it is
// made unowned once: a timer row keyed on the stage plus "#unanswered" records that the
// trigger fired, so a second tick, or a tick after a new owner was assigned at the same
// stage, does not fire it again.
export function unansweredTimerStage(stage: string): string {
  return `${stage}#unanswered`;
}

async function unansweredReferrals(
  db: Db,
  open: OpenCaseRow[],
  at: string,
): Promise<{ statements: InStatement[]; cases: string[] }> {
  const statements: InStatement[] = [];
  const cases: string[] = [];
  if (!UNOWNED) return { statements, cases };

  // TICKET-17: the trigger's timers for every case in one query, whatever their status
  // (a fired or a cancelled row both mean the trigger already ran).
  const key = unansweredTimerStage(UNOWNED.acceptance_stage);
  const ran = new Set(
    (
      await db
        .prepare("SELECT case_id, due_at FROM timers WHERE stage = ?")
        .all<{ case_id: string; due_at: string }>(key)
    ).map((t) => timerKey(t.case_id, key, t.due_at)),
  );

  for (const row of open) {
    if (row.stage !== UNOWNED.acceptance_stage) continue;
    const deadline = stageDeadline(row);
    if (deadline === null || hoursBetween(deadline, at) < 0) continue;

    if (row.owner_actor_id === null) continue; // already unowned
    if (ran.has(timerKey(row.id, key, deadline))) continue;

    const hoursOver = Math.round(hoursBetween(deadline, at));
    const prepared = await prepareEvent(db, {
      caseId: row.id,
      type: UNOWNED.unanswered_event,
      actor: SYSTEM_ACTOR,
      occurredAt: at,
      payload: {
        due_at: deadline,
        hours_over: hoursOver,
        reason: `No answer to the referral by the acceptance deadline (${hoursOver}h over)`,
        summary: `Referral unanswered ${hoursOver}h past the acceptance deadline: case unowned`,
      },
    });
    statements.push(
      ...prepared.statements,
      db
        .prepare(
          `INSERT INTO timers (id, case_id, stage, due_at, level, role, status, fired_at)
           VALUES (?, ?, ?, ?, 1, ?, 'fired', ?)`,
        )
        .bind(`t_${randomUUID().slice(0, 8)}`, row.id, key, deadline, UNOWNED.assign_owner_role, at),
    );
    cases.push(row.id);
  }
  return { statements, cases };
}

// ---------------------------------------------------------------------------
// TICKET-11: an unanswered consultation escalates through the same timer mechanism
// ---------------------------------------------------------------------------

type OpenConsultationRow = {
  id: string;
  case_id: string;
  due_at: string;
  to_actor_id: string | null;
  requested_by_actor_id: string;
};

async function overdueConsultations(
  db: Db,
  at: string,
  lastFired: Map<string, LastFired>,
  byRole: Map<string, string>,
  includeCohort: boolean,
): Promise<{
  statements: InStatement[];
  fired: { case_id: string; level: number; role: Role; consultation_id: string }[];
}> {
  const statements: InStatement[] = [];
  const fired: { case_id: string; level: number; role: Role; consultation_id: string }[] = [];
  if (!CONSULTATION) return { statements, fired };

  const rows = await db
    .prepare(
      `SELECT id, case_id, due_at, to_actor_id, requested_by_actor_id
         FROM consultations WHERE status = 'open' AND ${cohortFilterSql("case_id", includeCohort)}`,
    )
    .all<OpenConsultationRow>();

  for (const row of rows) {
    if (hoursBetween(row.due_at, at) < 0) continue;
    const key = consultationTimerStage(row.id);
    const last = lastFired.get(timerKey(row.case_id, key, row.due_at)) ?? null;
    const ladder = CONSULTATION.escalation;
    if (last && last.level >= ladder.length) continue;
    if (last && hoursBetween(last.fired_at, at) < ESCALATION_SPACING_HOURS) continue;
    const level = (last?.level ?? 0) + 1;
    const role = ladder[level - 1];
    if (!role) continue;

    // Level 1 goes back to the physician who owes the answer; higher levels to the role.
    const owner =
      level === 1 && row.to_actor_id !== null && role === "responsible_physician"
        ? row.to_actor_id
        : (byRole.get(role) ?? null);
    const overHours = Math.round(hoursBetween(row.due_at, at));

    statements.push(
      db
        .prepare(
          `INSERT INTO timers (id, case_id, stage, due_at, level, role, status, fired_at)
           VALUES (?, ?, ?, ?, ?, ?, 'fired', ?)`,
        )
        .bind(`t_${randomUUID().slice(0, 8)}`, row.case_id, key, row.due_at, level, role, at),
      db
        .prepare(
          `INSERT INTO events
             (id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload)
           VALUES (?, ?, 'consultation_overdue', 'act_system', 'system', ?, ?, ?)`,
        )
        .bind(
          `e_${randomUUID().slice(0, 8)}`,
          row.case_id,
          at,
          new Date().toISOString(),
          JSON.stringify({
            consultation_id: row.id,
            level,
            escalated_to: role,
            due_at: row.due_at,
            hours_over: overHours,
            summary: `Consultation unanswered ${overHours}h past its deadline: escalated to ${role.replace(/_/g, " ")}`,
          }),
        ),
      db
        .prepare(
          `INSERT INTO tasks (id, case_id, kind, owner_actor_id, due_at, status)
           VALUES (?, ?, 'escalation', ?, ?, 'open')`,
        )
        .bind(`t_${randomUUID().slice(0, 8)}`, row.case_id, owner, addHours(at, ESCALATION_SPACING_HOURS)),
    );
    fired.push({ case_id: row.case_id, level, role, consultation_id: row.id });
  }
  return { statements, fired };
}
