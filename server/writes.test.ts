import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TICKET-05 notes: "a test calls each guarded endpoint directly to prove the UI is not
// the only defence." These are HTTP calls, not engine unit calls.

let server: Server | undefined;
let base = "";
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-writes-"));
  process.env.DATABASE_FILE = join(dir, "writes.sqlite");

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

function actor(id: string, role: string, name: string): Record<string, string> {
  return { "X-Nexyra-Actor": JSON.stringify({ actor_id: id, role, display_name: name }) };
}

const COORDINATOR = actor("act_001", "coordination_staff", "R. Haddad");
const NAVIGATOR = actor("act_002", "navigator", "Nur H.");
const PHYSICIAN = actor("act_003", "responsible_physician", "Dr. Fulan");
const MANAGER = actor("act_004", "program_manager", "A. Al Suwaidi");
const SYSTEM = actor("act_system", "system", "system");

async function request(
  method: "GET" | "POST",
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  // Test helper: assertions read the fields they care about.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await response.json()) as any;
  return { status: response.status, body };
}

// A closure-ready case with no recorded outcome, so the tests can exercise the two
// conditions the seeded cases already satisfy. Tests own the temporary database.
async function insertClosureFixture(): Promise<string> {
  const { getDb } = await import("./db");
  const db = getDb();
  const caseId = "CX-FIXTURE";
  const at = "2026-11-17T09:00:00+07:00";

  db.prepare(
    `INSERT OR REPLACE INTO cases (
       id, patient_name, patient_age, patient_language, pathway_id,
       owner_actor_id, stage, status, final_outcome, stage_entered_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    caseId, "T. Fixture", 60, "en", "fit-colonoscopy", "act_003",
    "closure_proposed", "open", null, at, at, at,
  );
  db.prepare(
    "INSERT OR REPLACE INTO documents (id, case_id, kind, title, text) VALUES (?, ?, ?, ?, ?)",
  ).run("d_fixture", caseId, "colonoscopy", "Colonoscopy report", "Complete examination.");

  return caseId;
}

describe("POST /api/cases/:id/closure/confirm", () => {
  it("rejects a request with no actor header at all", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1003/closure/confirm");
    expect(status).toBe(403);
    expect(body.error.code).toBe("role_not_permitted");
  });

  it("rejects the system role over HTTP", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1003/closure/confirm", {
      headers: SYSTEM,
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("role_not_permitted");
  });

  it("refuses coordination staff even when every other condition holds", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1003/closure/confirm", {
      headers: COORDINATOR,
      body: { final_outcome: "returned_to_routine_screening" },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("role_not_permitted");
  });

  it("refuses a navigator", async () => {
    const { status } = await request("POST", "/api/cases/CX-1003/closure/confirm", {
      headers: NAVIGATOR,
    });
    expect(status).toBe(403);
  });

  it("refuses a program manager", async () => {
    const { status } = await request("POST", "/api/cases/CX-1003/closure/confirm", {
      headers: MANAGER,
    });
    expect(status).toBe(403);
  });

  it("returns 409 with per-condition details when the outcome was never recorded", async () => {
    const caseId = await insertClosureFixture();
    const { status, body } = await request("POST", `/api/cases/${caseId}/closure/confirm`, {
      headers: PHYSICIAN,
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe("closure_conditions_unmet");
    expect(body.error.details).toEqual({
      final_outcome: false,
      evidence_attached: true,
      physician_confirmation: true,
    });
  });

  it("rejects an outcome outside the closed vocabulary", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1003/closure/confirm", {
      headers: PHYSICIAN,
      body: { final_outcome: "discharged_home" },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
  });

  it("records the outcome the closure screen chose", async () => {
    const caseId = await insertClosureFixture();
    const { status, body } = await request("POST", `/api/cases/${caseId}/closure/confirm`, {
      headers: PHYSICIAN,
      body: { final_outcome: "surveillance_scheduled" },
    });
    expect(status).toBe(200);
    expect(body.case.final_outcome).toBe("surveillance_scheduled");
    expect(body.case.stage).toBe("closed");
  });

  it("closes the seeded case with no body, using the outcome already proposed", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1003/closure/confirm", {
      headers: PHYSICIAN,
    });
    expect(status).toBe(200);

    expect(body.recorded).toMatch(/^e_/);
    expect(body.case.stage).toBe("closed");
    expect(body.case.status).toBe("closed");
    expect(body.case.final_outcome).toBe("returned_to_routine_screening");
    expect(body.available_actions).toContain("reopen_case");

    const last = body.timeline.at(-1);
    expect(last.event_id).toBe(body.recorded);
    expect(last.type).toBe("closure_confirmed");
    expect(last.actor.role).toBe("responsible_physician");
  });
});

describe("POST /api/cases/:id/reopen", () => {
  it("refuses a coordinator", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1003/reopen", {
      headers: COORDINATOR,
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("role_not_permitted");
  });

  it("reopens a closed case and never leaves it unowned", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1003/reopen", {
      headers: PHYSICIAN,
    });
    expect(status).toBe(200);
    expect(body.recorded).toMatch(/^e_/);
    expect(body.case.stage).toBe("result_received");
    expect(body.case.status).toBe("open");
    expect(body.case.owner).not.toBeNull();
    expect(body.case.owner.actor_id).toBe("act_003");
    expect(body.timeline.at(-1).type).toBe("reopened");
  });

  it("rejects reopening a case that is not closed", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1003/reopen", {
      headers: PHYSICIAN,
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe("invalid_transition");
  });
});

describe("POST /api/cases/:id/events", () => {
  it("rejects a missing header before it looks at the body", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1001/events", {
      body: { type: "colonoscopy_booked" },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("role_not_permitted");
  });

  it("rejects an unknown event type", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1001/events", {
      headers: COORDINATOR,
      body: { type: "teleported_patient" },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
  });

  it("rejects a stage-skipping transition with 409 invalid_transition", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1001/events", {
      headers: COORDINATOR,
      body: { type: "pathology_received" },
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe("invalid_transition");
  });

  it("refuses the program manager", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1001/events", {
      headers: MANAGER,
      body: { type: "colonoscopy_booked" },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("role_not_permitted");
  });

  it("advances a case one legal stage and records the event", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1001/events", {
      headers: COORDINATOR,
      body: { type: "colonoscopy_booked", payload: { channel: "patient_page" } },
    });
    expect(status).toBe(200);
    expect(body.case.stage).toBe("colonoscopy_booked");
    expect(body.stages.find((s: { key: string }) => s.key === "colonoscopy_booked").state).toBe(
      "current",
    );

    const last = body.timeline.at(-1);
    expect(last.event_id).toBe(body.recorded);
    expect(last.type).toBe("colonoscopy_booked");
    expect(last.payload.channel).toBe("patient_page");
  });

  it("refuses to confirm closure through the generic events endpoint for a coordinator", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1003/events", {
      headers: COORDINATOR,
      body: { type: "closure_confirmed" },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("role_not_permitted");
  });
});

describe("POST /api/tasks/:id/complete", () => {
  it("completes an outreach task with a closed-set delay reason", async () => {
    const { status, body } = await request("POST", "/api/tasks/t_1001_outreach/complete", {
      headers: NAVIGATOR,
      body: { outcome: "no_answer", delay_reason: "fear", note: "Prefers a family call" },
    });
    expect(status).toBe(200);
    expect(body.recorded).toMatch(/^e_/);

    const task = body.tasks.find((t: { task_id: string }) => t.task_id === "t_1001_outreach");
    expect(task.status).toBe("completed");

    const last = body.timeline.at(-1);
    expect(last.type).toBe("task_completed");
    expect(last.payload.delay_reason).toBe("fear");
    expect(last.payload.outcome).toBe("no_answer");
  });

  it("rejects a delay reason outside fear, transport, cost, language, other", async () => {
    const { status, body } = await request("POST", "/api/tasks/t_1002_owner/complete", {
      headers: COORDINATOR,
      body: { outcome: "connected", delay_reason: "traffic" },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
  });

  it("rejects completing the same task twice", async () => {
    const { status, body } = await request("POST", "/api/tasks/t_1001_outreach/complete", {
      headers: NAVIGATOR,
      body: { outcome: "connected" },
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe("invalid_transition");
  });

  it("refuses a physician on coordination outreach work", async () => {
    const { status, body } = await request("POST", "/api/tasks/t_1002_owner/complete", {
      headers: PHYSICIAN,
      body: { outcome: "connected" },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("role_not_permitted");
  });

  it("answers an unknown task with not_found", async () => {
    const { status, body } = await request("POST", "/api/tasks/t_missing/complete", {
      headers: COORDINATOR,
      body: { outcome: "connected" },
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });
});

describe("POST /api/cases/:id/outreach", () => {
  it("appends an attempt to the ladder without moving the stage", async () => {
    const before = await request("GET", "/api/cases/CX-1001?role=coordination_staff");
    const stageBefore = before.body.case.stage;
    const attemptsBefore = before.body.outreach_attempts.length;

    const { status, body } = await request("POST", "/api/cases/CX-1001/outreach", {
      headers: NAVIGATOR,
      body: { outcome: "no_answer", channel: "sms", delay_reason: "fear", minutes: 2 },
    });
    expect(status).toBe(200);
    expect(body.recorded).toMatch(/^e_/);
    expect(body.case.stage).toBe(stageBefore);
    expect(body.outreach_attempts).toHaveLength(attemptsBefore + 1);

    const last = body.outreach_attempts.at(-1);
    expect(last.n).toBe(attemptsBefore + 1);
    expect(last.channel).toBe("sms");
    expect(last.result).toBe("no_answer");
    expect(last.minutes).toBe(2);

    const event = body.timeline.at(-1);
    expect(event.event_id).toBe(body.recorded);
    expect(event.type).toBe("outreach_attempted");
    expect(event.payload.delay_reason).toBe("fear");
  });

  it("defaults the channel to a call", async () => {
    const { status, body } = await request("POST", "/api/cases/CX-1002/outreach", {
      headers: COORDINATOR,
      body: { outcome: "left_voicemail" },
    });
    expect(status).toBe(200);
    expect(body.outreach_attempts.at(-1).channel).toBe("call");
  });

  it("refuses a physician and a program manager", async () => {
    for (const headers of [PHYSICIAN, MANAGER]) {
      const { status, body } = await request("POST", "/api/cases/CX-1001/outreach", {
        headers,
        body: { outcome: "connected" },
      });
      expect(status).toBe(403);
      expect(body.error.code).toBe("role_not_permitted");
    }
  });

  it("rejects a missing outcome, an unknown channel and an unknown delay reason", async () => {
    const noOutcome = await request("POST", "/api/cases/CX-1001/outreach", {
      headers: NAVIGATOR,
      body: { channel: "call" },
    });
    expect(noOutcome.status).toBe(400);

    const badChannel = await request("POST", "/api/cases/CX-1001/outreach", {
      headers: NAVIGATOR,
      body: { outcome: "connected", channel: "carrier_pigeon" },
    });
    expect(badChannel.status).toBe(400);

    const badReason = await request("POST", "/api/cases/CX-1001/outreach", {
      headers: NAVIGATOR,
      body: { outcome: "connected", delay_reason: "traffic" },
    });
    expect(badReason.status).toBe(400);
  });
});

describe("GET /api/cases/:id/verification", () => {
  it("returns the cached extraction with citations and offsets", async () => {
    const { status, body } = await request("GET", "/api/cases/CX-1003/verification");
    expect(status).toBe(200);
    expect(body.extraction.proposal).toBe("reopen");
    expect(body.extraction.model).toBe("deepseek/deepseek-v4.1-flash-1017");
    expect(body.extraction.fields).toHaveLength(3);

    for (const field of body.extraction.fields) {
      expect(field).toHaveProperty("source");
      expect(field).toHaveProperty("read_at");
      expect(field.quote_offset).toHaveLength(2);
    }

    const prep = body.extraction.fields.find(
      (f: { key: string }) => f.key === "adequate_prep",
    );
    expect(body.report.text.slice(...prep.quote_offset)).toBe(prep.quote);
  });

  it("answers needs_human_reading when no extraction exists", async () => {
    const { status, body } = await request("GET", "/api/cases/CX-1001/verification");
    expect(status).toBe(200);
    expect(body.extraction.proposal).toBe("needs_human_reading");
    expect(body.extraction.fields).toEqual([]);
  });
});

describe("the audit trail", () => {
  it("keeps every write as an event and refuses to rewrite one", async () => {
    const { getDb } = await import("./db");
    const db = getDb();

    const count = (db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n;
    expect(count).toBeGreaterThan(7);

    expect(() =>
      db.prepare("UPDATE events SET type = 'tampered' WHERE id = (SELECT id FROM events LIMIT 1)").run(),
    ).toThrow(/append-only/);
  });
});
