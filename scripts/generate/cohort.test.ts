import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClock } from "../../server/clock.js";
import { closeDb, openDatabase, type Db } from "../../server/db.js";
import { rebuildCase } from "../../server/events.js";
import { seed } from "../../server/seed.js";
import { funnel, generateCohort } from "./generate.js";
import { ingestCohort } from "./ingest.js";
import { readAssumptions } from "./params.js";

let dir = "";
const dbs: Db[] = [];

async function freshDb(name: string): Promise<Db> {
  const db = await openDatabase(join(dir, `${name}.sqlite`));
  dbs.push(db);
  await seed(db);
  return db;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-cohort-"));
});

afterAll(async () => {
  for (const db of dbs) db.close();
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

// Everything that identifies the data, without the ids and wall-clock stamps the engine
// generates on each write (event ids are random, recorded_at and updated_at are real time).
async function snapshot(db: Db) {
  const cases = await db
    .prepare(
      `SELECT id, patient_name, patient_age, patient_language, owner_actor_id, stage, status,
              final_outcome, stage_entered_at, created_at
         FROM cases WHERE id LIKE 'SY-%' ORDER BY id`,
    )
    .all();
  const events = await db
    .prepare(
      `SELECT case_id, type, actor_id, actor_role, occurred_at, payload
         FROM events WHERE case_id LIKE 'SY-%' ORDER BY case_id, rowid`,
    )
    .all();
  const documents = await db
    .prepare("SELECT id, case_id, kind, title, text FROM documents WHERE case_id LIKE 'SY-%' ORDER BY id")
    .all();
  return { cases, events, documents };
}

describe("synthetic cohort generator", () => {
  it("gives identical FHIR output for the same seed, and different output for another seed", () => {
    const a = generateCohort({ size: 150 });
    const b = generateCohort({ size: 150 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const other = generateCohort({ size: 150, overrides: { random_seed: 7 } });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(a));
  });

  it("writes only fictional, synthetic-tagged FHIR resources", () => {
    const cohort = generateCohort({ size: 100 });
    const types = new Set<string>();
    for (const c of cohort) {
      for (const { resource } of c.bundle.entry) {
        types.add(resource.resourceType);
        expect(resource.meta.tag[0]?.code).toBe("SYNTHETIC");
        if (resource.resourceType === "Patient") {
          expect(resource.name[0]?.text).toMatch(/^Test Patient \d{4}$/);
          expect(resource.identifier[0]?.value).toMatch(/^SYN-\d{4}$/);
        }
      }
      expect(c.caseId).toMatch(/^SY-\d{4}$/);
    }
    for (const type of ["Patient", "Observation", "ServiceRequest", "Appointment", "Procedure", "DiagnosticReport"]) {
      expect(types.has(type), type).toBe(true);
    }
  });

  it("has a source on every parameter", () => {
    const { parameters, references } = readAssumptions();
    for (const row of [...parameters, ...references]) {
      expect(row.source.length, row.name).toBeGreaterThan(5);
    }
    const guessed = parameters.filter((p) => p.source.startsWith("team guess"));
    expect(guessed.length).toBeGreaterThan(0);
  });

  it("moves the funnel the expected way when one drop-off parameter changes", () => {
    const base = funnel(generateCohort({ size: 1000 }));
    const noShows = funnel(generateCohort({ size: 1000, overrides: { dropoff_booked_no_show: 0.6 } }));
    expect(noShows.performed).toBeLessThan(base.performed);
    // Nothing upstream of the changed stage moves.
    expect(noShows.booked).toBe(base.booked);

    const lessLoss = funnel(generateCohort({ size: 1000, overrides: { dropoff_result_to_notified: 0.02 } }));
    expect(lessLoss.notified).toBeGreaterThan(base.notified);
    expect(lessLoss.performed).toBeGreaterThan(base.performed);

    const all = funnel(generateCohort({ size: 300, overrides: { dropoff_result_to_notified: 1 } }));
    expect(all.notified).toBe(0);
    expect(all.performed).toBe(0);
  });

  it("is close to the 30.5% anchor for colonoscopies performed under the default inputs", () => {
    const f = funnel(generateCohort());
    const share = f.performed / f.fit_positive;
    // An input calibration check, not a result: the drop-offs were tuned to land near it.
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.36);
  });
});

describe("cohort ingest through the engine", () => {
  it("loads the same data twice, survives rebuildCase, and leaves the demo cases and clock alone", async () => {
    const cohort = generateCohort({ size: 80 });

    const first = await freshDb("first");
    const clockBefore = await getClock(first);
    const demoBefore = await first
      .prepare("SELECT * FROM cases WHERE id LIKE 'CX-%' ORDER BY id")
      .all();
    const demoEventsBefore = await first
      .prepare("SELECT count(*) AS n FROM events WHERE case_id LIKE 'CX-%'")
      .get<{ n: number }>();

    const result = await ingestCohort(first, cohort);
    expect(result.created).toBe(80);
    expect(result.events).toBeGreaterThan(80);

    const second = await freshDb("second");
    await ingestCohort(second, cohort);
    expect(await snapshot(second)).toEqual(await snapshot(first));

    // Demo cases and the clock are exactly as the seed left them.
    expect(await first.prepare("SELECT * FROM cases WHERE id LIKE 'CX-%' ORDER BY id").all()).toEqual(demoBefore);
    expect(
      (await first.prepare("SELECT count(*) AS n FROM events WHERE case_id LIKE 'CX-%'").get<{ n: number }>())?.n,
    ).toBe(demoEventsBefore?.n);
    expect(await getClock(first)).toEqual(clockBefore);

    // Running it again adds nothing.
    const again = await ingestCohort(first, cohort);
    expect(again).toEqual({ created: 0, skipped: 80, events: 0 });

    // Every case rebuilds from its events, and the rebuild equals the stored row.
    const rows = await first
      .prepare(
        `SELECT id, stage, status, owner_actor_id, final_outcome, stage_entered_at, provider_id
           FROM cases WHERE id LIKE 'SY-%' ORDER BY id`,
      )
      .all<{
        id: string;
        stage: string;
        status: string;
        owner_actor_id: string | null;
        final_outcome: string | null;
        stage_entered_at: string | null;
        provider_id: string | null;
      }>();
    expect(rows).toHaveLength(80);
    for (const row of rows) {
      const state = await rebuildCase(first, row.id);
      expect(state, row.id).toEqual({
        stage: row.stage,
        status: row.status,
        owner_actor_id: row.owner_actor_id,
        final_outcome: row.final_outcome,
        stage_entered_at: row.stage_entered_at,
        // TICKET-08 folds the provider into the rebuilt state as well.
        provider_id: row.provider_id,
      });
    }

    // The stored stages agree with how far each case planned to get.
    expect(rows.some((r) => r.status === "closed")).toBe(true);
  }, 60_000);
});
