import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClock } from "./clock.js";
import { closeDb, openDatabase, type Db } from "./db.js";
import { advanceClock } from "./escalation.js";
import { countQueries } from "./queryCounter.js";
import { resetDemo, type ResetResult } from "./reset.js";

// TICKET-17 done-when: `npm run demo:reset` finishes in under a minute and always
// produces the same result. Same result means every row of every table, ids and
// timestamps included, not a summary of them.

let dir = "";
const dbs: Db[] = [];

async function fresh(name: string): Promise<Db> {
  const db = await openDatabase(join(dir, `${name}.sqlite`));
  dbs.push(db);
  return db;
}

async function dump(db: Db): Promise<Record<string, { rows: number; sha: string }>> {
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<{ name: string }>();
  const out: Record<string, { rows: number; sha: string }> = {};
  for (const { name } of tables) {
    const rows = await db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
    out[name] = { rows: rows.length, sha: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }
  return out;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-reset-"));
});

afterAll(async () => {
  for (const db of dbs) db.close();
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("TICKET-17: npm run demo:reset", () => {
  let first: ResetResult;
  let firstDump: Awaited<ReturnType<typeof dump>>;

  it("loads the three demo cases, the 1,000-case cohort and day 0 in under a minute", async () => {
    const db = await fresh("a");
    const started = Date.now();
    first = await resetDemo(db);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(60_000);
    expect(first.cohort_cases).toBe(1000);
    // Three FIT demo cases, three TICKET-18 mammography cases and the cohort.
    expect(first.cases).toBe(1006);
    const clock = await getClock(db);
    expect(clock).toMatchObject({ now: "2026-11-17T11:42:00+07:00", day: 0 });
    const demo = await db
      .prepare("SELECT id, stage, owner_actor_id FROM cases WHERE id LIKE 'CX-%' ORDER BY id")
      .all();
    expect(demo).toEqual([
      { id: "CX-1001", stage: "result_received", owner_actor_id: "act_005" },
      { id: "CX-1002", stage: "patient_notified", owner_actor_id: null },
      { id: "CX-1003", stage: "closure_proposed", owner_actor_id: "act_003" },
    ]);
    // No random id and no wall-clock time survives the reset.
    const random = await db
      .prepare("SELECT count(*) AS n FROM events WHERE id GLOB 'e_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'")
      .get<{ n: number }>();
    expect(random?.n).toBe(0);
    const wallClock = await db
      .prepare("SELECT count(*) AS n FROM events WHERE recorded_at != occurred_at")
      .get<{ n: number }>();
    expect(wallClock?.n).toBe(0);
    firstDump = await dump(db);
  }, 120_000);

  it("produces byte-identical tables on a second run, even over a database the demo has used", async () => {
    const db = await fresh("b");
    await resetDemo(db);
    // Use it the way a rehearsal does: the clock moves, the ladder and escalations write.
    await advanceClock(db, { days: 3 });
    expect((await getClock(db)).day).toBe(3);

    await resetDemo(db);
    expect(await dump(db)).toEqual(firstDump);
  }, 120_000);

  it("writes the copy in a fixed handful of round trips, so it also fits a remote database", async () => {
    const db = await fresh("c");
    const counter = countQueries(db);
    const result = await resetDemo(db);
    counter.restore();
    // ~7,000 rows go out in a few batches; the rest is schema setup and the final counts.
    expect(result.batches).toBeLessThan(15);
    expect(counter.total).toBeLessThan(40);
  }, 120_000);
});
