import type { InStatement } from "@libsql/client";
import { randomBytes, randomUUID } from "node:crypto";
import { addHours, formatDue, getClock, hoursBetween } from "../clock.js";
import type { Db } from "../db.js";
import { applyEvent, DELAY_REASONS, outreachEventStatement, type WriteActor } from "../events.js";
import { HttpError } from "../errors.js";
// TICKET-17
import { cohortFilterSql, type TickOptions } from "../cohort.js";
import {
  LADDER,
  clinicPlace,
  parameterHours,
  patientDate,
  patientPath,
  render,
  writtenTemplateFor,
} from "./templates.js";

// TICKET-10: the outreach ladder. Step 1 is an automated message with a link to the
// patient page; step 2 is a call task for coordination staff when the patient does not
// answer by the template deadline; step 3 is a navigator task when the case still does
// not move, or at once when staff record a barrier (a structured delay reason).
//
// Like tick() in server/escalation.ts, every step is written as one batch (event, task,
// step row), and the unique (case_id, run_id, step) key on outreach_steps makes running
// the ladder twice at the same instant a no-op. The ladder never moves a case by itself:
// the only stage change it causes is `patient_notified` after the patient confirms on the
// patient page, recorded by `system` on the patient's behalf.

export const SYSTEM_ACTOR: WriteActor = {
  actor_id: "act_system",
  role: "system",
  display_name: "system",
};

// The patient acts through the link only. The actor row exists (server/seed.ts) so the
// timeline can name it, but role `patient` is never accepted over the actor header.
export const PATIENT_ACTOR_ID = "act_patient";

// WriteActor (server/events.ts) has no patient variant because no HTTP caller may be one;
// the event statement only reads actor_id and role, so the stored role is `patient`.
const PATIENT_ACTOR = {
  actor_id: PATIENT_ACTOR_ID,
  role: "patient",
  display_name: "patient",
} as unknown as WriteActor;

export const OUTREACH_EVENTS = {
  message_sent: "outreach_message_sent",
  staff_call_due: "outreach_staff_call_due",
  navigator_assigned: "outreach_navigator_assigned",
  acknowledged: "patient_acknowledged",
  callback_requested: "callback_requested",
  stopped: "outreach_ladder_stopped",
} as const;

export const TASK_KINDS = {
  staff_call: "outreach_call",
  callback: "patient_callback",
  navigator: "outreach_navigator",
} as const;

export type Step = "message" | "staff_call" | "callback" | "navigator";

export type LadderCase = {
  id: string;
  patient_name: string;
  patient_language: string;
  stage: string;
  status: string;
  owner_actor_id: string | null;
  owner_role: string | null;
  stage_entered_at: string | null;
  created_at: string;
};

export type StepRow = {
  id: string;
  run_id: string;
  step: Step;
  fired_at: string;
  reason: string;
  task_id: string | null;
  event_id: string | null;
};

type FactEvent = {
  id: string;
  type: string;
  actor_role: string;
  occurred_at: string;
  payload: string;
};

export type RunFacts = {
  acknowledged: { event_id: string; at: string } | null;
  callback: { event_id: string; at: string } | null;
  barrier: { event_id: string; at: string; delay_reason: string } | null;
};

const CASE_COLUMNS = `c.id, c.patient_name, c.patient_language, c.stage, c.status, c.owner_actor_id,
                      c.stage_entered_at, c.created_at, a.role AS owner_role`;

export function runIdOf(c: Pick<LadderCase, "stage" | "stage_entered_at" | "created_at">): string {
  return `${c.stage}@${c.stage_entered_at ?? c.created_at}`;
}

export function isLadderActive(c: Pick<LadderCase, "stage" | "status">): boolean {
  return c.status !== "closed" && c.stage === LADDER.applies_to_stage;
}

function parse(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export async function loadLadderCase(db: Db, caseId: string): Promise<LadderCase> {
  const row = await db
    .prepare(
      `SELECT ${CASE_COLUMNS} FROM cases c LEFT JOIN actors a ON a.id = c.owner_actor_id
        WHERE c.id = ?`,
    )
    .get<LadderCase>(caseId);
  if (!row) throw new HttpError(404, "not_found", `No case carries the reference ${caseId}.`);
  return row;
}

export async function stepsFor(db: Db, caseId: string, runId?: string): Promise<StepRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, run_id, step, fired_at, reason, task_id, event_id FROM outreach_steps
        WHERE case_id = ? ORDER BY rowid`,
    )
    .all<StepRow>(caseId);
  return runId === undefined ? rows : rows.filter((row) => row.run_id === runId);
}

function stepOf(steps: readonly StepRow[], step: Step): StepRow | undefined {
  return steps.find((row) => row.step === step);
}

// What the patient and staff have done in this run, read from the timeline.
export async function runFacts(
  db: Db,
  caseId: string,
  runId: string,
  since: string | null,
): Promise<RunFacts> {
  const rows = await db
    .prepare(
      `SELECT id, type, actor_role, occurred_at, payload FROM events
        WHERE case_id = ? AND type IN (?, ?, 'outreach_attempted', 'task_completed')
        ORDER BY rowid`,
    )
    .all<FactEvent>(caseId, OUTREACH_EVENTS.acknowledged, OUTREACH_EVENTS.callback_requested);
  return factsFrom(rows, runId, since);
}

// TICKET-17: the same reading from rows already loaded, so tick can load every case's
// rows in one query.
function factsFrom(rows: readonly FactEvent[], runId: string, since: string | null): RunFacts {
  const facts: RunFacts = { acknowledged: null, callback: null, barrier: null };
  for (const row of rows) {
    const payload = parse(row.payload);
    if (row.type === OUTREACH_EVENTS.acknowledged && payload.run_id === runId) {
      facts.acknowledged ??= { event_id: row.id, at: row.occurred_at };
    } else if (row.type === OUTREACH_EVENTS.callback_requested && payload.run_id === runId) {
      facts.callback ??= { event_id: row.id, at: row.occurred_at };
    } else if (
      (row.type === "outreach_attempted" || row.type === "task_completed") &&
      row.actor_role === "coordination_staff" &&
      since !== null &&
      Date.parse(row.occurred_at) >= Date.parse(since) &&
      typeof payload.delay_reason === "string" &&
      (DELAY_REASONS as readonly string[]).includes(payload.delay_reason)
    ) {
      // A barrier is a structured delay reason recorded by coordination staff after the
      // message went out. Free text never counts: it is not a reason (docs/api.md).
      facts.barrier ??= { event_id: row.id, at: row.occurred_at, delay_reason: payload.delay_reason };
    }
  }
  return facts;
}

async function firstActorOfRole(db: Db, role: string): Promise<{ id: string; display_name: string } | null> {
  const row = await db
    .prepare("SELECT id, display_name FROM actors WHERE role = ? ORDER BY id LIMIT 1")
    .get<{ id: string; display_name: string }>(role);
  return row ?? null;
}

async function actorName(db: Db, id: string): Promise<string> {
  const row = await db.prepare("SELECT display_name FROM actors WHERE id = ?").get<{ display_name: string }>(id);
  return row?.display_name ?? id;
}

// The call goes to the coordinator who owns the case; an unowned case or one owned by
// another role goes to the first coordinator, so a call task never lands on nobody.
async function staffOwnerFor(db: Db, c: LadderCase): Promise<{ id: string; display_name: string }> {
  if (c.owner_actor_id !== null && c.owner_role === "coordination_staff") {
    return { id: c.owner_actor_id, display_name: await actorName(db, c.owner_actor_id) };
  }
  const fallback = await firstActorOfRole(db, "coordination_staff");
  if (!fallback) throw new HttpError(500, "validation_failed", "No coordination staff can take the call.");
  return fallback;
}

function stepStatement(
  db: Db,
  input: { caseId: string; runId: string; step: Step; at: string; reason: string; taskId?: string; eventId: string },
): InStatement {
  return db
    .prepare(
      `INSERT INTO outreach_steps (id, case_id, run_id, step, fired_at, reason, task_id, event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId("os"), input.caseId, input.runId, input.step, input.at, input.reason, input.taskId ?? null, input.eventId);
}

function taskStatement(db: Db, input: { id: string; caseId: string; kind: string; owner: string; dueAt: string }): InStatement {
  return db
    .prepare(
      `INSERT INTO tasks (id, case_id, kind, owner_actor_id, due_at, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
    )
    .bind(input.id, input.caseId, input.kind, input.owner, input.dueAt);
}

function randomToken(): string {
  // 10 characters from an alphabet without look-alikes; the token is opaque and grants
  // only the two patient actions.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function tokenFor(db: Db, caseId: string): Promise<string | null> {
  const row = await db.prepare("SELECT token FROM outreach_links WHERE case_id = ?").get<{ token: string }>(caseId);
  return row?.token ?? null;
}

// The message as it would be sent now: fixed template text, variables filled in. Also used
// by the seed, so the seeded demo message is exactly what the ladder would have sent.
export function composeMessage(
  c: Pick<LadderCase, "patient_name" | "patient_language">,
  token: string,
  sentAt: string,
) {
  const { template, requested, fallback } = writtenTemplateFor(c.patient_language);
  const replyBy = addHours(sentAt, parameterHours("staff_call_after_hours"));
  const link = patientPath(token);
  // An SMS is plain text: in a right-to-left message the Latin name, the link and the
  // phone number are wrapped in Unicode isolates (LRI ... PDI) so a phone shows
  // "+971 2 000 0000" rather than reordering it. The page does the same with <bdi>.
  const ltr = (value: string) => (template.dir === "rtl" ? `⁦${value}⁩` : value);
  const text = render(template.text.sms, {
    name: ltr(c.patient_name),
    date: patientDate(replyBy, template.date_locale),
    place: clinicPlace(template.language),
    phone: ltr(LADDER.clinic.phone),
    link: ltr(link),
  });
  return {
    channel: "sms",
    delivery: "simulated",
    template_id: template.template_id,
    language: template.language,
    requested_language: c.patient_language,
    language_fallback: fallback,
    requested_review_status: requested?.review_status ?? null,
    review_status: template.review_status,
    dir: template.dir,
    text,
    link,
    reply_by: replyBy,
    summary: fallback
      ? `Automated message sent in ${template.language_name} (simulated SMS); ` +
        `${requested?.language_name ?? c.patient_language} has no reviewed template`
      : `Automated message sent in ${template.language_name} (simulated SMS)`,
  };
}

type OpenTask = { id: string; kind: string };

async function openLadderTasks(db: Db, caseId: string): Promise<OpenTask[]> {
  return db
    .prepare(
      `SELECT t.id, t.kind FROM tasks t JOIN outreach_steps s ON s.task_id = t.id
        WHERE s.case_id = ? AND t.status = 'open'
        ORDER BY s.rowid`,
    )
    .all<OpenTask>(caseId);
}

// Stopping the ladder cancels the tasks it opened and says so in the timeline.
async function stopStatements(
  db: Db,
  c: LadderCase,
  reason: "patient_acknowledged" | "stage_moved" | "case_closed",
  at: string,
): Promise<InStatement[]> {
  return stopStatementsFor(db, c, await openLadderTasks(db, c.id), reason, at);
}

function stopStatementsFor(
  db: Db,
  c: LadderCase,
  open: readonly OpenTask[],
  reason: "patient_acknowledged" | "stage_moved" | "case_closed",
  at: string,
): InStatement[] {
  if (open.length === 0) return [];
  const { statement } = outreachEventStatement(
    db,
    {
      caseId: c.id,
      type: OUTREACH_EVENTS.stopped,
      actor: SYSTEM_ACTOR,
      payload: {
        reason,
        stage: c.stage,
        cancelled_task_ids: open.map((t) => t.id),
        summary:
          reason === "patient_acknowledged"
            ? "Outreach ladder stopped: the patient confirmed on the patient page"
            : reason === "case_closed"
              ? "Outreach ladder stopped: the case is closed"
              : `Outreach ladder stopped: the case moved on to ${c.stage.replace(/_/g, " ")}`,
      },
    },
    at,
  );
  return [
    statement,
    ...open.map((task) =>
      db.prepare("UPDATE tasks SET status = 'cancelled' WHERE id = ? AND status = 'open'").bind(task.id),
    ),
  ];
}

export type LadderFiring = { case_id: string; step: Step | "stopped"; reason: string };

// ---- TICKET-17: everything one evaluation reads, loaded for many cases at once --------
// Deployed, every query is a round trip to Turso. tick() used to evaluate each case with
// its own five or six queries; now it loads the rows of every candidate case in one query
// per table, decides each case in memory with the same rules, and writes one batch.

type Actors = {
  names: Map<string, string>;
  firstOfRole: Map<string, { id: string; display_name: string }>;
};

type LadderContext = {
  steps: Map<string, StepRow[]>;
  facts: Map<string, FactEvent[]>;
  openTasks: Map<string, OpenTask[]>;
  tokens: Map<string, string>;
  actors: Actors;
};

// `scope` is a subquery returning case ids, with its arguments.
type Scope = { sql: string; args: string[] };

function group<T extends { case_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.case_id) ?? [];
    list.push(row);
    map.set(row.case_id, list);
  }
  return map;
}

async function loadContext(db: Db, scope: Scope): Promise<LadderContext> {
  const steps = await db
    .prepare(
      `SELECT case_id, id, run_id, step, fired_at, reason, task_id, event_id FROM outreach_steps
        WHERE case_id IN (${scope.sql}) ORDER BY rowid`,
    )
    .all<StepRow & { case_id: string }>(...scope.args);
  const facts = await db
    .prepare(
      `SELECT case_id, id, type, actor_role, occurred_at, payload FROM events
        WHERE case_id IN (${scope.sql}) AND type IN (?, ?, 'outreach_attempted', 'task_completed')
        ORDER BY rowid`,
    )
    .all<FactEvent & { case_id: string }>(
      ...scope.args,
      OUTREACH_EVENTS.acknowledged,
      OUTREACH_EVENTS.callback_requested,
    );
  const openTasks = await db
    .prepare(
      `SELECT s.case_id, t.id, t.kind FROM tasks t JOIN outreach_steps s ON s.task_id = t.id
        WHERE s.case_id IN (${scope.sql}) AND t.status = 'open'
        ORDER BY s.rowid`,
    )
    .all<OpenTask & { case_id: string }>(...scope.args);
  const tokens = await db
    .prepare(`SELECT case_id, token FROM outreach_links WHERE case_id IN (${scope.sql})`)
    .all<{ case_id: string; token: string }>(...scope.args);
  const actorRows = await db
    .prepare("SELECT id, role, display_name FROM actors ORDER BY id")
    .all<{ id: string; role: string; display_name: string }>();

  const actors: Actors = { names: new Map(), firstOfRole: new Map() };
  for (const a of actorRows) {
    actors.names.set(a.id, a.display_name);
    if (!actors.firstOfRole.has(a.role)) actors.firstOfRole.set(a.role, { id: a.id, display_name: a.display_name });
  }
  return {
    steps: group(steps),
    facts: group(facts),
    openTasks: group(openTasks),
    tokens: new Map(tokens.map((t) => [t.case_id, t.token])),
    actors,
  };
}

// The call goes to the coordinator who owns the case; an unowned case or one owned by
// another role goes to the first coordinator, so a call task never lands on nobody.
function staffOwnerIn(actors: Actors, c: LadderCase): { id: string; display_name: string } {
  if (c.owner_actor_id !== null && c.owner_role === "coordination_staff") {
    return { id: c.owner_actor_id, display_name: actors.names.get(c.owner_actor_id) ?? c.owner_actor_id };
  }
  const fallback = actors.firstOfRole.get("coordination_staff");
  if (!fallback) throw new HttpError(500, "validation_failed", "No coordination staff can take the call.");
  return fallback;
}

type Decision = { statements: InStatement[]; firings: LadderFiring[] };
const NOTHING: Decision = { statements: [], firings: [] };

// One case, one instant: which step is due, as statements to write. At most one step fires
// per evaluation, so a case that is days behind climbs one rung per tick, as escalation does.
function decide(db: Db, ctx: LadderContext, c: LadderCase, now: string, options: { stopOnly?: boolean }): Decision {
  if (!isLadderActive(c)) {
    const reason = c.status === "closed" ? "case_closed" : "stage_moved";
    const statements = stopStatementsFor(db, c, ctx.openTasks.get(c.id) ?? [], reason, now);
    return statements.length === 0 ? NOTHING : { statements, firings: [{ case_id: c.id, step: "stopped", reason }] };
  }
  if (options.stopOnly) return NOTHING;

  const runId = runIdOf(c);
  const steps = (ctx.steps.get(c.id) ?? []).filter((row) => row.run_id === runId);
  const message = stepOf(steps, "message");
  const facts = factsFrom(ctx.facts.get(c.id) ?? [], runId, message?.fired_at ?? null);

  if (facts.acknowledged) {
    const statements = stopStatementsFor(db, c, ctx.openTasks.get(c.id) ?? [], "patient_acknowledged", now);
    return statements.length === 0
      ? NOTHING
      : { statements, firings: [{ case_id: c.id, step: "stopped", reason: "patient_acknowledged" }] };
  }

  // Step 1: the automated message, once per run.
  if (!message) {
    const token = ctx.tokens.get(c.id) ?? randomToken();
    const composed = composeMessage(c, token, now);
    const { id: eventId, statement } = outreachEventStatement(
      db,
      {
        caseId: c.id,
        type: OUTREACH_EVENTS.message_sent,
        actor: SYSTEM_ACTOR,
        payload: { run_id: runId, step: "message", ...composed },
      },
      now,
    );
    return {
      statements: [
        db
          .prepare("INSERT OR IGNORE INTO outreach_links (token, case_id, created_at) VALUES (?, ?, ?)")
          .bind(token, c.id, now),
        stepStatement(db, { caseId: c.id, runId, step: "message", at: now, reason: "case_at_stage", eventId }),
        statement,
      ],
      firings: [{ case_id: c.id, step: "message", reason: "case_at_stage" }],
    };
  }

  const staffCall = stepOf(steps, "staff_call");
  const callback = stepOf(steps, "callback");
  const navigator = stepOf(steps, "navigator");

  // Step 3: the navigator. At once on a barrier; otherwise when the first call step has
  // had navigator_after_hours without the case moving.
  if (!navigator) {
    const firstCall = [staffCall, callback]
      .filter((row): row is StepRow => row !== undefined)
      .sort((a, b) => Date.parse(a.fired_at) - Date.parse(b.fired_at))[0];
    const barrier = LADDER.escalate_to_navigator_on_barrier ? facts.barrier : null;
    const waited =
      firstCall !== undefined &&
      hoursBetween(firstCall.fired_at, now) >= parameterHours("navigator_after_hours");

    if (barrier || waited) {
      const owner = ctx.actors.firstOfRole.get("navigator");
      if (!owner) throw new HttpError(500, "validation_failed", "No navigator can take the case.");
      const reason = barrier ? "barrier" : "no_movement";
      const taskId = newId("t");
      const dueAt = addHours(now, parameterHours("navigator_due_hours"));
      const { id: eventId, statement } = outreachEventStatement(
        db,
        {
          caseId: c.id,
          type: OUTREACH_EVENTS.navigator_assigned,
          actor: SYSTEM_ACTOR,
          payload: {
            run_id: runId,
            step: "navigator",
            reason,
            ...(barrier ? { delay_reason: barrier.delay_reason, barrier_event_id: barrier.event_id } : {}),
            task_id: taskId,
            task_owner_actor_id: owner.id,
            due_at: dueAt,
            summary: barrier
              ? `Escalated to navigator ${owner.display_name}: staff recorded a barrier (${barrier.delay_reason})`
              : `Escalated to navigator ${owner.display_name}: no movement ` +
                `${parameterHours("navigator_after_hours")}h after the staff call step`,
          },
        },
        now,
      );
      return {
        statements: [
          stepStatement(db, { caseId: c.id, runId, step: "navigator", at: now, reason, taskId, eventId }),
          taskStatement(db, { id: taskId, caseId: c.id, kind: TASK_KINDS.navigator, owner: owner.id, dueAt }),
          statement,
        ],
        firings: [{ case_id: c.id, step: "navigator", reason }],
      };
    }
  }

  // Step 2: the staff call, when the message has gone unanswered past its deadline and
  // no call is already arranged (the patient's own request counts as one).
  if (
    !staffCall &&
    !callback &&
    !navigator &&
    hoursBetween(message.fired_at, now) >= parameterHours("staff_call_after_hours")
  ) {
    const owner = staffOwnerIn(ctx.actors, c);
    const taskId = newId("t");
    const dueAt = addHours(now, parameterHours("staff_call_due_hours"));
    const { id: eventId, statement } = outreachEventStatement(
      db,
      {
        caseId: c.id,
        type: OUTREACH_EVENTS.staff_call_due,
        actor: SYSTEM_ACTOR,
        payload: {
          run_id: runId,
          step: "staff_call",
          reason: "no_response",
          task_id: taskId,
          task_owner_actor_id: owner.id,
          due_at: dueAt,
          hours_since_message: Math.round(hoursBetween(message.fired_at, now)),
          summary:
            `No answer to the automated message after ${parameterHours("staff_call_after_hours")}h: ` +
            `call task for ${owner.display_name}, due ${formatDue(dueAt)}`,
        },
      },
      now,
    );
    return {
      statements: [
        stepStatement(db, { caseId: c.id, runId, step: "staff_call", at: now, reason: "no_response", taskId, eventId }),
        taskStatement(db, { id: taskId, caseId: c.id, kind: TASK_KINDS.staff_call, owner: owner.id, dueAt }),
        statement,
      ],
      firings: [{ case_id: c.id, step: "staff_call", reason: "no_response" }],
    };
  }

  return NOTHING;
}
// ---- end TICKET-17 -------------------------------------------------------------------

// One case: decide and write. `stopOnly` is for writes that move a case: they may stop the
// ladder, never climb it.
export async function evaluateCase(
  db: Db,
  caseId: string,
  now: string,
  options: { stopOnly?: boolean } = {},
): Promise<LadderFiring[]> {
  const c = await loadLadderCase(db, caseId);
  let decision: Decision;
  if (!isLadderActive(c) || options.stopOnly) {
    // Stopping needs only the open tasks, so the write path stays at two reads.
    const openTasks = isLadderActive(c) ? [] : await openLadderTasks(db, c.id);
    decision = decide(
      db,
      { steps: new Map(), facts: new Map(), openTasks: new Map([[c.id, openTasks]]), tokens: new Map(), actors: { names: new Map(), firstOfRole: new Map() } },
      c,
      now,
      options,
    );
  } else {
    decision = decide(db, await loadContext(db, { sql: "SELECT ?", args: [c.id] }), c, now, options);
  }
  if (decision.statements.length > 0) await db.batch(decision.statements);
  return decision.firings;
}

export type OutreachTickResult = {
  messages_sent: number;
  staff_calls: number;
  navigator_escalations: number;
  stopped: number;
  per_case: LadderFiring[];
};

// Every case the ladder may act on: open cases at its stage, and any case that still has
// an open ladder task (so the ladder can stop once the case has moved on). The synthetic
// cohort is history and never climbs the ladder (server/cohort.ts).
const candidates = (includeCohort: boolean) => `SELECT id FROM cases
  WHERE ((status != 'closed' AND stage = ?)
     OR id IN (SELECT s.case_id FROM outreach_steps s JOIN tasks t ON t.id = s.task_id
                WHERE t.status = 'open'))
    AND ${cohortFilterSql("id", includeCohort)}`;

export async function tickOutreach(db: Db, now: string, options: TickOptions = {}): Promise<OutreachTickResult> {
  const scope: Scope = { sql: candidates(options.includeCohort === true), args: [LADDER.applies_to_stage] };
  const cases = await db
    .prepare(
      `SELECT ${CASE_COLUMNS} FROM cases c LEFT JOIN actors a ON a.id = c.owner_actor_id
        WHERE c.id IN (${scope.sql}) ORDER BY c.id`,
    )
    .all<LadderCase>(...scope.args);

  const result: OutreachTickResult = {
    messages_sent: 0,
    staff_calls: 0,
    navigator_escalations: 0,
    stopped: 0,
    per_case: [],
  };
  if (cases.length === 0) return result;

  const ctx = await loadContext(db, scope);
  const decisions = cases.map((c) => decide(db, ctx, c, now, {}));
  const statements = decisions.flatMap((d) => d.statements);
  let fired: LadderFiring[] = decisions.flatMap((d) => d.firings);

  try {
    await db.batch(statements);
  } catch (error) {
    // The unique step key refusing an insert means another tick got there first. The batch
    // rolled back as a whole, so fall back to one case at a time from what is stored now,
    // skipping the cases the other tick already handled, as before.
    if (!(error instanceof Error && /UNIQUE/i.test(error.message))) throw error;
    fired = [];
    for (const c of cases) {
      try {
        fired.push(...(await evaluateCase(db, c.id, now)));
      } catch (inner) {
        if (inner instanceof Error && /UNIQUE/i.test(inner.message)) continue;
        throw inner;
      }
    }
  }

  for (const firing of fired) {
    result.per_case.push(firing);
    if (firing.step === "message") result.messages_sent += 1;
    if (firing.step === "staff_call") result.staff_calls += 1;
    if (firing.step === "navigator") result.navigator_escalations += 1;
    if (firing.step === "stopped") result.stopped += 1;
  }
  return result;
}

// After staff or a navigator log a call: their own open ladder task is done, and a barrier
// they recorded escalates at once instead of waiting for the next tick.
export async function afterOutreachLogged(
  db: Db,
  input: { caseId: string; actor: WriteActor; eventId: string; completeOwnTasks?: boolean },
): Promise<void> {
  const now = (await getClock(db)).now;
  const c = await loadLadderCase(db, input.caseId);

  // A task completed through POST /api/tasks/{id}/complete is already done; only a call
  // logged through the outreach endpoint closes the caller's ladder task here.
  if (input.completeOwnTasks !== false && isLadderActive(c)) {
    const kinds =
      input.actor.role === "coordination_staff"
        ? [TASK_KINDS.staff_call, TASK_KINDS.callback]
        : input.actor.role === "navigator"
          ? [TASK_KINDS.navigator]
          : [];
    const runSteps = await stepsFor(db, c.id, runIdOf(c));
    const taskIds = runSteps.map((s) => s.task_id).filter((id): id is string => id !== null);
    const open = (await openLadderTasks(db, c.id)).filter(
      (task) => taskIds.includes(task.id) && (kinds as readonly string[]).includes(task.kind),
    );
    if (open.length > 0) {
      const logged = await db
        .prepare("SELECT payload FROM events WHERE id = ?")
        .get<{ payload: string }>(input.eventId);
      const payload = parse(logged?.payload ?? "{}");
      const statements: InStatement[] = [];
      for (const task of open) {
        const { statement } = outreachEventStatement(
          db,
          {
            caseId: c.id,
            type: "task_completed",
            actor: input.actor,
            payload: {
              task_id: task.id,
              task_kind: task.kind,
              outcome: typeof payload.result === "string" ? payload.result : "call logged",
              outreach_event_id: input.eventId,
              ...(typeof payload.connected === "boolean" ? { connected: payload.connected } : {}),
              ...(typeof payload.delay_reason === "string" ? { delay_reason: payload.delay_reason } : {}),
              summary: `${task.kind}: done with the logged call`,
            },
          },
          now,
        );
        statements.push(
          statement,
          db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ? AND status = 'open'").bind(task.id),
        );
      }
      await db.batch(statements);
    }
  }

  await evaluateCase(db, input.caseId, now);
}

// ---------------------------------------------------------------------------
// The patient page: two responses, no login, the token is the only key
// ---------------------------------------------------------------------------

export type PatientResponse = "understood" | "request_call";

export function isPatientResponse(value: unknown): value is PatientResponse {
  return value === "understood" || value === "request_call";
}

export async function caseIdForToken(db: Db, token: string): Promise<string> {
  const row = await db
    .prepare("SELECT case_id FROM outreach_links WHERE token = ?")
    .get<{ case_id: string }>(token);
  // The same answer for a wrong token and a case that does not exist: the token reveals
  // nothing about which cases there are.
  if (!row) throw new HttpError(404, "not_found", "This link is not valid.");
  return row.case_id;
}

export async function respondAsPatient(
  db: Db,
  input: { token: string; response: unknown; language?: unknown },
): Promise<{ caseId: string; recorded: string | null }> {
  if (!isPatientResponse(input.response)) {
    throw new HttpError(400, "validation_failed", 'response must be "understood" or "request_call".');
  }
  const caseId = await caseIdForToken(db, input.token);
  const c = await loadLadderCase(db, caseId);
  const now = (await getClock(db)).now;
  // The answer belongs to the run whose message carried the link, so a second tap after
  // the case has moved on is still recognised as the same answer.
  const lastMessage = (await stepsFor(db, caseId)).filter((row) => row.step === "message").at(-1);
  const runId = lastMessage?.run_id ?? runIdOf(c);
  const facts = await runFacts(db, caseId, runId, null);
  const language = typeof input.language === "string" ? input.language : c.patient_language;
  const patientActor = PATIENT_ACTOR;

  if (input.response === "understood") {
    // A second tap is the same answer, not a second confirmation.
    if (facts.acknowledged) return { caseId, recorded: null };

    const { id, statement } = outreachEventStatement(
      db,
      {
        caseId,
        type: OUTREACH_EVENTS.acknowledged,
        actor: patientActor,
        payload: {
          run_id: runId,
          response: "understood",
          language,
          summary: "Patient confirmed on the patient page: understood the result and will come",
        },
      },
      now,
    );
    await db.batch([statement]);

    if (isLadderActive(c) && runIdOf(c) === runId) {
      await applyEvent(db, {
        caseId,
        type: LADDER.acknowledge_event,
        actor: SYSTEM_ACTOR,
        payload: {
          channel: "patient_page",
          acknowledged_event_id: id,
          summary: "Patient notified: confirmed understanding on the patient page",
        },
      });
    }
    const stopped = await stopStatements(db, await loadLadderCase(db, caseId), "patient_acknowledged", now);
    if (stopped.length > 0) await db.batch(stopped);
    return { caseId, recorded: id };
  }

  // request_call: one callback task per run, owned by coordination staff, with a deadline.
  if (facts.callback) return { caseId, recorded: null };

  const owner = await staffOwnerFor(db, c);
  const taskId = newId("t");
  const dueAt = addHours(now, parameterHours("callback_due_hours"));
  const { id, statement } = outreachEventStatement(
    db,
    {
      caseId,
      type: OUTREACH_EVENTS.callback_requested,
      actor: patientActor,
      payload: {
        run_id: runId,
        response: "request_call",
        language,
        task_id: taskId,
        task_owner_actor_id: owner.id,
        due_at: dueAt,
        summary: `Patient asked for a phone call on the patient page: task for ${owner.display_name}, due ${formatDue(dueAt)}`,
      },
    },
    now,
  );
  await db.batch([
    stepStatement(db, { caseId, runId, step: "callback", at: now, reason: "patient_request", taskId, eventId: id }),
    taskStatement(db, { id: taskId, caseId, kind: TASK_KINDS.callback, owner: owner.id, dueAt }),
    statement,
  ]);
  return { caseId, recorded: id };
}
