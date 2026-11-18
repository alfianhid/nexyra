import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `npm run perf`: round trips and time per request with the demo state loaded (three demo
// cases plus the 1,000-case cohort). Deployed, each round trip goes to Turso, so a request
// costs about (round trips x 20-50 ms) on top of its local time. `-- --latency 30` adds a
// real 30 ms delay to every round trip instead of estimating it.
//
// It runs against a throwaway database file, never data/nexyra.sqlite.

const latencyArg = process.argv.indexOf("--latency");
const latencyMs = latencyArg > 0 ? Number(process.argv[latencyArg + 1] ?? 30) : 0;
const ESTIMATE_MS = 30;

const dir = mkdtempSync(join(tmpdir(), "nexyra-perf-"));
process.env.DATABASE_FILE = join(dir, "perf.sqlite");

const { closeDb, getDb } = await import("../server/db.js");
const { resetDemo } = await import("../server/reset.js");
const { countQueries } = await import("../server/queryCounter.js");
const { app } = await import("../server/index.js");

const db = await getDb();
const resetStarted = Date.now();
await resetDemo(db);
console.log(`demo:reset (cohort included) took ${((Date.now() - resetStarted) / 1000).toFixed(1)}s`);

const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const address = server.address();
const base = typeof address === "object" && address !== null ? `http://127.0.0.1:${address.port}` : "";

const counter = countQueries(db, { latencyMs });

type Row = { request: string; roundTrips: number; execute: number; batch: number; ms: number; at30: number; note: string };
const rows: Row[] = [];

async function measure(label: string, method: "GET" | "POST", path: string, body?: unknown, note = "") {
  counter.reset();
  const started = performance.now();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await response.json()) as Record<string, unknown>;
  const ms = performance.now() - started;
  if (response.status !== 200) throw new Error(`${label}: ${response.status} ${JSON.stringify(json)}`);
  const localMs = latencyMs > 0 ? ms - counter.total * latencyMs : ms;
  rows.push({
    request: label,
    roundTrips: counter.total,
    execute: counter.execute,
    batch: counter.batch,
    ms: Math.round(ms),
    at30: Math.round(localMs + counter.total * ESTIMATE_MS),
    note,
  });
  return json;
}

await measure("GET /api/cases (program manager)", "GET", "/api/cases?role=program_manager");
await measure("GET /api/cases (coordination staff)", "GET", "/api/cases?role=coordination_staff");
await measure("GET /api/cases?cohort=include (PM)", "GET", "/api/cases?role=program_manager&cohort=include");
await measure("GET /api/cases/CX-1003", "GET", "/api/cases/CX-1003?role=responsible_physician");
await measure("GET /api/unowned", "GET", "/api/unowned");
await measure("GET /api/program/summary", "GET", "/api/program/summary?role=program_manager");
for (const day of [1, 2, 3]) {
  const result = (await measure(`POST /api/clock/advance (to day ${day})`, "POST", "/api/clock/advance", { days: 1 })) as {
    escalations: number;
    outreach?: { messages_sent: number; staff_calls: number; navigator_escalations: number };
    unowned_triggered: number;
  };
  const last = rows.at(-1);
  if (last) {
    last.note =
      `escalations=${result.escalations} unowned=${result.unowned_triggered} ` +
      `messages=${result.outreach?.messages_sent ?? 0} calls=${result.outreach?.staff_calls ?? 0} ` +
      `navigator=${result.outreach?.navigator_escalations ?? 0}`;
  }
}
await measure("POST /api/clock/tick (nothing due)", "POST", "/api/clock/tick");
await measure("GET /api/program/summary (day 3)", "GET", "/api/program/summary?role=program_manager");

// The cohort is never ticked by the API (server/cohort.ts). This runs the same tick over
// all 1,003 cases anyway, to show its round trips do not grow with the number of cases.
{
  const { tick } = await import("../server/escalation.js");
  const { addHours } = await import("../server/clock.js");
  counter.restore();
  const again = countQueries(db, { latencyMs });
  // The reset itself: built in memory, then copied into the target in a few batches.
  const resetAt = performance.now();
  const reset = await resetDemo(db);
  const resetMs = performance.now() - resetAt;
  rows.push({
    request: "demo:reset (build + copy into target)",
    roundTrips: again.total,
    execute: again.execute,
    batch: again.batch,
    ms: Math.round(resetMs),
    at30: Math.round((latencyMs > 0 ? resetMs - again.total * latencyMs : resetMs) + again.total * ESTIMATE_MS),
    note: `rows=${reset.rows} build=${reset.build_ms}ms copy=${reset.copy_ms}ms`,
  });
  let at = "2026-11-17T11:42:00+07:00";
  for (const day of [1, 2, 3]) {
    at = addHours(at, 24);
    again.reset();
    const started = performance.now();
    const result = await tick(db, at, { includeCohort: true });
    const ms = performance.now() - started;
    const localMs = latencyMs > 0 ? ms - again.total * latencyMs : ms;
    rows.push({
      request: `tick() incl. cohort (day ${day}, no HTTP)`,
      roundTrips: again.total,
      execute: again.execute,
      batch: again.batch,
      ms: Math.round(ms),
      at30: Math.round(localMs + again.total * ESTIMATE_MS),
      note:
        `escalations=${result.escalations} unowned=${result.unowned_triggered ?? 0} ` +
        `messages=${result.outreach?.messages_sent ?? 0} calls=${result.outreach?.staff_calls ?? 0} ` +
        `navigator=${result.outreach?.navigator_escalations ?? 0}`,
    });
  }
  again.restore();
}

counter.restore();
console.log(`latency per round trip: ${latencyMs ? `${latencyMs} ms (real)` : `0 ms (estimate column adds ${ESTIMATE_MS} ms each)`}`);
console.table(
  rows.map((r) => ({
    request: r.request,
    round_trips: r.roundTrips,
    "execute/batch": `${r.execute}/${r.batch}`,
    ms: r.ms,
    [`~ms at ${ESTIMATE_MS}ms/trip`]: r.at30,
    note: r.note,
  })),
);

await new Promise<void>((resolve) => server.close(() => resolve()));
await closeDb();
try {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
} catch {
  // Windows keeps libSQL's file open a little longer; the OS cleans its temp folder.
}
