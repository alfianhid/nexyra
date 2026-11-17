import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Schema for TICKET-03. Event rows are the source of truth; the status columns on
// `cases` are a cache that a later ticket rebuilds from `events`.

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

export type Db = Database.Database;

export function openDatabase(file: string): Db {
  if (file !== ":memory:") {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new Database(file);
  // WAL lets the demo read while a write is in flight; TICKET-02 chose one file on disk.
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);

  // CREATE TABLE IF NOT EXISTS does not add columns to a file created by an earlier
  // build, and data/nexyra.sqlite is not recreated between phases.
  const caseColumns = db.prepare("PRAGMA table_info(cases)").all() as { name: string }[];
  if (!caseColumns.some((column) => column.name === "final_outcome")) {
    db.exec("ALTER TABLE cases ADD COLUMN final_outcome TEXT");
  }

  return db;
}

// The process-wide connection, created on first use. DATABASE_FILE is read here and
// nowhere else, so tests can point it at a temp file.
let shared: Db | null = null;

export function databaseFile(): string {
  return resolve(process.env.DATABASE_FILE ?? "data/nexyra.sqlite");
}

export function getDb(): Db {
  if (!shared) shared = openDatabase(databaseFile());
  return shared;
}

export function closeDb(): void {
  if (shared) {
    shared.close();
    shared = null;
  }
}
