import type { InStatement } from "@libsql/client";
import { randomUUID } from "node:crypto";
import type { Actor } from "./actor.js";
import { addHours, getClock, hoursBetween } from "./clock.js";
import type { Db } from "./db.js";
import {
  ReplayError,
  availableActions,
  confirmClosure,
  consultationAnswerEvent,
  eventDefinition,
  foldEvents,
  isConsultationAnswer,
  isConsultationAnswerEvent,
  isValidOutcome,
  nextState,
  pathwayOf,
  rolesForEvent,
  rulesOf,
  stageDefinition,
  transitionFor,
  type CaseState,
  type EngineCase,
  type RecordedEvent,
  type Role,
} from "./engine.js";
import { HttpError } from "./errors.js";
import { roundHours } from "./ownership.js";
import { DEFAULT_PATHWAY, REFERRAL_STATUSES, UnknownPathwayError, type Pathway } from "./pathways/index.js";

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
  provider_id: string | null;
  // TICKET-18: which template every rule for this case runs.
  pathway_id: string;
};

async function loadCase(db: Db, caseId: string): Promise<CaseStateRow> {
  const row = await db
    .prepare(
      `SELECT id, stage, status, owner_actor_id, final_outcome, stage_entered_at, created_at,
              provider_id, pathway_id
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
    .get<{ n: number }>(caseId, rulesOf(row.pathway_id).closureConfirmationEvent);

  return {
    stage: row.stage,
    status: row.status,
    owner_actor_id: row.owner_actor_id,
    final_outcome: row.final_outcome,
    documents: documents.map((doc) => ({ kind: doc.kind })),
    physician_confirmed: (confirmed?.n ?? 0) > 0,
    open_consultation: await hasOpenConsultation(db, caseId),
    pathway_id: row.pathway_id,
  };
}

// TICKET-11: whether a consultation on the case is waiting for its answer.
export async function hasOpenConsultation(db: Db, caseId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT count(*) AS n FROM consultations WHERE case_id = ? AND status = 'open'")
    .get<{ n: number }>(caseId);
  return (row?.n ?? 0) > 0;
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
    provider_id: row.provider_id,
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
export type ApplyEventInput = {
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
  // TICKET-08/11: demo-clock time to record (tick passes its own `now`), whether this
  // call is the consultation answer endpoint (the only way to record an answer event),
  // and rows that must commit in the same batch as the event.
  occurredAt?: string;
  consultationAnswer?: boolean;
  extraStatements?: InStatement[];
};

export async function applyEvent(
  db: Db,
  input: ApplyEventInput,
): Promise<{ recorded: string; caseId: string }> {
  const prepared = await prepareEvent(db, input);
  await db.batch(prepared.statements);
  return { recorded: prepared.recorded, caseId: prepared.caseId };
}

// Everything applyEvent does except the write: validation, the next case row, and the
// statements that record it. Callers that must add rows to the same atomic write (the
// tick, the consultation answer) batch the result themselves.
export async function prepareEvent(
  db: Db,
  input: ApplyEventInput,
): Promise<{ recorded: string; caseId: string; statements: InStatement[]; next: CaseState }> {
  const actor = input.actor;
  // `finalises` is the engine's own marker; a client cannot set it through the events
  // endpoint and skip the explicit closure step.
  const { finalises: _ignored, ...clientPayload } = input.payload ?? {};
  void _ignored;
  const caseRow = await loadCase(db, input.caseId);
  const engineCase = await loadEngineCase(db, input.caseId);
  // TICKET-18: every rule below runs the case's own template.
  const pathway = pathwayOf(caseRow.pathway_id);

  // Closure is checked before the transition table: the three conditions are a stricter
  // test than "is this the next stage", and the 409 must carry the details.
  if (input.type === rulesOf(pathway).closureConfirmationEvent) {
    const judged: EngineCase =
      isValidOutcome(input.judgedOutcome, pathway)
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

  const allowedRoles = rolesForEvent(input.type, pathway);
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

  const transition = transitionFor(caseRow.stage, input.type, actor.role, pathway);
  if (!transition.ok) {
    throw new HttpError(
      transition.code === "role_not_permitted" ? 403 : 409,
      transition.code,
      transition.message,
    );
  }

  // TICKET-11: a consultation answer moves the case, so it is recorded only by answering
  // an open consultation, never through the generic events endpoint.
  if (isConsultationAnswerEvent(input.type, pathway) && input.consultationAnswer !== true) {
    throw new HttpError(
      409,
      "invalid_transition",
      `"${input.type}" is recorded by answering a consultation (POST /api/consultations/{id}/answer).`,
    );
  }

  // Who owns the case after this event, written into the payload so the timeline alone
  // can say it (rebuildCase reads it back).
  const definition = eventDefinition(input.type, pathway);
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
    // TICKET-08: an assignment records who handed the case over and who received it.
    await recordHandOver(db, caseRow, actor, requested, payload);
  } else {
    delete payload.owner_actor_id;
  }
  if (input.finalise === true) payload.finalises = true;
  await prepareOwnershipPayload(db, caseRow, input.type, transition.to, transition.moves_stage, payload, pathway);

  const now = input.occurredAt ?? (await getClock(db)).now;
  const recordedEvent: RecordedEvent = {
    type: input.type,
    actor_id: actor.actor_id,
    actor_role: actor.role,
    occurred_at: now,
    payload,
  };

  let next: CaseState | null;
  try {
    next = nextState(caseStateOf(caseRow), recordedEvent, pathway);
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

  const statements: InStatement[] = [
    statement,
    db
      .prepare(
        `UPDATE cases
            SET stage = ?, status = ?, owner_actor_id = ?, final_outcome = ?,
                stage_entered_at = ?, updated_at = ?, provider_id = ?
          WHERE id = ?`,
      )
      .bind(
        next.stage,
        next.status,
        next.owner_actor_id,
        next.final_outcome,
        next.stage_entered_at,
        new Date().toISOString(),
        next.provider_id ?? null,
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
    // TICKET-08: referral rows, the ownership gap and the assign-owner task.
    ...(await ownershipStatements(db, {
      caseId: input.caseId,
      eventId: id,
      type: input.type,
      before: caseRow,
      next,
      payload,
      now,
      pathway,
    })),
    ...(input.extraStatements ?? []),
  ];

  return { recorded: id, caseId: input.caseId, statements, next };
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
    // TICKET-08: the provider the case starts at and the patient identifier incoming
    // FHIR resources are matched on. Both optional.
    providerId?: string;
    patientIdentifier?: string;
    // TICKET-18: the template the case runs; the default (FIT) pathway when absent.
    pathwayId?: string;
  },
): Promise<{ recorded: string; caseId: string }> {
  const existing = await db.prepare("SELECT id FROM cases WHERE id = ?").get(input.caseId);
  if (existing) throw new HttpError(409, "invalid_transition", `Case ${input.caseId} already exists.`);

  let pathway: Pathway = DEFAULT_PATHWAY;
  try {
    pathway = pathwayOf(input.pathwayId);
  } catch (error) {
    if (error instanceof UnknownPathwayError) throw new HttpError(400, "validation_failed", error.message);
    throw error;
  }
  const initialStage = rulesOf(pathway).initialStage;

  let owner = input.ownerActorId ?? null;
  if (owner === null) {
    const role = stageDefinition(initialStage, pathway)?.owner_role;
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
  if (input.providerId !== undefined) await assertProviderExists(db, input.providerId);
  const payload = {
    ...(input.payload ?? {}),
    owner_actor_id: owner,
    ...(input.providerId !== undefined ? { provider_id: input.providerId } : {}),
  };
  let state: CaseState | null;
  try {
    state = nextState(
      null,
      {
        type: pathway.trigger.event,
        actor_id: input.actor.actor_id,
        actor_role: input.actor.role,
        occurred_at: now,
        payload,
      },
      pathway,
    );
  } catch (error) {
    if (error instanceof ReplayError) throw replayHttpError(error);
    throw error;
  }
  if (state === null) throw new HttpError(500, "validation_failed", "Case creation produced no state.");

  const { id, statement } = eventStatement(
    db,
    { caseId: input.caseId, type: pathway.trigger.event, actor: input.actor, payload },
    now,
  );
  const createdAt = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO cases (
           id, patient_name, patient_age, patient_language, pathway_id,
           owner_actor_id, stage, status, final_outcome, stage_entered_at, created_at, updated_at,
           provider_id, patient_identifier
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.caseId,
        input.patient.name,
        input.patient.age,
        input.patient.language,
        pathway.id,
        state.owner_actor_id,
        state.stage,
        state.status,
        state.final_outcome,
        state.stage_entered_at,
        now,
        createdAt,
        state.provider_id ?? null,
        input.patientIdentifier ?? null,
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
  // TICKET-18: replayed with the case's own template (the default if the row is gone).
  const pathwayRow = await db
    .prepare("SELECT pathway_id FROM cases WHERE id = ?")
    .get<{ pathway_id: string }>(caseId);

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
      pathwayRow?.pathway_id,
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
          SET stage = ?, status = ?, owner_actor_id = ?, final_outcome = ?, stage_entered_at = ?,
              provider_id = ?
        WHERE id = ?`,
    )
    .run(
      state.stage,
      state.status,
      state.owner_actor_id,
      state.final_outcome,
      state.stage_entered_at,
      state.provider_id ?? null,
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
  const engineCase = await loadEngineCase(db, input.caseId);
  const rules = rulesOf(engineCase.pathway_id);
  const confirmationEvent = rules.closureConfirmationEvent;
  if (confirmationEvent === null) {
    throw new HttpError(409, "invalid_transition", "This pathway has no closure confirmation.");
  }

  // An outcome chosen on the closure screen is recorded with the confirmation; without
  // one, the case's own proposed outcome is what the three conditions judge.
  const outcome = input.finalOutcome;
  if (outcome !== undefined && !isValidOutcome(outcome, rules.pathway)) {
    throw new HttpError(
      400,
      "validation_failed",
      `final_outcome must be one of ${rules.outcomes.map((o) => o.key).join(", ")}.`,
    );
  }

  const judged: EngineCase =
    outcome !== undefined && isValidOutcome(outcome, rules.pathway)
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
    type: confirmationEvent,
    actor: input.actor,
    payload: outcome !== undefined ? { outcome } : {},
    judgedOutcome: outcome,
    finalise: true,
  });
}

export async function reopenCase(
  db: Db,
  input: { caseId: string; actor: WriteActor; ownerActorId?: string },
) {
  const reopenEvent = rulesOf((await loadCase(db, input.caseId)).pathway_id).reopenEvent;
  if (reopenEvent === null) {
    throw new HttpError(409, "invalid_transition", "This pathway has no reopen event.");
  }
  return applyEvent(db, {
    caseId: input.caseId,
    type: reopenEvent,
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
  // TICKET-11: a consultation is answered with an outcome that moves the case, so its
  // task closes through the answer endpoint, never as a generic completion.
  if (task.kind === CONSULTATION_TASK) {
    throw new HttpError(
      409,
      "invalid_transition",
      "Answer the consultation instead (POST /api/consultations/{id}/answer).",
    );
  }
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

// ===========================================================================
// TICKET-08 / TICKET-11: unowned triggers, hand-over, referrals, consultations and
// FHIR stitching. Which events trigger what is template data (server/pathways); this
// block only writes the rows those rules call for, in the same batch as the event.
// ===========================================================================

export const ASSIGN_OWNER_TASK = "assign_owner";
export const CONSULTATION_TASK = "answer_consultation";
export const SUPPLY_DATA_TASK = "supply_referral_data";
export const STITCHED_HISTORY_EVENT = "fhir_resource_stitched";
export const CONSULTATION_REQUESTED_EVENT = "consultation_requested";

export const SYSTEM_ACTOR: WriteActor = {
  actor_id: "act_system",
  role: "system",
  display_name: "system",
};

// The attributes a referral (REF) message carries: status, priority and the specialty
// as a SNOMED CT code. Priority uses the three referral priorities of HL7 v2 (routine,
// ASAP, STAT); status the referral statuses plus `redirected` (superseded by a new one).
export const REFERRAL_PRIORITIES = ["routine", "asap", "stat"] as const;
export const SNOMED_SYSTEM = "http://snomed.info/sct";

const newId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

async function assertProviderExists(db: Db, providerId: string): Promise<void> {
  const row = await db.prepare("SELECT id FROM providers WHERE id = ?").get(providerId);
  if (!row) throw new HttpError(400, "validation_failed", `No provider carries the id "${providerId}".`);
}

// The first actor holding `role` at a provider: who an assign-owner task or a
// consultation lands with. Null when the provider has nobody in that role.
export async function actorAtProvider(
  db: Db,
  role: string,
  providerId: string | null,
): Promise<string | null> {
  if (providerId === null) return null;
  const row = await db
    .prepare("SELECT id FROM actors WHERE role = ? AND provider_id = ? ORDER BY id LIMIT 1")
    .get<{ id: string }>(role, providerId);
  return row?.id ?? null;
}

type OpenGap = { id: string; unowned_at: string; previous_owner_actor_id: string | null };

async function openGap(db: Db, caseId: string): Promise<OpenGap | undefined> {
  return db
    .prepare(
      `SELECT id, unowned_at, previous_owner_actor_id FROM ownership_gaps
        WHERE case_id = ? AND owned_at IS NULL ORDER BY rowid DESC LIMIT 1`,
    )
    .get<OpenGap>(caseId);
}

type ReferralRow = {
  id: string;
  to_provider_id: string;
  status: string;
  priority: string;
  specialty_system: string;
  specialty_code: string;
  specialty_display: string;
};

export async function latestReferral(db: Db, caseId: string): Promise<ReferralRow | undefined> {
  return db
    .prepare(
      `SELECT id, to_provider_id, status, priority, specialty_system, specialty_code, specialty_display
         FROM referrals WHERE case_id = ? ORDER BY rowid DESC LIMIT 1`,
    )
    .get<ReferralRow>(caseId);
}

// Who handed the case over and who received it. On an unowned case the one who handed
// over is the last owner before the case lost its owner.
async function recordHandOver(
  db: Db,
  caseRow: CaseStateRow,
  actor: WriteActor,
  received: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const gap = caseRow.owner_actor_id === null ? await openGap(db, caseRow.id) : undefined;
  payload.handed_over_by = caseRow.owner_actor_id ?? gap?.previous_owner_actor_id ?? null;
  payload.received_by = received;
  payload.assigned_by = actor.actor_id;
}

type NormalisedReferral = {
  referral_id: string;
  from_provider_id: string | null;
  to_provider_id: string;
  status: string;
  priority: string;
  specialty: { system: string; code: string; display: string };
};

function fail(message: string): never {
  throw new HttpError(400, "validation_failed", message);
}

async function normaliseReferral(
  db: Db,
  raw: unknown,
  caseId: string,
  fromProvider: string | null,
): Promise<NormalisedReferral> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("referral must be an object.");
  const r = raw as Record<string, unknown>;

  if (typeof r.to_provider_id !== "string" || r.to_provider_id.length === 0) {
    fail("referral.to_provider_id is required.");
  }
  await assertProviderExists(db, r.to_provider_id);

  const status = r.status === undefined ? "pending" : r.status;
  if (typeof status !== "string" || !(REFERRAL_STATUSES as readonly string[]).includes(status)) {
    fail(`referral.status must be one of ${REFERRAL_STATUSES.join(", ")}.`);
  }
  if (typeof r.priority !== "string" || !(REFERRAL_PRIORITIES as readonly string[]).includes(r.priority)) {
    fail(`referral.priority must be one of ${REFERRAL_PRIORITIES.join(", ")}.`);
  }

  const specialty = r.specialty;
  if (typeof specialty !== "object" || specialty === null) {
    fail("referral.specialty must be a SNOMED CT coding { system, code, display }.");
  }
  const s = specialty as Record<string, unknown>;
  if (s.system !== SNOMED_SYSTEM) fail(`referral.specialty.system must be ${SNOMED_SYSTEM}.`);
  if (typeof s.code !== "string" || !/^\d{6,18}$/.test(s.code)) {
    fail("referral.specialty.code must be a SNOMED CT concept id (6 to 18 digits).");
  }
  if (typeof s.display !== "string" || s.display.trim().length === 0) {
    fail("referral.specialty.display is required.");
  }

  let referralId: string;
  if (r.referral_id !== undefined) {
    if (typeof r.referral_id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(r.referral_id)) {
      fail("referral.referral_id must be 1 to 64 letters, digits, dots, dashes or underscores.");
    }
    referralId = r.referral_id;
  } else {
    const count = await db
      .prepare("SELECT count(*) AS n FROM referrals WHERE case_id = ?")
      .get<{ n: number }>(caseId);
    referralId = `REF-${caseId}-${(count?.n ?? 0) + 1}`;
  }
  const taken = await db.prepare("SELECT id FROM referrals WHERE id = ?").get(referralId);
  if (taken) throw new HttpError(409, "invalid_transition", `Referral ${referralId} already exists.`);

  return {
    referral_id: referralId,
    from_provider_id: fromProvider,
    to_provider_id: r.to_provider_id,
    status,
    priority: r.priority,
    specialty: { system: SNOMED_SYSTEM, code: s.code, display: s.display },
  };
}

// Payload checks for the TICKET-08 parts of an event: the previous owner on a trigger,
// the provider on a move, and the referral on an event that enters the acceptance stage.
async function prepareOwnershipPayload(
  db: Db,
  caseRow: CaseStateRow,
  type: string,
  to: string,
  movesStage: boolean,
  payload: Record<string, unknown>,
  pathway: Pathway,
): Promise<void> {
  const definition = eventDefinition(type, pathway);
  const unowned = pathway.unowned;
  if (definition?.owner === "clear" && caseRow.owner_actor_id !== null) {
    payload.previous_owner_actor_id = caseRow.owner_actor_id;
  }

  if (definition?.sets_provider) {
    const provider = payload.provider_id;
    if (typeof provider !== "string" || provider.length === 0) {
      fail(`"${type}" requires payload.provider_id.`);
    }
    await assertProviderExists(db, provider);
    if (provider === caseRow.provider_id) fail(`The case is already at provider "${provider}".`);
    payload.from_provider_id = caseRow.provider_id;
    if (payload.summary === undefined) {
      const names = await db
        .prepare("SELECT id, name FROM providers WHERE id IN (?, ?)")
        .all<{ id: string; name: string }>(provider, caseRow.provider_id ?? "");
      const name = (id: string | null) => names.find((n) => n.id === id)?.name ?? id ?? "no provider";
      payload.summary = `Patient moved from ${name(caseRow.provider_id)} to ${name(provider)}`;
    }
  }

  if (payload.referral !== undefined) {
    if (!unowned || !movesStage || to !== unowned.acceptance_stage) {
      fail(`A referral can only be sent with an event that moves the case to "${unowned?.acceptance_stage}".`);
    }
    payload.referral = await normaliseReferral(db, payload.referral, caseRow.id, caseRow.provider_id);
  }
}

// The rows that commit with the event: referral status and new referral, the ownership
// gap (opened by a trigger, closed when an owner returns) and the assign-owner task.
async function ownershipStatements(
  db: Db,
  input: {
    caseId: string;
    eventId: string;
    type: string;
    before: CaseStateRow;
    next: CaseState;
    payload: Record<string, unknown>;
    now: string;
    pathway: Pathway;
  },
): Promise<InStatement[]> {
  const out: InStatement[] = [];
  const definition = eventDefinition(input.type, input.pathway);
  const unowned = input.pathway.unowned;

  if (definition?.referral_status) {
    out.push(
      db
        .prepare(
          `UPDATE referrals SET status = ?, updated_at = ?
            WHERE id = (SELECT id FROM referrals WHERE case_id = ? ORDER BY rowid DESC LIMIT 1)`,
        )
        .bind(definition.referral_status, input.now, input.caseId),
    );
  }

  const referral = input.payload.referral as NormalisedReferral | undefined;
  if (referral && typeof referral === "object") {
    const replaces = await latestReferral(db, input.caseId);
    out.push(
      db
        .prepare(
          `INSERT INTO referrals (
             id, case_id, from_provider_id, to_provider_id, status, priority,
             specialty_system, specialty_code, specialty_display, replaces_referral_id,
             sent_event_id, sent_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          referral.referral_id,
          input.caseId,
          referral.from_provider_id,
          referral.to_provider_id,
          referral.status,
          referral.priority,
          referral.specialty.system,
          referral.specialty.code,
          referral.specialty.display,
          replaces?.id ?? null,
          input.eventId,
          input.now,
          input.now,
        ),
    );
  }

  if (!unowned) return out;
  const wasOwned = input.before.owner_actor_id !== null;
  const isOwned = input.next.owner_actor_id !== null;
  const provider = input.next.provider_id ?? null;

  if (wasOwned && !isOwned) {
    const reason =
      typeof input.payload.reason === "string"
        ? input.payload.reason
        : typeof input.payload.summary === "string"
          ? input.payload.summary
          : (definition?.label ?? input.type);
    out.push(
      db
        .prepare(
          `INSERT INTO ownership_gaps (
             id, case_id, trigger_event_id, trigger_type, reason, previous_owner_actor_id, unowned_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId("g"),
          input.caseId,
          input.eventId,
          input.type,
          reason,
          input.before.owner_actor_id,
          input.now,
        ),
      db
        .prepare(
          `INSERT INTO tasks (id, case_id, kind, owner_actor_id, due_at, status)
           VALUES (?, ?, ?, ?, ?, 'open')`,
        )
        .bind(
          newId("t"),
          input.caseId,
          ASSIGN_OWNER_TASK,
          await actorAtProvider(db, unowned.assign_owner_role, provider),
          addHours(input.now, unowned.assign_owner_hours),
        ),
    );
  } else if (!wasOwned && !isOwned && definition?.sets_provider) {
    // Moved again while unowned: the open spell continues, the task follows the patient.
    out.push(
      db
        .prepare(
          `UPDATE tasks SET owner_actor_id = ?
            WHERE case_id = ? AND kind = ? AND status = 'open'`,
        )
        .bind(await actorAtProvider(db, unowned.assign_owner_role, provider), input.caseId, ASSIGN_OWNER_TASK),
    );
  } else if (!wasOwned && isOwned) {
    const gap = await openGap(db, input.caseId);
    if (gap) {
      out.push(
        db
          .prepare(
            `UPDATE ownership_gaps
                SET owner_event_id = ?, owner_event_type = ?, owner_actor_id = ?, owned_at = ?,
                    hours_to_owner = ?
              WHERE id = ? AND owned_at IS NULL`,
          )
          .bind(
            input.eventId,
            input.type,
            input.next.owner_actor_id,
            input.now,
            roundHours(hoursBetween(gap.unowned_at, input.now)),
            gap.id,
          ),
      );
    }
    out.push(
      db
        .prepare(
          `UPDATE tasks SET status = 'completed'
            WHERE case_id = ? AND kind = ? AND status = 'open'`,
        )
        .bind(input.caseId, ASSIGN_OWNER_TASK),
    );
  }
  return out;
}

// --- TICKET-11: consultations ------------------------------------------------------

type ConsultationRow = {
  id: string;
  case_id: string;
  question: string;
  requested_by_actor_id: string;
  to_provider_id: string | null;
  to_actor_id: string | null;
  referral_id: string | null;
  requested_at: string;
  due_at: string;
  task_id: string;
  status: string;
};

// The `timers.stage` key an overdue consultation escalates under, so the unique timer
// index keeps its tick idempotent exactly as it does for stage deadlines.
export function consultationTimerStage(consultationId: string): string {
  return `consultation:${consultationId}`;
}

export async function requestConsultation(
  db: Db,
  input: {
    caseId: string;
    actor: WriteActor;
    question: unknown;
    toProviderId?: unknown;
    toActorId?: unknown;
  },
): Promise<{ recorded: string; caseId: string; consultationId: string }> {
  const caseRow = await loadCase(db, input.caseId);
  const consultation = rulesOf(caseRow.pathway_id).consultation;
  if (!consultation) throw new HttpError(409, "invalid_transition", "This pathway has no consultations.");
  const engineCase = await loadEngineCase(db, input.caseId);
  const role = input.actor.role as Role;

  if (!availableActions(engineCase, role).includes("request_consultation")) {
    if (input.actor.role === "system" || !consultation.request_roles.includes(role)) {
      throw new HttpError(403, "role_not_permitted", `The ${input.actor.role} role may not ask a consultation.`);
    }
    throw new HttpError(
      409,
      "invalid_transition",
      engineCase.open_consultation
        ? "A consultation on this case is already waiting for its answer."
        : `A consultation cannot be asked on a case at stage "${caseRow.stage}".`,
    );
  }

  if (typeof input.question !== "string" || input.question.trim().length === 0) {
    fail("A consultation needs one short question.");
  }
  const question = input.question.trim();
  if (question.length > 500) fail("Keep the question to 500 characters; details travel in e-Referral.");

  const referral = await latestReferral(db, input.caseId);
  const toProvider =
    typeof input.toProviderId === "string" && input.toProviderId.length > 0
      ? input.toProviderId
      : (referral?.to_provider_id ?? null);
  if (toProvider === null) fail("to_provider_id is required: the case has no referral to address.");
  await assertProviderExists(db, toProvider);

  let toActor: string | null;
  if (input.toActorId !== undefined) {
    if (typeof input.toActorId !== "string") fail("to_actor_id must be a string.");
    const row = await db
      .prepare("SELECT id, role FROM actors WHERE id = ?")
      .get<{ id: string; role: string }>(input.toActorId);
    if (!row) fail(`No actor carries the id "${input.toActorId}".`);
    if (!(consultation.answer_roles as readonly string[]).includes(row.role)) {
      fail(`${input.toActorId} cannot answer a consultation (role ${row.role}).`);
    }
    toActor = row.id;
  } else {
    toActor = null;
    for (const answerRole of consultation.answer_roles) {
      toActor = await actorAtProvider(db, answerRole, toProvider);
      if (toActor) break;
    }
  }
  if (toActor === null) fail(`Provider "${toProvider}" has nobody who can answer a consultation.`);

  const providerName =
    (await db.prepare("SELECT name FROM providers WHERE id = ?").get<{ name: string }>(toProvider))?.name ??
    toProvider;
  const now = (await getClock(db)).now;
  const dueAt = addHours(now, consultation.answer_hours);
  const consultationId = newId("k");
  const taskId = newId("t");

  const { id, statement } = eventStatement(
    db,
    {
      caseId: input.caseId,
      type: CONSULTATION_REQUESTED_EVENT,
      actor: input.actor,
      payload: {
        consultation_id: consultationId,
        question,
        to_provider_id: toProvider,
        to_actor_id: toActor,
        referral_id: referral?.id ?? null,
        due_at: dueAt,
        summary: `Consultation asked of ${providerName}: ${question}`,
      },
    },
    now,
  );

  await db.batch([
    statement,
    db
      .prepare(
        `INSERT INTO consultations (
           id, case_id, question, requested_by_actor_id, to_provider_id, to_actor_id,
           referral_id, requested_at, due_at, task_id, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      )
      .bind(
        consultationId,
        input.caseId,
        question,
        input.actor.actor_id,
        toProvider,
        toActor,
        referral?.id ?? null,
        now,
        dueAt,
        taskId,
      ),
    db
      .prepare(
        `INSERT INTO tasks (id, case_id, kind, owner_actor_id, due_at, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
      )
      .bind(taskId, input.caseId, CONSULTATION_TASK, toActor, dueAt),
  ]);

  return { recorded: id, caseId: input.caseId, consultationId };
}

export async function answerConsultation(
  db: Db,
  input: {
    consultationId: string;
    actor: WriteActor;
    outcome: unknown;
    note?: unknown;
    ownerActorId?: unknown;
    redirectToProviderId?: unknown;
    referral?: unknown;
  },
): Promise<{ recorded: string; caseId: string }> {
  const consultation = await db
    .prepare(
      `SELECT id, case_id, question, requested_by_actor_id, to_provider_id, to_actor_id, referral_id,
              requested_at, due_at, task_id, status
         FROM consultations WHERE id = ?`,
    )
    .get<ConsultationRow>(input.consultationId);
  if (!consultation) {
    throw new HttpError(404, "not_found", `No consultation carries the id "${input.consultationId}".`);
  }
  if (consultation.status !== "open") {
    throw new HttpError(409, "invalid_transition", "That consultation is already answered.");
  }

  const engineCase = await loadEngineCase(db, consultation.case_id);
  const rules = rulesOf(engineCase.pathway_id);
  if (!rules.consultation) throw new HttpError(409, "invalid_transition", "This pathway has no consultations.");
  if (!availableActions(engineCase, input.actor.role as Role).includes("answer_consultation")) {
    throw new HttpError(403, "role_not_permitted", `The ${input.actor.role} role may not answer a consultation.`);
  }

  if (!isConsultationAnswer(input.outcome)) {
    fail("outcome must be one of accepted, redirected, more_data_requested.");
  }
  const outcome = input.outcome;
  const event = consultationAnswerEvent(outcome, rules.pathway);
  if (!event) throw new HttpError(409, "invalid_transition", `This pathway has no "${outcome}" answer.`);
  if (input.note !== undefined && typeof input.note !== "string") fail("note must be a string.");
  if (input.ownerActorId !== undefined && typeof input.ownerActorId !== "string") {
    fail("owner_actor_id must be a string.");
  }

  const now = (await getClock(db)).now;
  const hours = roundHours(hoursBetween(consultation.requested_at, now));
  const payload: Record<string, unknown> = {
    consultation_id: consultation.id,
    outcome,
    question: consultation.question,
    hours_to_answer: hours,
    ...(typeof input.note === "string" ? { note: input.note } : {}),
    summary: `Consultation answered (${outcome.replace(/_/g, " ")}) after ${hours}h`,
  };

  if (outcome === "redirected") {
    const redirect = input.redirectToProviderId;
    if (typeof redirect !== "string" || redirect.length === 0) {
      fail("A redirected answer names redirect_to_provider_id.");
    }
    const previous = await latestReferral(db, consultation.case_id);
    const given =
      typeof input.referral === "object" && input.referral !== null
        ? (input.referral as Record<string, unknown>)
        : {};
    payload.redirect_to_provider_id = redirect;
    // The new referral keeps the priority and specialty of the one it replaces unless
    // the answer says otherwise.
    payload.referral = {
      priority: previous?.priority,
      ...(previous
        ? {
            specialty: {
              system: previous.specialty_system,
              code: previous.specialty_code,
              display: previous.specialty_display,
            },
          }
        : {}),
      ...given,
      to_provider_id: redirect,
      status: "pending",
    };
  }

  const prepared = await prepareEvent(db, {
    caseId: consultation.case_id,
    type: event.type,
    actor: input.actor,
    payload,
    ownerActorId:
      typeof input.ownerActorId === "string" ? input.ownerActorId : consultation.requested_by_actor_id,
    consultationAnswer: true,
    occurredAt: now,
  });

  const statements: InStatement[] = [
    ...prepared.statements,
    db
      .prepare(
        `UPDATE consultations
            SET status = 'answered', outcome = ?, answer_note = ?, answered_by_actor_id = ?,
                answered_at = ?, answer_event_id = ?, hours_to_answer = ?
          WHERE id = ? AND status = 'open'`,
      )
      .bind(
        outcome,
        typeof input.note === "string" ? input.note : null,
        input.actor.actor_id,
        now,
        prepared.recorded,
        hours,
        consultation.id,
      ),
    db
      .prepare("UPDATE tasks SET status = 'completed' WHERE id = ? AND status = 'open'")
      .bind(consultation.task_id),
    db
      .prepare(
        `UPDATE timers SET status = 'cancelled'
          WHERE case_id = ? AND stage = ? AND status = 'fired'`,
      )
      .bind(consultation.case_id, consultationTimerStage(consultation.id)),
  ];
  if (outcome === "more_data_requested") {
    statements.push(
      db
        .prepare(
          `INSERT INTO tasks (id, case_id, kind, owner_actor_id, due_at, status)
           VALUES (?, ?, ?, ?, ?, 'open')`,
        )
        .bind(
          newId("t"),
          consultation.case_id,
          SUPPLY_DATA_TASK,
          consultation.requested_by_actor_id,
          addHours(now, rules.consultation.more_data_hours),
        ),
    );
  }

  await db.batch(statements);
  return { recorded: prepared.recorded, caseId: consultation.case_id };
}

// --- TICKET-08: FHIR stitching -----------------------------------------------------

export type IncomingResource = {
  resource_type: string;
  resource_id: string;
  status: string;
  source_provider_id: string | null;
  patient_identifier: string | null;
  referral_id: string | null;
  summary: string;
  raw: unknown;
};

function fhirPayload(resource: IncomingResource, ingestedBy: WriteActor): Record<string, unknown> {
  return {
    fhir: {
      resource_type: resource.resource_type,
      resource_id: resource.resource_id,
      key: `${resource.resource_type}/${resource.resource_id}`,
      status: resource.status,
      source_provider_id: resource.source_provider_id,
      referral_id: resource.referral_id,
      patient_identifier: resource.patient_identifier,
    },
    stitched: true,
    ingested_by: ingestedBy.actor_id,
  };
}

// Records a matched resource on its case. When the template maps it to an event that is
// a legal next step, the system role records that event (the case moves); otherwise it
// is stitched as history and the reason it did not move is kept with it.
export async function stitchResource(
  db: Db,
  input: {
    caseId: string;
    resource: IncomingResource;
    event: string | null;
    document: { kind: string; title: string; text: string } | null;
    ingestedBy: WriteActor;
  },
): Promise<{ recorded: string; moved: boolean; stage: string; document_id: string | null }> {
  const caseRow = await loadCase(db, input.caseId);
  const now = (await getClock(db)).now;
  const payload = fhirPayload(input.resource, input.ingestedBy);
  const documentId = input.document ? newId("d") : null;
  if (documentId) payload.document_id = documentId;

  const extra: InStatement[] = [
    db
      .prepare(
        `UPDATE unstitched SET status = 'stitched', stitched_case_id = ?
          WHERE resource_type = ? AND resource_id = ? AND status = 'queued'`,
      )
      .bind(input.caseId, input.resource.resource_type, input.resource.resource_id),
  ];
  if (input.document && documentId) {
    extra.push(
      db
        .prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES (?, ?, ?, ?, ?)")
        .bind(documentId, input.caseId, input.document.kind, input.document.title, input.document.text),
    );
  }

  let notMoved: string | null = null;
  if (input.event !== null) {
    const transition = transitionFor(caseRow.stage, input.event, "system", caseRow.pathway_id);
    if (transition.ok && transition.moves_stage) {
      const prepared = await prepareEvent(db, {
        caseId: input.caseId,
        type: input.event,
        actor: SYSTEM_ACTOR,
        payload: { ...payload, summary: `${input.resource.summary} (stitched)` },
        occurredAt: now,
        extraStatements: extra,
      });
      await db.batch(prepared.statements);
      return { recorded: prepared.recorded, moved: true, stage: prepared.next.stage, document_id: documentId };
    }
    notMoved = transition.ok ? "the event does not move the stage" : transition.message;
  } else {
    notMoved = "the template maps this resource to no case event";
  }

  const { id, statement } = eventStatement(
    db,
    {
      caseId: input.caseId,
      type: STITCHED_HISTORY_EVENT,
      actor: SYSTEM_ACTOR,
      payload: {
        ...payload,
        mapped_event: input.event,
        stage_moved: false,
        not_moved_reason: notMoved,
        summary: `${input.resource.summary} (stitched as history: ${notMoved})`,
      },
    },
    now,
  );
  await db.batch([statement, ...extra]);
  return { recorded: id, moved: false, stage: caseRow.stage, document_id: documentId };
}

// Not matched: kept in the queue with its reason. A resource already in the queue is not
// queued twice.
export async function queueUnstitched(
  db: Db,
  input: { resource: IncomingResource; reasonCode: string; reason: string },
): Promise<{ unstitched_id: string; duplicate: boolean }> {
  const existing = await db
    .prepare("SELECT id FROM unstitched WHERE resource_type = ? AND resource_id = ?")
    .get<{ id: string }>(input.resource.resource_type, input.resource.resource_id);
  if (existing) {
    await db
      .prepare("UPDATE unstitched SET reason_code = ?, reason = ? WHERE id = ? AND status = 'queued'")
      .run(input.reasonCode, input.reason, existing.id);
    return { unstitched_id: existing.id, duplicate: true };
  }
  const id = newId("u");
  await db
    .prepare(
      `INSERT INTO unstitched (
         id, resource_type, resource_id, source_provider_id, patient_identifier, referral_id,
         reason_code, reason, resource, received_at, recorded_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
    )
    .run(
      id,
      input.resource.resource_type,
      input.resource.resource_id,
      input.resource.source_provider_id,
      input.resource.patient_identifier,
      input.resource.referral_id,
      input.reasonCode,
      input.reason,
      JSON.stringify(input.resource.raw),
      (await getClock(db)).now,
      new Date().toISOString(),
    );
  return { unstitched_id: id, duplicate: false };
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
