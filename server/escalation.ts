import { randomUUID } from "node:crypto";
import { addHours, advanceDays, getClock, hoursBetween, setClock, type Clock } from "./clock";
import { type Db } from "./db";
import { stageDefinition, type Role } from "./engine";

// TICKET-06: a case that passes its stage deadline escalates on its own, without anyone
// pressing a button. The escalation lives in three tables that already exist: an event
// (the audit line), a task (the work the next role now has) and a timer row (the proof
// that this level fired, which is what makes tick idempotent).

export type EscalationLevel = 1 | 2 | 3;

// coordination staff -> responsible physician -> program manager. Level 1 is the first
// miss; 2 and 3 repeat the alert one rung up rather than inventing a new owner.
export const ESCALATION_ROLES: Record<EscalationLevel, Role> = {
  1: "responsible_physician",
  2: "program_manager",
  3: "program_manager",
};

// A level may fire at most once per case per stage, and only after the previous level
// has had a day to be seen. That spacing is what makes "advance 1 day" produce one new
// escalation, not three at once, and it is deliberately demo-clock hours.
export const ESCALATION_SPACING_HOURS = 24;

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
};

function stageDeadline(row: OpenCaseRow): string | null {
  const definition = stageDefinition(row.stage);
  if (!definition || definition.sla_hours === null) return null;
  return addHours(row.stage_entered_at ?? row.created_at, definition.sla_hours);
}

function actorOfRole(db: Db, role: Role): string | null {
  const row = db
    .prepare("SELECT id FROM actors WHERE role = ? ORDER BY id LIMIT 1")
    .get(role) as { id: string } | undefined;
  return row?.id ?? null;
}

function lastFired(
  db: Db,
  caseId: string,
  stage: string,
  dueAt: string,
): { level: number; fired_at: string } | null {
  const row = db
    .prepare(
      `SELECT level, fired_at FROM timers
        WHERE case_id = ? AND stage = ? AND due_at = ? AND status = 'fired'
        ORDER BY level DESC LIMIT 1`,
    )
    .get(caseId, stage, dueAt) as { level: number; fired_at: string } | undefined;
  return row ?? null;
}

// `tick(now)` processes every open case whose stage deadline has passed. It records a
// `deadline_missed` event, opens a task for the escalated role and writes the timer row,
// all in one transaction so a failure cannot leave an event without its timer.
export function tick(db: Db, now: string = getClock(db).now): TickResult {
  const open = db
    .prepare(
      `SELECT id, stage, status, stage_entered_at, created_at
         FROM cases
        WHERE status != 'closed' AND stage != 'closed'`,
    )
    .all() as OpenCaseRow[];

  const result: TickResult = { escalations: 0, escalations_per_case: [], per_role: [] };
  const counts = new Map<Role, number>();

  const run = db.transaction(() => {
    for (const row of open) {
      const deadline = stageDeadline(row);
      if (deadline === null) continue;
      if (hoursBetween(deadline, now) < 0) continue; // not late yet

      const last = lastFired(db, row.id, row.stage, deadline);
      const level = Math.min((last?.level ?? 0) + 1, 3) as EscalationLevel;
      if (last && last.level >= 3) continue; // the ladder is exhausted
      if (last && hoursBetween(last.fired_at, now) < ESCALATION_SPACING_HOURS) continue;

      const role = ESCALATION_ROLES[level];
      const timerId = `t_${randomUUID().slice(0, 8)}`;
      const overHours = Math.round(hoursBetween(deadline, now));

      // The unique (case_id, stage, level) index is the real guard: if two ticks race,
      // the second insert throws and the whole transaction rolls back.
      db.prepare(
        `INSERT INTO timers (id, case_id, stage, due_at, level, role, status, fired_at)
         VALUES (?, ?, ?, ?, ?, ?, 'fired', ?)`,
      ).run(timerId, row.id, row.stage, deadline, level, role, now);

      db.prepare(
        `INSERT INTO events
           (id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload)
         VALUES (?, ?, 'deadline_missed', 'act_system', 'system', ?, ?, ?)`,
      ).run(
        `e_${randomUUID().slice(0, 8)}`,
        row.id,
        now,
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
      );

      const owner = actorOfRole(db, role);
      db.prepare(
        `INSERT INTO tasks (id, case_id, kind, owner_actor_id, due_at, status)
         VALUES (?, ?, 'escalation', ?, ?, 'open')`,
      ).run(`t_${randomUUID().slice(0, 8)}`, row.id, owner, addHours(now, 24));

      result.escalations += 1;
      result.escalations_per_case.push({ case_id: row.id, level, role });
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
  });

  run();

  result.per_role = [...counts.entries()].map(([role, count]) => ({ role, count }));
  return result;
}

// Every stage deadline among open cases, for POST /api/clock/advance {until}.
export function openDeadlines(db: Db): string[] {
  const rows = db
    .prepare(
      `SELECT id, stage, status, stage_entered_at, created_at
         FROM cases
        WHERE status != 'closed' AND stage != 'closed'`,
    )
    .all() as OpenCaseRow[];

  return rows.map(stageDeadline).filter((iso): iso is string => iso !== null);
}

export type AdvanceResult = {
  clock: Clock;
  escalations: number;
  cases_advanced: number;
  escalations_per_role: { role: Role; count: number }[];
};

// Advance is: move the clock, then tick. The clock moves first so every event the tick
// writes carries the new time, and `recorded_at` keeps the real time beside it.
export function advanceClock(
  db: Db,
  input: { days?: number; until?: "next_deadline" },
): AdvanceResult {
  const current = getClock(db);

  let clock: Clock;
  if (input.until === "next_deadline") {
    const deadline = openDeadlines(db)
      .filter((iso) => Date.parse(iso) > Date.parse(current.now))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];

    if (!deadline) {
      clock = current;
    } else {
      const days = Math.max(1, Math.round(hoursBetween(current.now, deadline) / 24));
      clock = setClock(db, deadline, current.day + days);
    }
  } else {
    const days = Math.trunc(input.days ?? 1);
    clock = advanceDays(db, days);
  }

  const ticked = tick(db, clock.now);

  return {
    clock,
    escalations: ticked.escalations,
    cases_advanced: 0,
    escalations_per_role: ticked.per_role,
  };
}
