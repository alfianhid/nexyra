import type { InStatement } from "@libsql/client";
import { randomUUID } from "node:crypto";
import type { Actor } from "./actor.js";
import { getClock } from "./clock.js";
import type { Db } from "./db.js";
import {
  CLOSURE_CONFIRMATION_EVENT,
  INITIAL_STAGE,
  OUTCOMES,
  PATHWAY,
  REOPEN_EVENT,
  ReplayError,
  availableActions,
  confirmClosure,
  eventDefinition,
  foldEvents,
  isValidOutcome,
  nextState,
  rolesForEvent,
  stageDefinition,
  transitionFor,
  type CaseState,
  type EngineCase,
  type RecordedEvent,
  type Role,
} from "./engine.js";
import { HttpError } from "./errors.js";

// Every write in the prototype ends up in this file. Nothing outside it updates a case
// row, and nothing at all updates an event row: the events table is append-only.

export type WriteActor = Actor | { actor_id: string; role: "system"; display_name: string };

type CaseStateRow = {
  id: string;
  stage: string;
  status: string;
  owner_actor_id: string | null;
  final_outcome: string | null;
  stage_entered_at: string | null;
  created_at: string;
};

async function loadCase(db: Db, caseId: string): Promise<CaseStateRow> {
  const row = await db
    .prepare(
      `SELECT id, stage, status, owner_actor_id, final_outcome, stage_entered_at, created_at
         FROM cases WHERE id = ?`,
    )
    .get<CaseStateRow>(caseId);
  if (!row) throw new HttpError(404, "not_found", `No case carries the reference ${caseId}.`);
  return row;
}

export async function loadEngineCase(db: Db, caseId: string): Promise<EngineCase> {
  const row = await loadCase(db, caseId);
  const documents = await db
    .prepare("SELECT kind FROM documents WHERE case_id = ?")
    .all<{ kind: string }>(caseId);
  const confirmed = await db
    .prepare(
      `SELECT count(*) AS n FROM events
        WHERE case_id = ? AND type = ? AND actor_role = 'responsible_physician'`,
    )
    .get<{ n: number }>(caseId, CLOSURE_CONFIRMATION_EVENT);

  return {
    stage: row.stage,
    status: row.status,
    owner_actor_id: row.owner_actor_id,
    final_outcome: row.final_outcome,
    documents: documents.map((doc) => ({ kind: doc.kind })),
    physician_confirmed: (confirmed?.n ?? 0) > 0,
  };
}

type EventInput = {
  caseId: string;
  type: string;
  actor: WriteActor;
  payload?: Record<string, unknown>;
  summary?: string;
};

// The only INSERT into `events`, built as a statement so it can share an atomic batch
// with the case update it explains. `occurred_at` is demo-clock time, `recorded_at` is
// real time (docs/api.md); they differ once the demo clock moves.
function eventStatement(
  db: Db,
  input: EventInput,
  occurredAt: string,
): { id: string; statement: InStatement } {
  const id = `e_${randomUUID().slice(0, 8)}`;
  const payload = { ...(input.payload ?? {}) };
  if (input.summary && payload.summary === undefined) payload.summary = input.summary;

  const statement = db
    .prepare(
      `INSERT INTO events (id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.caseId,
      input.type,
      input.actor.actor_id,
      input.actor.role,
      occurredAt,
      new Date().toISOString(),
      JSON.stringify(payload),
    );

  return { id, statement };
}

export async function appendEvent(db: Db, input: EventInput): Promise<string> {
  const { id, statement } = eventStatement(db, input, (await getClock(db)).now);
  await db.batch([statement]);
  return id;
}

async function assertOwnerExists(db: Db, ownerId: string): Promise<void> {
  const row = await db.prepare("SELECT id FROM actors WHERE id = ?").get(ownerId);
  if (!row) throw new HttpError(400, "validation_failed", `No actor carries the id "${ownerId}".`);
}

function caseStateOf(row: CaseStateRow): CaseState {
  return {
    stage: row.stage,
    status: row.status === "closed" ? "closed" : "open",
    owner_actor_id: row.owner_actor_id,
    final_outcome: row.final_outcome,
    stage_entered_at: row.stage_entered_at,
  };
}

function replayHttpError(error: ReplayError): HttpError {
  const status = error.code === "role_not_permitted" ? 403 : error.code === "invalid_transition" ? 409 : 400;
  return new HttpError(status, error.code, error.message);
}

// `applyEvent` from TICKET-05: validate against the pathway template, record the event,
// then move the case. The case columns are a cache of the timeline: the next row is
// computed by the same `nextState` step that `rebuildCase` replays, from the event as
// it will be stored, so a write and a rebuild cannot disagree. The event and the case
// update commit together in one batch.
export async function applyEvent(
  db: Db,
  input: {
    caseId: string;
    type: string;
    actor: WriteActor;
    payload?: Record<string, unknown>;
    // Owner to assign when the event assigns one (reopen, an incomplete procedure on an
    // unowned case, owner_assigned). Defaults to payload.owner_actor_id, then the actor.
    ownerActorId?: string;
    // The outcome a closure screen chose but which is not on the case row yet.
    judgedOutcome?: unknown;
    // Set only by the closure endpoint: the physician's confirmation is the act that
    // finalises the case, so it enters the terminal stage in one event.
    finalise?: boolean;
  },
): Promise<{ recorded: string; caseId: string }> {
  const actor = input.actor;
  // `finalises` is the engine's own marker; a client cannot set it through the events
  // endpoint and skip the explicit closure step.
  const { finalises: _ignored, ...clientPayload } = input.payload ?? {};
  void _ignored;
  const caseRow = await loadCase(db, input.caseId);
  const engineCase = await loadEngineCase(db, input.caseId);

  // Closure is checked before the transition table: the three conditions are a stricter
  // test than "is this the next stage", and the 409 must carry the details.
  if (input.type === CLOSURE_CONFIRMATION_EVENT) {
    const judged: EngineCase =
      isValidOutcome(input.judgedOutcome)
        ? { ...engineCase, final_outcome: input.judgedOutcome }
        : engineCase;
    const decision = confirmClosure(judged, actor.role);
    if (!decision.allowed) {
      throw new HttpError(
        decision.code === "role_not_permitted" ? 403 : 409,
        decision.code,
        decision.message,
        decision.details,
      );
    }
  }

  const allowedRoles = rolesForEvent(input.type);
  if (allowedRoles === null) {
    throw new HttpError(400, "validation_failed", `"${input.type}" is not a case event.`);
  }
  if (!allowedRoles.includes(actor.role)) {
    throw new HttpError(
      403,
      "role_not_permitted",
      `The ${actor.role} role may not record a "${input.type}" event.`,
    );
  }

  const transition = transitionFor(caseRow.stage, input.type, actor.role);
  if (!transition.ok) {
    throw new HttpError(
      transition.code === "role_not_permitted" ? 403 : 409,
      transition.code,
      transition.message,
    );
  }

  // Who owns the case after this event, written into the payload so the timeline alone
  // can say it (rebuildCase reads it back).
  const definition = eventDefinition(input.type);
  const payload: Record<string, unknown> = { ...clientPayload };
  const assigns =
    definition?.owner === "assign" ||
    (definition?.owner === "assign_if_unowned" && caseRow.owner_actor_id === null);
  if (assigns) {
    const fromPayload =
      typeof clientPayload.owner_actor_id === "string" ? clientPayload.owner_actor_id : undefined;
    const requested =
      input.ownerActorId ?? fromPayload ?? (actor.role === "system" ? null : actor.actor_id);
    if (requested === null) {
      throw new HttpError(
        400,
        "validation_failed",
        `"${input.type}" requires an owner_actor_id when the engine acts.`,
      );
    }
    await assertOwnerExists(db, requested);
    payload.owner_actor_id = requested;
    if (caseRow.owner_actor_id !== null && caseRow.owner_actor_id !== requested) {
      payload.previous_owner_actor_id = caseRow.owner_actor_id;
    }
  } else {
    delete payload.owner_actor_id;
  }
  if (input.finalise === true) payload.finalises = true;

  const now = (await getClock(db)).now;
  const recordedEvent: RecordedEvent = {
    type: input.type,
    actor_id: actor.actor_id,
    actor_role: actor.role,
    occurred_at: now,
    payload,
  };

  let next: CaseState | null;
  try {
    next = nextState(caseStateOf(caseRow), recordedEvent);
  } catch (error) {
    if (error instanceof ReplayError) throw replayHttpError(error);
    throw error;
  }
  if (next === null) throw new HttpError(409, "invalid_transition", "The case has no state.");

  const { id, statement } = eventStatement(
    db,
    { caseId: input.caseId, type: input.type, actor, payload },
    now,
  );

  await db.batch([
    statement,
    db
      .prepare(
        `UPDATE cases
            SET stage = ?, status = ?, owner_actor_id = ?, final_outcome = ?,
                stage_entered_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        next.stage,
        next.status,
        next.owner_actor_id,
        next.final_outcome,
        next.stage_entered_at,
        new Date().toISOString(),
        input.caseId,
      ),
    // TICKET-06: a timer belongs to the stage that created it. Leaving the stage stops it,
    // so a case that moves before its deadline is never escalated for the stage it left.
    ...(next.stage !== caseRow.stage
      ? [
          db
            .prepare(
              `UPDATE timers SET status = 'cancelled'
                WHERE case_id = ? AND stage = ? AND status = 'fired'`,
            )
            .bind(input.caseId, caseRow.stage),
        ]
      : []),
  ]);

  return { recorded: id, caseId: input.caseId };
}

// TICKET-05: a case is created from a positive FIT result with the initial owner the
// template names (the first actor holding the initial stage's owner_role) unless the
// caller names one. The row and its creation event commit together.
export async function createCase(
  db: Db,
  input: {
    caseId: string;
    patient: { name: string; age: number; language: string };
    actor: WriteActor;
    ownerActorId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<{ recorded: string; caseId: string }> {
  const existing = await db.prepare("SELECT id FROM cases WHERE id = ?").get(input.caseId);
  if (existing) throw new HttpError(409, "invalid_transition", `Case ${input.caseId} already exists.`);

  let owner = input.ownerActorId ?? null;
  if (owner === null) {
    const role = stageDefinition(INITIAL_STAGE)?.owner_role;
    const row = await db
      .prepare("SELECT id FROM actors WHERE role = ? ORDER BY id LIMIT 1")
      .get<{ id: string }>(role ?? "");
    owner = row?.id ?? null;
  }
  if (owner === null) {
    throw new HttpError(400, "validation_failed", "No actor can own the new case.");
  }
  await assertOwnerExists(db, owner);

  const now = (await getClock(db)).now;
  const payload = { ...(input.payload ?? {}), owner_actor_id: owner };
  let state: CaseState | null;
  try {
    state = nextState(null, {
      type: PATHWAY.trigger.event,
      actor_id: input.actor.actor_id,
      actor_role: input.actor.role,
      occurred_at: now,
      payload,
    });
  } catch (error) {
    if (error instanceof ReplayError) throw replayHttpError(error);
    throw error;
  }
  if (state === null) throw new HttpError(500, "validation_failed", "Case creation produced no state.");

  const { id, statement } = eventStatement(
    db,
    { caseId: input.caseId, type: PATHWAY.trigger.event, actor: input.actor, payload },
    now,
  );
  const createdAt = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO cases (
           id, patient_name, patient_age, patient_language, pathway_id,
           owner_actor_id, stage, status, final_outcome, stage_entered_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.caseId,
        input.patient.name,
        input.patient.age,
        input.patient.language,
        PATHWAY.id,
        state.owner_actor_id,
        state.stage,
        state.status,
        state.final_outcome,
        state.stage_entered_at,
        now,
        createdAt,
      ),
    statement,
  ]);
  return { recorded: id, caseId: input.caseId };
}

type StoredEventRow = {
  type: string;
  actor_id: string;
  actor_role: string;
  occurred_at: string;
  payload: string;
};

function parseStoredPayload(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// TICKET-03: the case row's status columns are a cache. This recomputes them from the
// events table alone, in the order the engine recorded them (rowid), with the same step
// function every write uses, and stores the result.
export async function computeCaseState(db: Db, caseId: string): Promise<CaseState> {
  const rows = await db
    .prepare(
      `SELECT type, actor_id, actor_role, occurred_at, payload
         FROM events WHERE case_id = ? ORDER BY rowid`,
    )
    .all<StoredEventRow>(caseId);

  let state: CaseState | null;
  try {
    state = foldEvents(
      rows.map((row) => ({
        type: row.type,
        actor_id: row.actor_id,
        actor_role: row.actor_role,
        occurred_at: row.occurred_at,
        payload: parseStoredPayload(row.payload),
      })),
    );
  } catch (error) {
    if (error instanceof ReplayError) {
      throw new Error(`Case ${caseId} cannot be rebuilt from its events: ${error.message}`);
    }
    throw error;
  }
  if (state === null) {
    throw new Error(`Case ${caseId} cannot be rebuilt: it has no case creation event.`);
  }
  return state;
}

export async function rebuildCase(db: Db, caseId: string): Promise<CaseState> {
  await loadCase(db, caseId);
  const state = await computeCaseState(db, caseId);
  await db
    .prepare(
      `UPDATE cases
          SET stage = ?, status = ?, owner_actor_id = ?, final_outcome = ?, stage_entered_at = ?
        WHERE id = ?`,
    )
    .run(
      state.stage,
      state.status,
      state.owner_actor_id,
      state.final_outcome,
      state.stage_entered_at,
      caseId,
    );
  return state;
}

// Closure confirmation is its own write: it records the physician's act, then moves the
// case through the same transition table as every other event.
export async function confirmCaseClosure(
  db: Db,
  input: { caseId: string; actor: WriteActor; finalOutcome?: unknown },
) {
  if (CLOSURE_CONFIRMATION_EVENT === null) {
    throw new HttpError(409, "invalid_transition", "This pathway has no closure confirmation.");
  }
  const engineCase = await loadEngineCase(db, input.caseId);

  // An outcome chosen on the closure screen is recorded with the confirmation; without
  // one, the case's own proposed outcome is what the three conditions judge.
  const outcome = input.finalOutcome;
  if (outcome !== undefined && !isValidOutcome(outcome)) {
    throw new HttpError(
      400,
      "validation_failed",
      `final_outcome must be one of ${OUTCOMES.map((o) => o.key).join(", ")}.`,
    );
  }

  const judged: EngineCase =
    outcome !== undefined && isValidOutcome(outcome)
      ? { ...engineCase, final_outcome: outcome }
      : engineCase;

  const decision = confirmClosure(judged, input.actor.role);
  if (!decision.allowed) {
    throw new HttpError(
      decision.code === "role_not_permitted" ? 403 : 409,
      decision.code,
      decision.message,
      decision.details,
    );
  }

  return applyEvent(db, {
    caseId: input.caseId,
    type: CLOSURE_CONFIRMATION_EVENT,
    actor: input.actor,
    payload: outcome !== undefined ? { outcome } : {},
    judgedOutcome: outcome,
    finalise: true,
  });
}

export function reopenCase(
  db: Db,
  input: { caseId: string; actor: WriteActor; ownerActorId?: string },
) {
  if (REOPEN_EVENT === null) {
    throw new HttpError(409, "invalid_transition", "This pathway has no reopen event.");
  }
  return applyEvent(db, {
    caseId: input.caseId,
    type: REOPEN_EVENT,
    actor: input.actor,
    ownerActorId: input.ownerActorId,
    payload: { summary: "Case reopened after clinician review" },
  });
}

export const DELAY_REASONS = ["fear", "transport", "cost", "language", "other"] as const;

const CHANNELS = ["call", "sms", "letter"] as const;

// Logging an outreach attempt is an event, not a stage transition: contacting a patient
// does not move the case. docs/api.md had no endpoint for it, so this is the one place
// the client's `logOutreach` lands.
export async function logOutreach(
  db: Db,
  input: {
    caseId: string;
    actor: WriteActor;
    outcome: unknown;
    channel?: unknown;
    delayReason?: unknown;
    minutes?: unknown;
    note?: unknown;
    // TICKET-10: whether the call reached the patient, as a structured yes/no.
    connected?: unknown;
  },
): Promise<{ recorded: string; caseId: string }> {
  const engineCase = await loadEngineCase(db, input.caseId);

  if (input.connected !== undefined && typeof input.connected !== "boolean") {
    throw new HttpError(400, "validation_failed", "connected must be true or false.");
  }

  if (!availableActions(engineCase, input.actor.role as Role).includes("log_outreach")) {
    throw new HttpError(
      403,
      "role_not_permitted",
      `The ${input.actor.role} role may not record patient outreach.`,
    );
  }

  if (typeof input.outcome !== "string" || input.outcome.trim().length === 0) {
    throw new HttpError(400, "validation_failed", "An outreach outcome is required.");
  }

  const channel =
    input.channel === undefined
      ? "call"
      : typeof input.channel === "string" &&
          (CHANNELS as readonly string[]).includes(input.channel)
        ? input.channel
        : null;
  if (channel === null) {
    throw new HttpError(400, "validation_failed", `channel must be one of ${CHANNELS.join(", ")}.`);
  }

  if (input.delayReason !== undefined) {
    if (
      typeof input.delayReason !== "string" ||
      !(DELAY_REASONS as readonly string[]).includes(input.delayReason)
    ) {
      throw new HttpError(
        400,
        "validation_failed",
        `delay_reason must be one of ${DELAY_REASONS.join(", ")}.`,
      );
    }
  }

  const recorded = await appendEvent(db, {
    caseId: input.caseId,
    type: "outreach_attempted",
    actor: input.actor,
    payload: {
      channel,
      result: input.outcome,
      ...(typeof input.minutes === "number" ? { minutes: input.minutes } : {}),
      ...(input.delayReason !== undefined ? { delay_reason: input.delayReason } : {}),
      ...(typeof input.note === "string" ? { note: input.note } : {}),
      ...(typeof input.connected === "boolean" ? { connected: input.connected } : {}),
      summary:
        input.delayReason !== undefined
          ? `${channel}: ${input.outcome} (${input.delayReason})`
          : `${channel}: ${input.outcome}`,
    },
  });

  return { recorded, caseId: input.caseId };
}

export async function completeTask(
  db: Db,
  input: {
    taskId: string;
    actor: WriteActor;
    outcome: unknown;
    delayReason?: unknown;
    note?: unknown;
  },
) {
  const task = await db
    .prepare("SELECT id, case_id, kind, status FROM tasks WHERE id = ?")
    .get<{ id: string; case_id: string; kind: string; status: string }>(input.taskId);

  if (!task) throw new HttpError(404, "not_found", `No task carries the id "${input.taskId}".`);
  if (task.status !== "open") {
    throw new HttpError(409, "invalid_transition", "That task is already complete.");
  }

  if (typeof input.outcome !== "string" || input.outcome.trim().length === 0) {
    throw new HttpError(400, "validation_failed", "An outcome is required.");
  }

  if (input.delayReason !== undefined) {
    if (
      typeof input.delayReason !== "string" ||
      !(DELAY_REASONS as readonly string[]).includes(input.delayReason)
    ) {
      throw new HttpError(
        400,
        "validation_failed",
        `delay_reason must be one of ${DELAY_REASONS.join(", ")}.`,
      );
    }
  }

  // Which permission the task needs: an outreach task is coordination work, a closure
  // task is a clinician's. Both are asked of the engine, never hardcoded here.
  const permission =
    task.kind === "confirm_closure" ? "confirm_closure" : ("log_outreach" as const);
  const engineCase = await loadEngineCase(db, task.case_id);
  if (!availableActions(engineCase, input.actor.role as Role).includes(permission)) {
    throw new HttpError(
      403,
      "role_not_permitted",
      `The ${input.actor.role} role may not complete a ${task.kind} task.`,
    );
  }

  const { id, statement } = eventStatement(
    db,
    {
      caseId: task.case_id,
      type: "task_completed",
      actor: input.actor,
      payload: {
        task_id: task.id,
        task_kind: task.kind,
        outcome: input.outcome,
        ...(input.delayReason !== undefined ? { delay_reason: input.delayReason } : {}),
        ...(typeof input.note === "string" ? { note: input.note } : {}),
        summary:
          input.delayReason !== undefined
            ? `${task.kind}: ${input.outcome} (${input.delayReason})`
            : `${task.kind}: ${input.outcome}`,
      },
    },
    (await getClock(db)).now,
  );

  // The status guard in the UPDATE keeps a double submit from completing a task twice.
  await db.batch([
    statement,
    db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ? AND status = 'open'").bind(task.id),
  ]);

  return { recorded: id, caseId: task.case_id };
}

// ---- TICKET-10: outreach ladder writes ---------------------------------------------
// The ladder (server/outreach/ladder.ts) commits an event together with its task and its
// step row in one batch. It builds the event through this, so the INSERT into `events`
// still exists in one place only.
export function outreachEventStatement(
  db: Db,
  input: { caseId: string; type: string; actor: WriteActor; payload?: Record<string, unknown> },
  occurredAt: string,
): { id: string; statement: InStatement } {
  return eventStatement(db, input, occurredAt);
}
// ---- end TICKET-10 ------------------------------------------------------------------
