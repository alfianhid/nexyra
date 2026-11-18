import type { InStatement } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { addHours, advanceDays, getClock, hoursBetween, setClock, type Clock } from "./clock.js";
import { type Db } from "./db.js";
import { PATHWAY, stageDefinition, type Role } from "./engine.js";
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
};

export type TickResult = {
  escalations: number;
  escalations_per_case: { case_id: string; level: EscalationLevel; role: Role }[];
  per_role: { role: Role; count: number }[];
  // TICKET-10
  outreach?: OutreachTickResult;
};

function stageDeadline(row: OpenCaseRow): string | null {
  const definition = stageDefinition(row.stage);
  if (!definition || definition.sla_hours === null) return null;
  return addHours(row.stage_entered_at ?? row.created_at, definition.sla_hours);
}

async function actorOfRole(db: Db, role: Role): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM actors WHERE role = ? ORDER BY id LIMIT 1")
    .get<{ id: string }>(role);
  return row?.id ?? null;
}

async function lastFired(
  db: Db,
  caseId: string,
  stage: string,
  dueAt: string,
): Promise<{ level: number; fired_at: string } | null> {
  const row = await db
    .prepare(
      `SELECT level, fired_at FROM timers
        WHERE case_id = ? AND stage = ? AND due_at = ? AND status = 'fired'
        ORDER BY level DESC LIMIT 1`,
    )
    .get<{ level: number; fired_at: string }>(caseId, stage, dueAt);
  return row ?? null;
}

async function openCases(db: Db): Promise<OpenCaseRow[]> {
  return db
    .prepare(
      `SELECT id, stage, status, stage_entered_at, created_at
         FROM cases
        WHERE status != 'closed'`,
    )
    .all<OpenCaseRow>();
}

// `tick(now)` processes every open case whose stage deadline has passed. It records a
// `deadline_missed` event, opens a task for the escalated role and writes the timer row.
// Every row from one tick goes out in a single batch, so a failure cannot leave an
// event without its timer.
export async function tick(db: Db, now?: string): Promise<TickResult> {
  const at = now ?? (await getClock(db)).now;
  const open = await openCases(db);

  const result: TickResult = { escalations: 0, escalations_per_case: [], per_role: [] };
  const counts = new Map<Role, number>();
  const owners = new Map<Role, string | null>();
  const statements: InStatement[] = [];

  for (const row of open) {
    const deadline = stageDeadline(row);
    if (deadline === null) continue;
    if (hoursBetween(deadline, at) < 0) continue; // not late yet

    const ladder = escalationLadder(row.stage);
    const last = await lastFired(db, row.id, row.stage, deadline);
    if (last && last.level >= ladder.length) continue; // the ladder is exhausted
    if (last && hoursBetween(last.fired_at, at) < ESCALATION_SPACING_HOURS) continue;
    const level: EscalationLevel = (last?.level ?? 0) + 1;

    const role = ladder[level - 1];
    if (!role) continue;
    if (!owners.has(role)) owners.set(role, await actorOfRole(db, role));
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

  await db.batch(statements);

  result.per_role = [...counts.entries()].map(([role, count]) => ({ role, count }));

  // ---- TICKET-10: the patient outreach ladder runs on the same clock ----------------
  // Its steps are not stage escalations, so they are reported apart and never counted in
  // `escalations` (the alert-fatigue figure TICKET-06 asks for).
  result.outreach = await tickOutreach(db, at);
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
    // TICKET-10
    ...(ticked.outreach ? { outreach: ticked.outreach } : {}),
  };
}
