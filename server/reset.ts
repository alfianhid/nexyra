import type { InStatement } from "@libsql/client";
import { generateCohort } from "../scripts/generate/generate.js";
import { ingestCohort } from "../scripts/generate/ingest.js";
import { DEMO_START, setClock } from "./clock.js";
import { closeDb, databaseLabel, getDb, openDatabase, resetDatabase, type Db } from "./db.js";
import { seed } from "./seed.js";

// TICKET-17: `npm run demo:reset` puts the database back to the demo's starting state:
// the three demo cases, the 1,000-case synthetic cohort, and the demo clock on day 0.
//
// The state is built in an in-memory database first, then copied into the target in a
// few large batches. Building it in place would send every cohort write through the
// engine one round trip at a time (about 60,000 queries, half an hour against Turso);
// the copy is a fixed handful of round trips, so the same reset runs locally, from a
// laptop against Turso (`demo:reset:remote`) and from the daily cron (TICKET-21).
//
// The result is identical on every run. The engine stamps each write with a random id
// and the real time, so the copy replaces both: random ids (`e_1a2b3c4d`) become ids
// numbered in the order they were written (`e_r00001`), every event's `recorded_at` is
// its `occurred_at` (the seed already records its own history that way), and every
// case's `updated_at` is day 0. Nothing reads those columns to decide anything.

export type ResetOptions = { cohort?: boolean };

export type ResetResult = {
  cases: number;
  cohort_cases: number;
  events: number;
  rows: number;
  batches: number;
  build_ms: number;
  copy_ms: number;
};

// A database with the demo's starting state, built locally.
export async function buildDemoState(options: ResetOptions = {}): Promise<Db> {
  const db = await openDatabase({ url: ":memory:", local: false });
  await seed(db);
  if (options.cohort !== false) await ingestCohort(db, generateCohort());
  await setClock(db, DEMO_START, 0);
  return db;
}

type Row = Record<string, unknown>;
type Table = { name: string; sql: string; columns: string[]; rows: Row[] };

// The ids the engine generates: a short prefix and 8 hex characters from randomUUID.
const RANDOM_ID = /\b([a-z]{1,3})_([0-9a-f]{8})\b/g;

// Parents before children, so every foreign key points at a row that is already there.
// Tables another module adds later are picked up from sqlite_master the same way.
async function tablesInCopyOrder(db: Db): Promise<{ name: string; sql: string }[]> {
  const tables = await db
    .prepare(
      `SELECT name, sql FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%'
        ORDER BY name`,
    )
    .all<{ name: string; sql: string }>();
  const parents = new Map<string, Set<string>>();
  for (const table of tables) {
    const keys = await db.prepare(`PRAGMA foreign_key_list(${table.name})`).all<{ table: string }>();
    parents.set(table.name, new Set(keys.map((k) => k.table).filter((t) => t !== table.name)));
  }
  const ordered: { name: string; sql: string }[] = [];
  const placed = new Set<string>();
  while (ordered.length < tables.length) {
    const next = tables.find(
      (t) => !placed.has(t.name) && [...(parents.get(t.name) ?? [])].every((p) => placed.has(p) || !parents.has(p)),
    );
    // A cycle cannot happen in this schema; if one appears, copy the rest in name order.
    const pick = next ?? tables.find((t) => !placed.has(t.name));
    if (!pick) break;
    ordered.push(pick);
    placed.add(pick.name);
  }
  return ordered;
}

async function readTables(db: Db): Promise<Table[]> {
  const out: Table[] = [];
  for (const { name, sql } of await tablesInCopyOrder(db)) {
    const columns = (await db.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>()).map((c) => c.name);
    const rows = await db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all<Row>();
    out.push({ name, sql, columns, rows });
  }
  return out;
}

// Random ids renumbered in the order the rows were written, everywhere they appear
// (primary keys, foreign keys, ids inside event payloads), plus the two real-time columns.
export function canonicalise(tables: Table[]): Table[] {
  const renamed = new Map<string, string>();
  const perPrefix = new Map<string, number>();
  const rename = (value: string) =>
    value.replace(RANDOM_ID, (match, prefix: string) => {
      let next = renamed.get(match);
      if (!next) {
        const n = (perPrefix.get(prefix) ?? 0) + 1;
        perPrefix.set(prefix, n);
        next = `${prefix}_r${String(n).padStart(5, "0")}`;
        renamed.set(match, next);
      }
      return next;
    });

  return tables.map((table) => ({
    ...table,
    rows: table.rows.map((row) => {
      const copy: Row = {};
      for (const column of table.columns) {
        const value = row[column];
        copy[column] = typeof value === "string" ? rename(value) : value;
      }
      if (table.name === "events" && typeof copy.occurred_at === "string") copy.recorded_at = copy.occurred_at;
      if (table.name === "cases" && "updated_at" in copy) copy.updated_at = DEMO_START;
      return copy;
    }),
  }));
}

// Multi-row INSERTs, at most ROWS_PER_INSERT rows each (and under SQLite's 32,766
// parameter limit), STATEMENTS_PER_BATCH of them per round trip.
const ROWS_PER_INSERT = 100;
const STATEMENTS_PER_BATCH = 20;

function insertStatements(table: Table): InStatement[] {
  const out: InStatement[] = [];
  const width = table.columns.length;
  const perInsert = Math.max(1, Math.min(ROWS_PER_INSERT, Math.floor(30_000 / Math.max(1, width))));
  const columnList = table.columns.map((c) => `"${c}"`).join(", ");
  const placeholders = `(${table.columns.map(() => "?").join(", ")})`;
  for (let start = 0; start < table.rows.length; start += perInsert) {
    const chunk = table.rows.slice(start, start + perInsert);
    out.push({
      sql: `INSERT INTO ${table.name} (${columnList}) VALUES ${chunk.map(() => placeholders).join(", ")}`,
      args: chunk.flatMap((row) => table.columns.map((c) => (row[c] ?? null) as never)),
    });
  }
  return out;
}

// Replaces everything in `target` with the tables of `source`.
export async function copyDatabase(source: Db, target: Db): Promise<{ rows: number; batches: number }> {
  const tables = canonicalise(await readTables(source));

  await resetDatabase(target);
  const present = new Set(
    (
      await target
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all<{ name: string }>()
    ).map((r) => r.name),
  );

  const statements: InStatement[] = [];
  for (const table of tables) {
    // A table some module creates on first use: create it the same way, empty.
    if (!present.has(table.name)) statements.push({ sql: table.sql, args: [] });
    // resetDatabase drops the tables it knows; this empties any it does not (events is
    // always among the known ones, so its append-only trigger never sees a DELETE).
    else if (table.name !== "events") statements.push({ sql: `DELETE FROM ${table.name}`, args: [] });
    statements.push(...insertStatements(table));
  }

  let batches = 0;
  for (let start = 0; start < statements.length; start += STATEMENTS_PER_BATCH) {
    await target.batch(statements.slice(start, start + STATEMENTS_PER_BATCH));
    batches += 1;
  }
  return { rows: tables.reduce((n, t) => n + t.rows.length, 0), batches };
}

export async function resetDemo(target: Db, options: ResetOptions = {}): Promise<ResetResult> {
  const started = Date.now();
  const built = await buildDemoState(options);
  const builtAt = Date.now();
  let copied: { rows: number; batches: number };
  try {
    copied = await copyDatabase(built, target);
  } finally {
    built.close();
  }
  const count = async (sql: string) => (await target.prepare(sql).get<{ n: number }>())?.n ?? 0;
  return {
    cases: await count("SELECT count(*) AS n FROM cases"),
    cohort_cases: await count("SELECT count(*) AS n FROM cases WHERE id LIKE 'SY-%'"),
    events: await count("SELECT count(*) AS n FROM events"),
    rows: copied.rows,
    batches: copied.batches,
    build_ms: builtAt - started,
    copy_ms: Date.now() - builtAt,
  };
}

// `npm run demo:reset` (add `-- --no-cohort` for the three demo cases alone). The same
// command resets a local file and, with TURSO_DATABASE_URL set, the deployed database.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("server/reset.ts")) {
  const started = Date.now();
  const result = await resetDemo(await getDb(), { cohort: !process.argv.includes("--no-cohort") });
  console.log(`reset ${databaseLabel()}`);
  console.log(
    `cases=${result.cases} (cohort ${result.cohort_cases}) events=${result.events} clock=day 0 ` +
      `rows=${result.rows} batches=${result.batches}`,
  );
  console.log(
    `built in ${(result.build_ms / 1000).toFixed(1)}s, copied in ${(result.copy_ms / 1000).toFixed(1)}s, ` +
      `total ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  await closeDb();
}
