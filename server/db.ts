import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Schema for TICKET-03. Event rows are the source of truth; the status columns on
// `cases` are a cache that a later ticket rebuilds from `events`.
//
// Storage is libSQL: a local SQLite file in development and tests, Turso when deployed
// (Vercel functions have no persistent disk). Both speak the same SQLite dialect, so
// the SQL below runs unchanged in either place.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS actors (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN (
                  'coordination_staff', 'navigator', 'responsible_physician',
                  'program_manager', 'patient', 'system')),
  display_name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id                TEXT PRIMARY KEY,
  patient_name      TEXT NOT NULL,
  patient_age       INTEGER NOT NULL,
  patient_language  TEXT NOT NULL,
  pathway_id        TEXT NOT NULL,
  owner_actor_id    TEXT REFERENCES actors(id),
  stage             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  -- one of the outcomes in server/engine.ts; null until a closure is decided
  final_outcome     TEXT,
  -- computed from events; nullable because it is a cache, not the record
  stage_entered_at  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES cases(id),
  type         TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,
  recorded_at  TEXT NOT NULL,
  payload      TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS events_by_case ON events (case_id, occurred_at);

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  case_id         TEXT NOT NULL REFERENCES cases(id),
  kind            TEXT NOT NULL,
  owner_actor_id  TEXT REFERENCES actors(id),
  due_at          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS tasks_by_case ON tasks (case_id, status);

CREATE TABLE IF NOT EXISTS documents (
  id        TEXT PRIMARY KEY,
  case_id   TEXT NOT NULL REFERENCES cases(id),
  kind      TEXT NOT NULL,
  title     TEXT NOT NULL,
  text      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS extractions (
  id                TEXT PRIMARY KEY,
  case_id           TEXT NOT NULL REFERENCES cases(id),
  document_id       TEXT NOT NULL REFERENCES documents(id),
  prompt_version    TEXT NOT NULL,
  model             TEXT NOT NULL,
  proposal          TEXT NOT NULL,
  proposal_reason   TEXT NOT NULL DEFAULT '',
  fields            TEXT NOT NULL DEFAULT '[]',
  text_hash         TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS extractions_by_text ON extractions (text_hash);

-- The demo clock (TICKET-06). One row, so it survives a restart and every read measures
-- deadlines against the same instant. now is demo time; day is the offset from day 0.
CREATE TABLE IF NOT EXISTS clocks (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  now  TEXT NOT NULL,
  day  INTEGER NOT NULL DEFAULT 0
);

-- One row per escalation that actually fired. The unique key is what makes tick()
-- idempotent: a second tick at the same level cannot insert a second row.
CREATE TABLE IF NOT EXISTS timers (
  id        TEXT PRIMARY KEY,
  case_id   TEXT NOT NULL REFERENCES cases(id),
  stage     TEXT NOT NULL,
  due_at    TEXT NOT NULL,
  level     INTEGER NOT NULL,
  role      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'fired',
  fired_at  TEXT NOT NULL,
  UNIQUE (case_id, stage, due_at, level)
);

CREATE INDEX IF NOT EXISTS timers_by_case ON timers (case_id, status);

-- ---- TICKET-10: patient outreach ladder (server/outreach/) ----------------------
-- The simulated link in the automated message: one opaque token per case, no login.
CREATE TABLE IF NOT EXISTS outreach_links (
  token       TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL UNIQUE REFERENCES cases(id),
  created_at  TEXT NOT NULL
);

-- One row per ladder step that fired (message, staff_call, callback, navigator). A run is
-- one visit of the case to the ladder's stage, so the unique key makes tick() idempotent
-- the same way the timers key does, and a reopened case starts a fresh run.
CREATE TABLE IF NOT EXISTS outreach_steps (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases(id),
  run_id      TEXT NOT NULL,
  step        TEXT NOT NULL,
  fired_at    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  task_id     TEXT,
  event_id    TEXT,
  UNIQUE (case_id, run_id, step)
);
-- ---- end TICKET-10 ----------------------------------------------------------------

-- Append-only is enforced by the database, not by convention in code.
CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only: update rejected');
END;

CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only: delete rejected');
END;
`;

// --- TICKET-08 / TICKET-11 ---------------------------------------------------------
// Providers (with the case's current provider on `cases.provider_id`), referrals in the
// shape the REF messages carry, the per-case ownership gaps (the "time to owned again"
// metric), consultations, and the queue of FHIR resources that matched no case.
// `cases.provider_id`, `cases.patient_identifier` and `actors.provider_id` are added by
// prepareSchema below, so a file created by an earlier build gains them too.
const SCHEMA_OWNERSHIP = `
CREATE TABLE IF NOT EXISTS providers (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  kind  TEXT NOT NULL CHECK (kind IN ('clinic', 'hospital', 'endoscopy_unit', 'laboratory'))
);

-- One row per referral. status / priority / SNOMED specialty are the attributes the
-- referral (REF) messages carry; status is updated by the events the template marks
-- with referral_status, and the event that sent it is kept.
CREATE TABLE IF NOT EXISTS referrals (
  id                    TEXT PRIMARY KEY,
  case_id               TEXT NOT NULL REFERENCES cases(id),
  from_provider_id      TEXT REFERENCES providers(id),
  to_provider_id        TEXT NOT NULL REFERENCES providers(id),
  status                TEXT NOT NULL,
  priority              TEXT NOT NULL,
  specialty_system      TEXT NOT NULL,
  specialty_code        TEXT NOT NULL,
  specialty_display     TEXT NOT NULL,
  replaces_referral_id  TEXT,
  sent_event_id         TEXT NOT NULL,
  sent_at               TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS referrals_by_case ON referrals (case_id);

-- One row per unowned spell: opened by the event that cleared the owner, closed by the
-- event that gave the case an owner again. hours_to_owner is the TICKET-08 metric.
CREATE TABLE IF NOT EXISTS ownership_gaps (
  id                       TEXT PRIMARY KEY,
  case_id                  TEXT NOT NULL REFERENCES cases(id),
  trigger_event_id         TEXT NOT NULL UNIQUE,
  trigger_type             TEXT NOT NULL,
  reason                   TEXT NOT NULL DEFAULT '',
  previous_owner_actor_id  TEXT,
  unowned_at               TEXT NOT NULL,
  owner_event_id           TEXT,
  owner_event_type         TEXT,
  owner_actor_id           TEXT,
  owned_at                 TEXT,
  hours_to_owner           REAL
);

CREATE INDEX IF NOT EXISTS ownership_gaps_by_case ON ownership_gaps (case_id, owned_at);

-- TICKET-11. A question from the referring physician to the receiving provider, with
-- the task that owes the answer and hours_to_answer once it is answered.
CREATE TABLE IF NOT EXISTS consultations (
  id                     TEXT PRIMARY KEY,
  case_id                TEXT NOT NULL REFERENCES cases(id),
  question               TEXT NOT NULL,
  requested_by_actor_id  TEXT NOT NULL REFERENCES actors(id),
  to_provider_id         TEXT REFERENCES providers(id),
  to_actor_id            TEXT REFERENCES actors(id),
  referral_id            TEXT,
  requested_at           TEXT NOT NULL,
  due_at                 TEXT NOT NULL,
  task_id                TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  outcome                TEXT,
  answer_note            TEXT,
  answered_by_actor_id   TEXT,
  answered_at            TEXT,
  answer_event_id        TEXT,
  hours_to_answer        REAL
);

CREATE INDEX IF NOT EXISTS consultations_by_case ON consultations (case_id, status);

-- FHIR resources that matched no open case. Never dropped: a later ingest of the same
-- resource that does match marks the row stitched.
CREATE TABLE IF NOT EXISTS unstitched (
  id                  TEXT PRIMARY KEY,
  resource_type       TEXT NOT NULL,
  resource_id         TEXT NOT NULL,
  source_provider_id  TEXT,
  patient_identifier  TEXT,
  referral_id         TEXT,
  reason_code         TEXT NOT NULL,
  reason              TEXT NOT NULL,
  resource            TEXT NOT NULL,
  received_at         TEXT NOT NULL,
  recorded_at         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'stitched')),
  stitched_case_id    TEXT,
  UNIQUE (resource_type, resource_id)
);
`;

async function addColumnIfMissing(db: Db, table: string, column: string, definition: string) {
  const columns = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (!columns.some((c) => c.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function prepareOwnershipSchema(db: Db): Promise<void> {
  await db.exec(SCHEMA_OWNERSHIP);
  await addColumnIfMissing(db, "actors", "provider_id", "TEXT REFERENCES providers(id)");
  await addColumnIfMissing(db, "cases", "provider_id", "TEXT REFERENCES providers(id)");
  await addColumnIfMissing(db, "cases", "patient_identifier", "TEXT");
}

// Children before parents, so foreign keys never block the drop.
const TABLES = [
  // TICKET-08 / TICKET-11
  "unstitched",
  "consultations",
  "ownership_gaps",
  "referrals",
  // TICKET-10
  "outreach_steps",
  "outreach_links",
  "extractions",
  "timers",
  "tasks",
  "documents",
  "events",
  "cases",
  "actors",
  "clocks",
  // TICKET-08: actors and cases point at providers, so providers go last.
  "providers",
] as const;

type Value = string | number | bigint | null | ArrayBuffer | Uint8Array | boolean;
type Params = Value[] | [Record<string, Value | undefined>];

// libSQL rejects `undefined`; better-sqlite3 callers relied on it meaning NULL.
function toArgs(params: Params): InArgs {
  if (params.length === 1 && params[0] !== null && typeof params[0] === "object" && !ArrayBuffer.isView(params[0]) && !(params[0] instanceof ArrayBuffer)) {
    const named: Record<string, Value> = {};
    for (const [key, value] of Object.entries(params[0] as Record<string, Value | undefined>)) {
      named[key] = value === undefined ? null : value;
    }
    return named as InArgs;
  }
  return (params as Value[]).map((value) => (value === undefined ? null : value)) as InArgs;
}

// A prepared statement in the better-sqlite3 shape the rest of the server was written
// against (`get`, `all`, `run`), except every call returns a promise.
export class Statement {
  constructor(
    private readonly client: Client,
    readonly sql: string,
  ) {}

  // For Db.batch: the statement with its arguments, run later in one atomic write.
  bind(...params: Params): InStatement {
    return { sql: this.sql, args: toArgs(params) };
  }

  async all<T = Record<string, unknown>>(...params: Params): Promise<T[]> {
    const result = await this.client.execute(this.bind(...params));
    return result.rows.map((row) => {
      const plain: Record<string, unknown> = {};
      result.columns.forEach((column, index) => {
        plain[column] = row[index];
      });
      return plain as T;
    });
  }

  async get<T = Record<string, unknown>>(...params: Params): Promise<T | undefined> {
    const rows = await this.all<T>(...params);
    return rows[0];
  }

  async run(...params: Params): Promise<{ changes: number }> {
    const result = await this.client.execute(this.bind(...params));
    return { changes: result.rowsAffected };
  }
}

export class Db {
  constructor(readonly client: Client) {}

  prepare(sql: string): Statement {
    return new Statement(this.client, sql);
  }

  async exec(sql: string): Promise<void> {
    await this.client.executeMultiple(sql);
  }

  // The replacement for better-sqlite3's db.transaction(): every statement commits
  // together, or none does. One round trip, which matters when the database is remote.
  async batch(statements: InStatement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.client.batch(statements, "write");
  }

  close(): void {
    this.client.close();
  }
}

export type DatabaseTarget = { url: string; authToken?: string; local: boolean };

// TURSO_DATABASE_URL wins when it is set (the deployed app); otherwise DATABASE_FILE, a
// local SQLite file. Read here and nowhere else, so tests can point it at a temp file.
export function databaseTarget(): DatabaseTarget {
  const remote = process.env.TURSO_DATABASE_URL;
  if (remote) {
    return { url: remote, authToken: process.env.TURSO_AUTH_TOKEN, local: false };
  }
  // On Vercel a local file would be written to a read-only or throwaway disk and the demo
  // would silently lose its state, so a missing URL is a configuration error.
  if (process.env.VERCEL) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Add it and TURSO_AUTH_TOKEN to the Vercel project.",
    );
  }
  return { url: pathToFileURL(databaseFile()).href, local: true };
}

export function databaseFile(): string {
  return resolve(process.env.DATABASE_FILE ?? "data/nexyra.sqlite");
}

// Where the data lives, for log lines. Never prints the auth token.
export function databaseLabel(): string {
  const target = databaseTarget();
  return target.local ? databaseFile() : target.url;
}

async function prepareSchema(db: Db): Promise<void> {
  await db.exec(SCHEMA);

  // CREATE TABLE IF NOT EXISTS does not add columns to a file created by an earlier
  // build, and data/nexyra.sqlite is not recreated between phases.
  const caseColumns = await db.prepare("PRAGMA table_info(cases)").all<{ name: string }>();
  if (!caseColumns.some((column) => column.name === "final_outcome")) {
    await db.exec("ALTER TABLE cases ADD COLUMN final_outcome TEXT");
  }

  await prepareOwnershipSchema(db);
}

// A local file path (tests, scripts) or a full target. The schema is created on open.
export async function openDatabase(target: string | DatabaseTarget): Promise<Db> {
  const resolved: DatabaseTarget =
    typeof target === "string"
      ? { url: pathToFileURL(resolve(target)).href, local: true }
      : target;

  if (resolved.local) {
    const path = typeof target === "string" ? resolve(target) : databaseFile();
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Db(createClient({ url: resolved.url, authToken: resolved.authToken }));
  if (resolved.local) {
    // WAL lets the demo read while a write is in flight. Turso manages its own journal.
    await db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  }
  await db.exec("PRAGMA foreign_keys = ON;");
  await prepareSchema(db);
  return db;
}

// `npm run demo:reset` on either backend: a remote database has no file to delete, and
// the append-only triggers refuse a DELETE on events, so the tables are dropped and the
// schema is created again.
export async function resetDatabase(db: Db): Promise<void> {
  await db.exec(
    [
      "DROP TRIGGER IF EXISTS events_no_update;",
      "DROP TRIGGER IF EXISTS events_no_delete;",
      ...TABLES.map((table) => `DROP TABLE IF EXISTS ${table};`),
    ].join("\n"),
  );
  await prepareSchema(db);
}

// The process-wide connection, opened on first use. A serverless function keeps it for
// as long as its instance stays warm.
let shared: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!shared) {
    shared = openDatabase(databaseTarget()).catch((error: unknown) => {
      shared = null;
      throw error;
    });
  }
  return shared;
}

export async function closeDb(): Promise<void> {
  if (shared) {
    const pending = shared;
    shared = null;
    try {
      (await pending).close();
    } catch {
      // Opening failed; there is nothing to close.
    }
  }
  await releaseFileHandles();
}

// libSQL keeps a closed connection's file open until its prepared statements are
// garbage-collected, so on Windows the file cannot be deleted right after close().
// Tests (which delete temp files) run with --expose-gc; elsewhere this does nothing.
export async function releaseFileHandles(): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) return;
  // A statement that failed (a trigger refusing a write) is only freed on a later
  // cycle, after the rejected promise holding its error has itself become garbage.
  for (let pass = 0; pass < 3; pass += 1) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
