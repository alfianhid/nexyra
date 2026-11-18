import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Endpoints, not just the engine: docs/api.md says a test calls each guarded surface
// directly, so the browser is never the only defence. Writes are phase 5; these are
// the reads those writes will return.

let server: Server | undefined;
let base = "";
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-api-"));
  process.env.DATABASE_FILE = join(dir, "api.sqlite");

  const { getDb } = await import("./db.js");
  const { seed } = await import("./seed.js");
  const { app } = await import("./index.js");

  await getDb();
  await seed();

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
  const { closeDb } = await import("./db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function get(path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, { headers });
  // Test helper: responses are asserted field by field below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await response.json()) as any;
  return { status: response.status, body };
}

const physicianHeader = JSON.stringify({
  actor_id: "act_003",
  role: "responsible_physician",
  display_name: "Dr. Fulan",
});

describe("GET /api/cases", () => {
  it("scopes the register to the coordinator's cases and orders server-side", async () => {
    const { status, body } = await get("/api/cases?role=coordination_staff");
    expect(status).toBe(200);

    const ids = body.cases.map((c: { case_id: string }) => c.case_id);
    // Ordered by the template's stage urgency: CX-1002 is back at patient_notified after
    // its rejected referral, which ranks above CX-1001's result_received. (In the old
    // seven-stage list both sat at result_received and time left decided.)
    expect(ids).toEqual(["CX-1002", "CX-1001"]);
    expect(body.counts.open).toBe(2);
    expect(body.counts.unowned).toBe(1);
    expect(body.clock).toEqual({ now: "2026-11-17T11:42:00+07:00", is_demo: true, day: 0 });
  });

  it("returns the physician's own case with the contract's deadline fields", async () => {
    const { status, body } = await get("/api/cases?role=responsible_physician");
    expect(status).toBe(200);
    expect(body.cases.map((c: { case_id: string }) => c.case_id)).toContain("CX-1003");

    const row = body.cases.find((c: { case_id: string }) => c.case_id === "CX-1003");
    expect(row.stage).toBe("closure_proposed");
    expect(row.owner.role).toBe("responsible_physician");
    // Seeded three days into a 48-hour stage deadline, so it is late, not merely due.
    expect(row.flags).toEqual(expect.arrayContaining(["late"]));
    expect(typeof row.hours_left_stage).toBe("number");
    expect(row.flags_renderable.length).toBeGreaterThan(0);
  });

  it("filters unowned server-side instead of in the client", async () => {
    const { body } = await get("/api/cases?role=coordination_staff&filter=unowned");
    expect(body.cases.map((c: { case_id: string }) => c.case_id)).toEqual(["CX-1002"]);
    expect(body.cases[0].owner).toBeNull();
  });

  it("fails with the error envelope for a bad role or filter", async () => {
    const badRole = await get("/api/cases");
    expect(badRole.status).toBe(400);
    expect(badRole.body.error.code).toBe("validation_failed");

    const badFilter = await get("/api/cases?role=navigator&filter=urgent");
    expect(badFilter.status).toBe(400);
    expect(badFilter.body.error.code).toBe("validation_failed");
  });
});

describe("GET /api/cases/:case_id", () => {
  it("returns the full case view with engine-computed available_actions", async () => {
    const { status, body } = await get("/api/cases/CX-1003?role=responsible_physician");
    expect(status).toBe(200);

    expect(body.case.stage).toBe("closure_proposed");
    // The engine proposed closure with this outcome; the physician's act is what is missing.
    expect(body.case.final_outcome).toBe("returned_to_routine_screening");
    expect(body.case.outcomes).toHaveLength(3);
    expect(body.case.stage_due_label).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/);

    expect(body.stages.at(-1)).toMatchObject({ key: "closed", state: "ahead" });
    expect(body.stages.find((s: { key: string }) => s.key === "closure_proposed").state).toBe(
      "current",
    );

    // The seeded history walks every stage up to the proposal (11 events since the
    // template added the referral and procedure stages; it was 4).
    expect(body.timeline).toHaveLength(11);
    expect(body.documents).toHaveLength(1);
    expect(body.tasks[0].kind).toBe("confirm_closure");
    // TICKET-15: a reopen proposal asks for no outcome, so proposed_outcome is null.
    expect(body.verification).toEqual({ status: "ready", proposal: "reopen", proposed_outcome: null });
    expect(body.available_actions).toContain("confirm_closure");
    expect(body.available_actions).toContain("reject_proposal");
  });

  it("gives the same case different actions to a coordinator", async () => {
    const { body } = await get("/api/cases/CX-1003?role=coordination_staff");
    expect(body.available_actions).not.toContain("confirm_closure");
    expect(body.available_actions).toContain("log_outreach");
  });

  it("accepts the actor header for reads and refuses a system role", async () => {
    const ok = await get("/api/cases/CX-1003", { "X-Nexyra-Actor": physicianHeader });
    expect(ok.status).toBe(200);
    expect(ok.body.available_actions).toContain("confirm_closure");

    const system = await get("/api/cases/CX-1003", {
      "X-Nexyra-Actor": JSON.stringify({ actor_id: "act_system", role: "system", display_name: "system" }),
    });
    expect(system.status).toBe(403);
    expect(system.body.error.code).toBe("role_not_permitted");
  });

  it("answers an unknown reference with not_found", async () => {
    const { status, body } = await get("/api/cases/CX-9999?role=responsible_physician");
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });
});
