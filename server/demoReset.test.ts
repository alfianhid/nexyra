import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// TICKET-21: the hosted demo resets itself once a day through POST (or the cron's GET)
// /api/demo/reset. Closed unless a secret is configured; then a Bearer token is required.

let server: Server | undefined;
let base = "";
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-demoreset-"));
  process.env.DATABASE_FILE = join(dir, "reset.sqlite");
  delete process.env.DEMO_RESET_SECRET;
  delete process.env.CRON_SECRET;
  const { getDb } = await import("./db.js");
  const { seed } = await import("./seed.js");
  const { app } = await import("./index.js");
  await seed(await getDb());
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  // A reset takes ~5 s; keep the pooled socket open across it.
  if (server) server.keepAliveTimeout = 60_000;
  const address = server?.address();
  if (typeof address === "object" && address !== null) base = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  delete process.env.DEMO_RESET_SECRET;
  delete process.env.CRON_SECRET;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closeDb } = await import("./db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function reset(method: "GET" | "POST", token?: string) {
  const response = await fetch(`${base}/api/demo/reset`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, body: (await response.json()) as any };
}

describe("TICKET-21: POST /api/demo/reset", () => {
  it("does not exist while no secret is configured", async () => {
    const result = await reset("POST", "anything");
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe("not_found");
  });

  it("refuses a missing or wrong token", async () => {
    process.env.DEMO_RESET_SECRET = "s3cret-for-the-test-only";
    expect((await reset("POST")).status).toBe(401);
    expect((await reset("POST", "wrong")).status).toBe(401);
    expect((await reset("POST", "s3cret-for-the-test-onlyX")).status).toBe(401);
  });

  it("resets to day 0 with the cohort, for DEMO_RESET_SECRET and for Vercel Cron's GET with CRON_SECRET", async () => {
    await fetch(`${base}/api/clock/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 2 }),
    });

    process.env.DEMO_RESET_SECRET = "manual-secret";
    const manual = await reset("POST", "manual-secret");
    expect(manual.status).toBe(200);
    expect(manual.body).toMatchObject({ reset: true, cases: 1003, cohort_cases: 1000 });
    expect(manual.body.clock).toMatchObject({ day: 0, now: "2026-11-17T11:42:00+07:00" });

    delete process.env.DEMO_RESET_SECRET;
    process.env.CRON_SECRET = "cron-secret";
    const cron = await reset("GET", "cron-secret");
    expect(cron.status).toBe(200);
    expect(cron.body.reset).toBe(true);
  }, 120_000);

  it("rejects an unknown cohort setting on the worklist", async () => {
    const response = await fetch(`${base}/api/cases?role=program_manager&cohort=all`);
    expect(response.status).toBe(400);
  });
});
