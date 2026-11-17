import type { Actor } from "./actor";
import { REFERRAL_LIMIT_DAYS, addHours, embeddedClock, formatDue, hoursBetween } from "./clock";
import type { Db } from "./db";
import {
  OUTCOMES,
  STAGES,
  availableActions,
  isClosed,
  stageDefinition,
  stageLabel,
  stageOrder,
  type EngineCase,
  type Role,
} from "./engine";
import { HttpError } from "./errors";

// Reads only. Every rule (which stage, which owner, which actions) comes from
// server/engine.ts; this file joins the database and formats, it does not decide.

export type CaseFilter = "late" | "unowned" | "awaiting_closure_confirmation";

export const CASE_FILTERS: readonly CaseFilter[] = [
  "late",
  "unowned",
  "awaiting_closure_confirmation",
];

export function isCaseFilter(value: unknown): value is CaseFilter {
  return typeof value === "string" && (CASE_FILTERS as readonly string[]).includes(value);
}

type CaseRow = {
  id: string;
  patient_name: string;
  patient_age: number;
  patient_language: string;
  stage: string;
  status: string;
  owner_actor_id: string | null;
  owner_name: string | null;
  owner_role: string | null;
  final_outcome: string | null;
  stage_entered_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  case_id: string;
  kind: string;
  owner_actor_id: string | null;
  owner_name: string | null;
  owner_role: string | null;
  due_at: string;
  status: string;
};

type EventRow = {
  id: string;
  type: string;
  actor_id: string;
  actor_role: string;
  actor_name: string | null;
  occurred_at: string;
  recorded_at: string;
  payload: string;
};

function ownerOf(row: CaseRow): Actor | null {
  if (row.owner_actor_id === null) return null;
  return {
    actor_id: row.owner_actor_id,
    role: (row.owner_role ?? "coordination_staff") as Role,
    display_name: row.owner_name ?? row.owner_actor_id,
  };
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function caseRows(db: Db): CaseRow[] {
  return db
    .prepare(
      `SELECT c.id, c.patient_name, c.patient_age, c.patient_language, c.stage, c.status,
              c.owner_actor_id, c.final_outcome, c.stage_entered_at, c.created_at, c.updated_at,
              a.display_name AS owner_name, a.role AS owner_role
         FROM cases c
         LEFT JOIN actors a ON a.id = c.owner_actor_id`,
    )
    .all() as CaseRow[];
}

function caseRow(db: Db, caseId: string): CaseRow | undefined {
  return caseRows(db).find((row) => row.id === caseId);
}

function documentsFor(
  db: Db,
  caseId: string,
): { id: string; kind: string; title: string }[] {
  return db
    .prepare("SELECT id, kind, title FROM documents WHERE case_id = ?")
    .all(caseId) as { id: string; kind: string; title: string }[];
}

function physicianConfirmed(db: Db, caseId: string): boolean {
  const row = db
    .prepare(
      `SELECT count(*) AS n FROM events
        WHERE case_id = ? AND type = 'closure_confirmed' AND actor_role = 'responsible_physician'`,
    )
    .get(caseId) as { n: number };
  return row.n > 0;
}

function toEngineCase(db: Db, row: CaseRow): EngineCase {
  return {
    stage: row.stage,
    status: row.status,
    owner_actor_id: row.owner_actor_id,
    final_outcome: row.final_outcome,
    documents: documentsFor(db, row.id).map((doc) => ({ kind: doc.kind })),
    physician_confirmed: physicianConfirmed(db, row.id),
  };
}

// Hours to the stage deadline; null for a closed case, negative once it has passed.
function hoursLeftStage(row: CaseRow, now: string): number | null {
  const definition = stageDefinition(row.stage);
  if (!definition || definition.sla_hours === null || isClosed(toClosedShape(row))) return null;
  const entered = row.stage_entered_at ?? row.created_at;
  return Math.round(hoursBetween(now, addHours(entered, definition.sla_hours)));
}

// The deadline maths needs only stage and status; keeping it separate avoids loading
// documents for every worklist row.
function toClosedShape(row: CaseRow): EngineCase {
  return {
    stage: row.stage,
    status: row.status,
    owner_actor_id: row.owner_actor_id,
    final_outcome: row.final_outcome,
    documents: [],
    physician_confirmed: false,
  };
}

function flagsFor(row: CaseRow, hoursLeft: number | null): string[] {
  const flags: string[] = [];
  if (isClosed(toClosedShape(row))) flags.push("closed");
  if (row.owner_actor_id === null && !flags.includes("closed")) flags.push("unowned");
  if (hoursLeft !== null) {
    if (hoursLeft < 0) flags.push("late");
    else if (hoursLeft < 48) flags.push("due");
  }
  return flags;
}

function renderableFor(row: CaseRow, hoursLeft: number | null): string[] {
  const words: string[] = [];
  if (isClosed(toClosedShape(row))) words.push("Closed");
  if (hoursLeft !== null && hoursLeft < 0) {
    const over = Math.abs(hoursLeft);
    words.push(
      over >= 24 ? `LATE — ${Math.ceil(over / 24)} days over` : `LATE — ${Math.round(over)} hours over`,
    );
  }
  if (hoursLeft !== null && hoursLeft >= 0 && hoursLeft < 48) {
    words.push(`Due in ${Math.round(hoursLeft)} hours`);
  }
  if (row.owner_actor_id === null && !isClosed(toClosedShape(row))) words.push("Unowned");
  return words;
}

// `role` scopes the register: a case belongs to a role through its open task or its
// owner. Unowned cases are visible to every role that may assign an owner
// (docs/api.md permission table). The program manager reads every row.
function visibleToRole(
  row: CaseRow,
  taskRoles: ReadonlySet<string>,
  role: Role,
): boolean {
  if (role === "program_manager") return true;
  if (row.owner_role === role) return true;
  if (taskRoles.has(role)) return true;
  return row.owner_actor_id === null && !isClosed(toClosedShape(row));
}

function passesFilter(
  row: CaseRow,
  hoursLeft: number | null,
  filter: CaseFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter === "late") return hoursLeft !== null && hoursLeft < 0;
  if (filter === "unowned") return row.owner_actor_id === null && !isClosed(toClosedShape(row));
  return row.stage === "closure_proposed" && !isClosed(toClosedShape(row));
}

function taskRows(db: Db): TaskRow[] {
  return db
    .prepare(
      `SELECT t.id, t.case_id, t.kind, t.owner_actor_id, t.due_at, t.status,
              a.display_name AS owner_name, a.role AS owner_role
         FROM tasks t
         LEFT JOIN actors a ON a.id = t.owner_actor_id`,
    )
    .all() as TaskRow[];
}

function taskRolesByCase(tasks: TaskRow[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (task.status !== "open" || task.owner_role === null) continue;
    const set = map.get(task.case_id) ?? new Set<string>();
    set.add(task.owner_role);
    map.set(task.case_id, set);
  }
  return map;
}

export function listCases(db: Db, role: Role, filter: CaseFilter | undefined, now: string) {
  const rows = caseRows(db);
  const rolesByCase = taskRolesByCase(taskRows(db));

  const visible = rows
    .filter((row) => visibleToRole(row, rolesByCase.get(row.id) ?? new Set(), role))
    .map((row) => ({ row, hoursLeft: hoursLeftStage(row, now) }))
    .filter(({ row, hoursLeft }) => passesFilter(row, hoursLeft, filter));

  // Server-side ordering: clinical urgency from the pathway, then time remaining.
  visible.sort((a, b) => {
    const urgency = (stageDefinition(a.row.stage)?.urgency ?? 99) -
      (stageDefinition(b.row.stage)?.urgency ?? 99);
    if (urgency !== 0) return urgency;
    const leftA = a.hoursLeft ?? Number.POSITIVE_INFINITY;
    const leftB = b.hoursLeft ?? Number.POSITIVE_INFINITY;
    if (leftA !== leftB) return leftA - leftB;
    return a.row.id.localeCompare(b.row.id);
  });

  const cases = visible.map(({ row, hoursLeft }) => ({
    case_id: row.id,
    patient: {
      display_name: row.patient_name,
      age: row.patient_age,
      language: row.patient_language,
    },
    stage: row.stage,
    stage_label: stageLabel(row.stage),
    owner: ownerOf(row),
    hours_left_stage: hoursLeft,
    days_left_stage: hoursLeft === null ? 0 : Math.round(hoursLeft / 24),
    days_left_referral_limit: Math.round(
      REFERRAL_LIMIT_DAYS - hoursBetween(row.created_at, now) / 24,
    ),
    flags: flagsFor(row, hoursLeft),
    flags_renderable: renderableFor(row, hoursLeft),
  }));

  const open = visible.filter(({ row }) => !isClosed(toClosedShape(row)));
  return {
    clock: embeddedClock(),
    counts: {
      open: open.length,
      unowned: open.filter(({ row }) => row.owner_actor_id === null).length,
      past_deadline: open.filter(({ hoursLeft }) => hoursLeft !== null && hoursLeft < 0).length,
      awaiting_clinician: open.filter(({ row }) => row.stage === "closure_proposed").length,
      closed_this_week: visible.length - open.length,
    },
    cases,
  };
}

function timelineFor(db: Db, caseId: string) {
  const events = db
    .prepare(
      `SELECT e.id, e.type, e.actor_id, e.actor_role, e.occurred_at, e.recorded_at, e.payload,
              a.display_name AS actor_name
         FROM events e
         LEFT JOIN actors a ON a.id = e.actor_id
        WHERE e.case_id = ?
        ORDER BY e.occurred_at, e.rowid`,
    )
    .all(caseId) as EventRow[];

  return events.map((event) => ({
    event_id: event.id,
    type: event.type,
    // A null actor means the engine wrote the event; the UI prints `system`.
    actor:
      event.actor_role === "system"
        ? null
        : {
            actor_id: event.actor_id,
            role: event.actor_role as Role,
            display_name: event.actor_name ?? event.actor_id,
          },
    occurred_at: event.occurred_at,
    recorded_at: event.recorded_at,
    summary:
      typeof parsePayload(event.payload).summary === "string"
        ? (parsePayload(event.payload).summary as string)
        : event.type,
    payload: parsePayload(event.payload),
  }));
}

function outreachAttemptsFor(db: Db, caseId: string) {
  const events = db
    .prepare(
      `SELECT id, type, occurred_at, payload FROM events
        WHERE case_id = ? AND type = 'outreach_attempted'
        ORDER BY occurred_at, rowid`,
    )
    .all(caseId) as { id: string; type: string; occurred_at: string; payload: string }[];

  return events.map((event, index) => {
    const payload = parsePayload(event.payload);
    const channel =
      payload.channel === "sms" || payload.channel === "letter" ? payload.channel : "call";
    const summary = typeof payload.summary === "string" ? payload.summary : "Attempt recorded";
    return {
      n: index + 1,
      at: formatDue(event.occurred_at),
      channel,
      result: typeof payload.result === "string" ? payload.result : summary,
      minutes: typeof payload.minutes === "number" ? payload.minutes : 0,
    };
  });
}

function verificationSummary(db: Db, caseId: string) {
  const row = db
    .prepare(
      "SELECT proposal FROM extractions WHERE case_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(caseId) as { proposal: string } | undefined;

  return row
    ? { status: "ready", proposal: row.proposal }
    : { status: "pending", proposal: "needs_human_reading" };
}

// GET /api/cases/{case_id}/verification. No cached extraction means no report text to
// cite, so the honest answer is "a human has to read this" rather than an empty claim.
export function getVerification(db: Db, caseId: string) {
  const row = caseRow(db, caseId);
  if (!row) {
    throw new HttpError(404, "not_found", `No case carries the reference ${caseId}.`);
  }

  const extraction = db
    .prepare(
      `SELECT x.id, x.document_id, x.prompt_version, x.model, x.fields, x.proposal,
              x.proposal_reason, d.text
         FROM extractions x
         JOIN documents d ON d.id = x.document_id
        WHERE x.case_id = ?
        ORDER BY x.created_at DESC
        LIMIT 1`,
    )
    .get(caseId) as
    | {
        id: string;
        document_id: string;
        prompt_version: string;
        model: string;
        fields: string;
        proposal: string;
        proposal_reason: string;
        text: string;
      }
    | undefined;

  if (!extraction) {
    const document = documentsFor(db, caseId)[0];
    return {
      report: { document_id: document?.id ?? null, text: "" },
      extraction: {
        prompt_version: "v1",
        model: null,
        fields: [],
        proposal: "needs_human_reading",
        proposal_reason: "No report has been read for this case yet.",
      },
    };
  }

  let fields: unknown = [];
  try {
    fields = JSON.parse(extraction.fields);
  } catch {
    fields = [];
  }

  return {
    report: { document_id: extraction.document_id, text: extraction.text },
    extraction: {
      prompt_version: extraction.prompt_version,
      model: extraction.model,
      fields,
      proposal: extraction.proposal,
      proposal_reason: extraction.proposal_reason,
    },
  };
}

export function getCaseDetail(db: Db, caseId: string, role: Role) {
  const row = caseRow(db, caseId);
  if (!row) {
    throw new HttpError(404, "not_found", `No case carries the reference ${caseId}.`);
  }

  const engineCase = toEngineCase(db, row);
  const currentOrder = stageOrder(row.stage);
  const entered = row.stage_entered_at ?? row.created_at;
  const definition = stageDefinition(row.stage);
  // A stage with no SLA (or no definition) has no deadline to compute, so the label says
  // when the case last moved: stage_entered_at is demo-clock time, unlike updated_at.
  const deadline =
    definition?.sla_hours != null ? addHours(entered, definition.sla_hours) : entered;

  const tasks = taskRows(db).filter((task) => task.case_id === caseId);

  return {
    case: {
      case_id: row.id,
      patient: {
        display_name: row.patient_name,
        age: row.patient_age,
        language: row.patient_language,
      },
      stage: row.stage,
      stage_label: stageLabel(row.stage),
      owner: ownerOf(row),
      status: row.status,
      stage_due_label: formatDue(deadline),
      final_outcome: row.final_outcome,
      outcomes: OUTCOMES.map((outcome) => ({ key: outcome.key, label: outcome.label })),
    },
    stages: STAGES.map((stage) => ({
      key: stage.key,
      label: stage.label,
      short_label: stage.short_label,
      state:
        stage.order < currentOrder
          ? "passed"
          : stage.order === currentOrder
            ? "current"
            : "ahead",
    })),
    timeline: timelineFor(db, caseId),
    documents: documentsFor(db, caseId).map((document) => ({
      document_id: document.id,
      kind: document.kind,
      title: document.title,
    })),
    tasks: tasks.map((task) => ({
      task_id: task.id,
      kind: task.kind,
      owner:
        task.owner_actor_id === null
          ? null
          : {
              actor_id: task.owner_actor_id,
              role: (task.owner_role ?? "coordination_staff") as Role,
              display_name: task.owner_name ?? task.owner_actor_id,
            },
      due_at: task.due_at,
      status: task.status,
    })),
    outreach_attempts: outreachAttemptsFor(db, caseId),
    available_actions: availableActions(engineCase, role),
    verification: verificationSummary(db, caseId),
  };
}
