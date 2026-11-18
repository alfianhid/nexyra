import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.js";
import { countQueries, type QueryCounter } from "./queryCounter.js";

// TICKET-17: deployed, every query is a round trip to Turso (about 20-50 ms), so the
// requests the demo makes must reach the database a fixed, small number of times however
// many cases there are. These budgets are checked with the full demo state loaded (three
// demo cases plus the 1,000-case cohort). Before the change, one "+1 day" took 2,252
// round trips (about 68 s at 30 ms each); `npm run perf` prints the current figures.

let server: Server | undefined;
let base = "";
let dir = "";
let db: Db;
let counter: QueryCounter;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-budget-"));
  process.env.DATABASE_FILE = join(dir, "budget.sqlite");
  const { getDb } = await import("./db.js");
  const { resetDemo } = await import("./reset.js");
  const { app } = await import("./index.js");
  db = await getDb();
  await resetDemo(db);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server?.address();
  if (typeof address === "object" && address !== null) base = `http://127.0.0.1:${address.port}`;
  counter = countQueries(db);
}, 120_000);

afterAll(async () => {
  counter?.restore();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closeDb } = await import("./db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function roundTrips(method: "GET" | "POST", path: string, body?: unknown): Promise<number> {
  counter.reset();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  expect(response.status, path).toBe(200);
  await response.json();
  return counter.total;
}

describe("TICKET-17: round trips per request with the cohort loaded", () => {
  it("keeps the reads the demo screens make to a handful of queries", async () => {
    expect(await roundTrips("GET", "/api/cases?role=program_manager")).toBeLessThanOrEqual(8);
    expect(await roundTrips("GET", "/api/cases?role=program_manager&cohort=include")).toBeLessThanOrEqual(8);
    expect(await roundTrips("GET", "/api/cases/CX-1003?role=responsible_physician")).toBeLessThanOrEqual(14);
    expect(await roundTrips("GET", "/api/unowned")).toBeLessThanOrEqual(4);
    expect(await roundTrips("GET", "/api/program/summary?role=program_manager")).toBeLessThanOrEqual(9);
  });

  it("advances the clock in a fixed number of round trips, day after day", async () => {
    for (let day = 1; day <= 3; day += 1) {
      expect(await roundTrips("POST", "/api/clock/advance", { days: 1 })).toBeLessThanOrEqual(20);
    }
    expect(await roundTrips("POST", "/api/clock/tick")).toBeLessThanOrEqual(16);
  });

  it("ticks all 1,003 cases with no per-case query, if the cohort is ever included", async () => {
    const { tick } = await import("./escalation.js");
    const { getClock, addHours } = await import("./clock.js");
    const at = addHours((await getClock(db)).now, 24);

    counter.reset();
    const first = await tick(db, at, { includeCohort: true });
    // The backlog this replays is why the API never includes the cohort (server/cohort.ts).
    expect(first.escalations).toBeGreaterThan(500);
    // Each case made unowned is one engine write (prepareEvent reads its own case); every
    // other lookup is one query for all cases.
    const unowned = first.unowned_triggered ?? 0;
    expect(counter.total).toBeLessThanOrEqual(20 + 6 * unowned);

    counter.reset();
    const second = await tick(db, addHours(at, 24), { includeCohort: true });
    expect(second.escalations).toBeGreaterThan(500);
    expect(counter.total).toBeLessThanOrEqual(20 + 6 * (second.unowned_triggered ?? 0));
  });
});
