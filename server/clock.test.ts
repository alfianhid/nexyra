import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TICKET-06 done-when, called over HTTP so the endpoints themselves are proven:
// one escalation per level, a repeated tick doubles nothing, the clock survives a
// restart, and a case that leaves its stage early is never escalated.

let server: Server | undefined;
let base = "";
let dir = "";
let file = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-clock-"));
  file = join(dir, "clock.sqlite");
  process.env.DATABASE_FILE = file;

  const { getDb } = await import("./db");
  const { seed } = await import("./seed");
  const { app } = await import("./index");

  getDb();
  seed();

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server?.address();
  if (typeof address === "object" && address !== null) {
    base = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closeDb } = await import("./db");
  closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await response.json()) as any;
  return { status: response.status, body: json };
}

// A real reset, the way `npm run demo:reset` does it: the events table is append-only,
// so nothing can delete an escalation. Rebuilding the file is the only honest reset.
async function resetDemo() {
  const { closeDb, getDb } = await import("./db");
  const { seed } = await import("./seed");

  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${file}${suffix}`, { force: true, maxRetries: 5, retryDelay: 50 });
  }
  getDb();
  seed();
}

describe("GET /api/clock", () => {
  it("returns the demo clock with its display label", async () => {
    const { status, body } = await call("GET", "/api/clock");
    expect(status).toBe(200);
    expect(body.now).toBe("2026-11-17T11:42:00+07:00");
    expect(body.is_demo).toBe(true);
    expect(body.day).toBe(0);
    expect(body.referral_limit_days).toBe(31);
    expect(body.label).toBe("17 Nov 2026 · 11:42");
  });
});

describe("POST /api/clock/tick", () => {
  it("twice at the same instant produces no additional escalation", async () => {
    await resetDemo();

    const first = await call("POST", "/api/clock/tick");
    expect(first.status).toBe(200);
    const fired = first.body.escalations;

    const second = await call("POST", "/api/clock/tick");
    expect(second.status).toBe(200);
    expect(second.body.escalations).toBe(0);

    // Whatever the seeded lateness was, it fired once and only once.
    expect(first.body.escalations_per_role.reduce((n: number, r: { count: number }) => n + r.count, 0)).toBe(
      fired,
    );
  });
});

describe("POST /api/clock/advance", () => {
  it("advances one level per day, never more", async () => {
    await resetDemo();

    // CX-1003 has been past its 48h closure deadline since 14 Nov. The first advance
    // fires level 1 only, even though the case is days late: the ladder is paced by the
    // demo clock, not backfilled.
    const day1 = await call("POST", "/api/clock/advance", { days: 1 });
    expect(day1.status).toBe(200);
    expect(day1.body.clock.day).toBe(1);
    expect(day1.body.escalations).toBe(1);
    expect(day1.body.escalations_per_role).toEqual([
      { role: "responsible_physician", count: 1 },
    ]);

    const repeat = await call("POST", "/api/clock/tick");
    expect(repeat.body.escalations).toBe(0);

    const day2 = await call("POST", "/api/clock/advance", { days: 1 });
    expect(day2.body.clock.day).toBe(2);
    expect(day2.body.escalations).toBe(1);
    expect(day2.body.escalations_per_role).toEqual([{ role: "program_manager", count: 1 }]);
  });

  it("stops at the top of the ladder instead of escalating for ever", async () => {
    await resetDemo();
    for (let i = 0; i < 6; i += 1) await call("POST", "/api/clock/advance", { days: 1 });

    const { getDb } = await import("./db");
    const levels = getDb()
      .prepare("SELECT level FROM timers WHERE case_id = 'CX-1003' ORDER BY level")
      .all() as { level: number }[];
    expect(levels.map((l) => l.level)).toEqual([1, 2, 3]);
  });

  it("advances to the next deadline instead of a fixed number of days", async () => {
    await resetDemo();
    const { body } = await call("POST", "/api/clock/advance", { until: "next_deadline" });
    expect(body.clock.day).toBeGreaterThan(0);
    // The next deadline ahead of day 0 is CX-1001's 22 Nov 09:12 stage deadline.
    expect(body.clock.now).toBe("2026-11-22T09:12:00+07:00");
    expect(body.escalations).toBeGreaterThanOrEqual(1);
  });

  it("rejects a request with neither days nor until", async () => {
    const { status, body } = await call("POST", "/api/clock/advance", {});
    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
  });
});

describe("the escalated case", () => {
  it("prints a negative number and the word escalated in the register", async () => {
    await resetDemo();
    await call("POST", "/api/clock/advance", { days: 1 });

    const { body } = await call("GET", "/api/cases?role=responsible_physician");
    const row = body.cases.find((c: { case_id: string }) => c.case_id === "CX-1003");

    expect(row.flags).toContain("late");
    expect(row.hours_left_stage).toBeLessThan(0);
    expect(row.flags_renderable.join(" ")).toMatch(/LATE|escalat/i);
  });

  it("records the escalation as an event and a task for the next role", async () => {
    const { getDb } = await import("./db");
    const db = getDb();

    const event = db
      .prepare(
        `SELECT actor_role, payload FROM events
          WHERE case_id = 'CX-1003' AND type = 'deadline_missed'
          ORDER BY occurred_at DESC, rowid DESC LIMIT 1`,
      )
      .get() as { actor_role: string; payload: string } | undefined;

    expect(event?.actor_role).toBe("system");
    const payload = JSON.parse(event?.payload ?? "{}") as { escalated_to?: string };
    expect(payload.escalated_to).toBe("responsible_physician");

    const task = db
      .prepare(
        `SELECT t.kind, a.role FROM tasks t LEFT JOIN actors a ON a.id = t.owner_actor_id
          WHERE t.case_id = 'CX-1003' AND t.kind = 'escalation'
          ORDER BY t.rowid DESC LIMIT 1`,
      )
      .get() as { kind: string; role: string } | undefined;
    expect(task?.role).toBe("responsible_physician");
  });
});

describe("a case that leaves its stage before the deadline", () => {
  it("is never escalated for the stage it left", async () => {
    await resetDemo();
    const { getDb } = await import("./db");
    const db = getDb();

    // CX-1001 is at result_received until 22 Nov. Move it on before its deadline.
    db.prepare(
      `UPDATE cases SET stage = 'colonoscopy_booked', stage_entered_at = ? WHERE id = 'CX-1001'`,
    ).run("2026-11-17T11:42:00+07:00");

    await call("POST", "/api/clock/advance", { days: 6 });

    const escalated = db
      .prepare(
        `SELECT count(*) AS n FROM timers WHERE case_id = 'CX-1001' AND stage = 'result_received'`,
      )
      .get() as { n: number };
    expect(escalated.n).toBe(0);
  });
});

describe("restart", () => {
  it("keeps the demo clock and the timers across a close and reopen", async () => {
    await resetDemo();
    await call("POST", "/api/clock/advance", { days: 2 });

    const { closeDb, openDatabase } = await import("./db");
    const before = (
      (await import("./db")).getDb().prepare("SELECT count(*) AS n FROM timers").get() as { n: number }
    ).n;

    closeDb();
    const reopened = openDatabase(file);
    const row = reopened.prepare("SELECT now, day FROM clocks WHERE id = 1").get() as {
      now: string;
      day: number;
    };
    const timers = reopened.prepare("SELECT count(*) AS n FROM timers").get() as { n: number };
    reopened.close();

    expect(row.day).toBe(2);
    expect(row.now).toBe("2026-11-19T11:42:00+07:00");
    expect(timers.n).toBe(before);
    expect(timers.n).toBeGreaterThan(0);
  });
});
