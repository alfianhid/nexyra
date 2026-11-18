import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { answerJson, completion, fakeModel, type FakeModel } from "./fakeModel.js";

// POST /api/cases/{case_id}/verification over HTTP, with the model replaced by a fake.
// The fake answers only the LLM host; the test's own requests to the API still go out
// through the real fetch.

const LLM_BASE = "https://llm.test/v1";

let server: Server | undefined;
let base = "";
let dir = "";
let model: FakeModel;
const realFetch = globalThis.fetch;

const PHYSICIAN = {
  "X-Nexyra-Actor": JSON.stringify({
    actor_id: "act_003",
    role: "responsible_physician",
    display_name: "Dr. Fulan",
  }),
};

const CLOSABLE =
  "Bowel preparation was excellent. The caecum was reached and photographed. " +
  "No polyps, masses or other abnormality were seen. No biopsies were taken. " +
  "Return to routine screening.";

const CLOSABLE_ANSWER = answerJson({
  complete_exam: ["yes", "The caecum was reached and photographed."],
  adequate_prep: ["yes", "Bowel preparation was excellent."],
  tissue_taken: ["no", "No biopsies were taken."],
  pathology_available: ["unknown", null],
  outcome_category: ["normal", "No polyps, masses or other abnormality were seen."],
  next_step: ["stated", "Return to routine screening."],
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-verify-"));
  process.env.DATABASE_FILE = join(dir, "verify.sqlite");

  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith(LLM_BASE) ? model(url, init ?? {}) : realFetch(input, init);
  });

  const { getDb } = await import("../db.js");
  const { seed } = await import("../seed.js");
  const { app } = await import("../index.js");
  await getDb();
  await seed();

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server?.address();
  if (typeof address === "object" && address !== null) base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closeDb } = await import("../db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

beforeEach(() => {
  model = fakeModel(() => completion(CLOSABLE_ANSWER));
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
});

function withKey(): void {
  process.env.LLM_BASE_URL = LLM_BASE;
  process.env.LLM_API_KEY = "test-key-not-real";
  process.env.NEXYRA_MODEL = "test/model-1";
}

async function call(method: "GET" | "POST", path: string, headers: Record<string, string> = {}) {
  const response = await realFetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, body: (await response.json()) as any };
}

// A case one step before closure, with a clean report attached and no reading yet.
async function insertCase(caseId: string, text: string): Promise<void> {
  const { getDb } = await import("../db.js");
  const db = await getDb();
  const at = "2026-11-17T09:00:00+07:00";
  await db
    .prepare(
      `INSERT INTO cases (
         id, patient_name, patient_age, patient_language, pathway_id,
         owner_actor_id, stage, status, final_outcome, stage_entered_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(caseId, "T. Verify", 61, "en", "fit-colonoscopy", "act_003", "pathology_received", "open", null, at, at, at);
  await db
    .prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES (?, ?, ?, ?, ?)")
    .run(`d_${caseId}`, caseId, "colonoscopy", "Colonoscopy report", text);
}

async function snapshot(caseId: string) {
  const { getDb } = await import("../db.js");
  const db = await getDb();
  const row = await db
    .prepare("SELECT stage, status, final_outcome, owner_actor_id FROM cases WHERE id = ?")
    .get(caseId);
  const events = await db
    .prepare("SELECT type, actor_role, payload FROM events WHERE case_id = ? ORDER BY rowid")
    .all<{ type: string; actor_role: string; payload: string }>(caseId);
  const extractions = await db
    .prepare("SELECT count(*) AS n FROM extractions WHERE case_id = ?")
    .get<{ n: number }>(caseId);
  return { row, events, extractions: extractions?.n ?? 0 };
}

describe("POST /api/cases/:id/verification", () => {
  it("requires an actor", async () => {
    const { status, body } = await call("POST", "/api/cases/CX-1003/verification");
    expect(status).toBe(403);
    expect(body.error.code).toBe("role_not_permitted");
  });

  it("answers 404 for an unknown case", async () => {
    const { status } = await call("POST", "/api/cases/CX-NOPE/verification", PHYSICIAN);
    expect(status).toBe(404);
  });

  it("returns the seeded cached reading without a key or a model call", async () => {
    const { status, body } = await call("POST", "/api/cases/CX-1003/verification", PHYSICIAN);
    expect(status).toBe(200);
    expect(body.extraction.proposal).toBe("reopen");
    expect(body.extraction.origin).toBe("cache");
    expect(model.calls).toHaveLength(0);
  });

  it("without a key and without a cache, answers needs_human_reading and stores nothing", async () => {
    await insertCase("CX-V-NOKEY", CLOSABLE + " (no key)");
    const before = await snapshot("CX-V-NOKEY");

    const { status, body } = await call("POST", "/api/cases/CX-V-NOKEY/verification", PHYSICIAN);
    expect(status).toBe(200);
    expect(body.extraction.proposal).toBe("needs_human_reading");
    expect(body.extraction.proposal).not.toBe("propose_closure");
    expect(body.extraction.fields).toEqual([]);
    expect(model.calls).toHaveLength(0);
    expect(await snapshot("CX-V-NOKEY")).toEqual(before);
  });

  it("extraction results cannot close a case, even when they propose closure", async () => {
    withKey();
    await insertCase("CX-V-CLOSE", CLOSABLE);
    const before = await snapshot("CX-V-CLOSE");

    const { status, body } = await call("POST", "/api/cases/CX-V-CLOSE/verification", PHYSICIAN);
    expect(status).toBe(200);
    expect(body.extraction.proposal).toBe("propose_closure");
    expect(body.extraction.proposed_outcome).toBe("returned_to_routine_screening");

    const after = await snapshot("CX-V-CLOSE");
    // The case row is exactly as it was: same stage, still open, no outcome recorded.
    expect(after.row).toEqual(before.row);
    expect(after.row).toMatchObject({ status: "open", stage: "pathology_received", final_outcome: null });
    // The only new event is the reading itself, written as the system.
    expect(after.events.map((e) => e.type)).toEqual(["extraction_completed"]);
    expect(after.events[0]?.actor_role).toBe("system");
    const payload = JSON.parse(after.events[0]?.payload ?? "{}");
    expect(payload).toMatchObject({ prompt_version: "extract-v1", model: "test/model-1", proposal: "propose_closure" });

    // The case view still offers no closure: closing stays the engine's rule (TICKET-05).
    const detail = await call("GET", "/api/cases/CX-V-CLOSE?role=responsible_physician");
    expect(detail.body.case.status).toBe("open");
    expect(detail.body.available_actions).not.toContain("confirm_closure");
  });

  it("re-running on the same report hits the cache: one model call, one event", async () => {
    withKey();
    await insertCase("CX-V-TWICE", CLOSABLE + " Twice.");

    const first = await call("POST", "/api/cases/CX-V-TWICE/verification", PHYSICIAN);
    const second = await call("POST", "/api/cases/CX-V-TWICE/verification", PHYSICIAN);

    expect(model.calls).toHaveLength(1);
    expect(first.body.extraction.origin).toBe("model");
    expect(second.body.extraction.origin).toBe("cache");
    expect(second.body.extraction.fields).toEqual(first.body.extraction.fields);

    const after = await snapshot("CX-V-TWICE");
    expect(after.extractions).toBe(1);
    expect(after.events.filter((e) => e.type === "extraction_completed")).toHaveLength(1);
  });

  it("GET returns the stored reading with offsets that land on the quote", async () => {
    withKey();
    await insertCase("CX-V-GET", CLOSABLE + " Read back.");
    await call("POST", "/api/cases/CX-V-GET/verification", PHYSICIAN);

    const { body } = await call("GET", "/api/cases/CX-V-GET/verification");
    expect(body.extraction.proposal).toBe("propose_closure");
    expect(body.extraction.model).toBe("test/model-1");
    expect(body.extraction.prompt_version).toBe("extract-v1");
    for (const field of body.extraction.fields.filter((f: { validated: boolean }) => f.validated)) {
      expect(body.report.text.slice(...field.quote_offset)).toBe(field.quote);
    }
  });

  it("an invented quote never reaches a closure proposal through the endpoint", async () => {
    withKey();
    model = fakeModel(() =>
      completion(
        CLOSABLE_ANSWER.replace("The caecum was reached and photographed.", "Caecal intubation confirmed."),
      ),
    );
    await insertCase("CX-V-INVENT", CLOSABLE + " Invented.");
    const { body } = await call("POST", "/api/cases/CX-V-INVENT/verification", PHYSICIAN);
    expect(body.extraction.proposal).toBe("needs_human_reading");
    const exam = body.extraction.fields.find((f: { key: string }) => f.key === "complete_exam");
    expect(exam).toMatchObject({ value: "unknown", validated: false, quote: null });
  });
});
