import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, databaseLabel, getDb } from "../../server/db.js";
import { funnel, generateCohort } from "./generate.js";
import { ingestCohort } from "./ingest.js";

// `npm run seed:cohort`: about 1,000 synthetic FIT-positive cases with full histories,
// added to the demo seed. Run `npm run demo:reset` first for a clean, repeatable result.
// Drop-off rates are inputs (data/generator-assumptions.json), never findings.

const started = Date.now();
const cohort = generateCohort();
const db = await getDb();
const result = await ingestCohort(db, cohort, {
  onProgress: (done, total) => {
    if (done % 200 === 0) console.log(`  ${done}/${total}`);
  },
});

const count = async (sql: string) => (await db.prepare(sql).get<{ n: number }>())?.n ?? 0;
const byStage = await db
  .prepare("SELECT stage, count(*) AS n FROM cases WHERE id LIKE 'SY-%' GROUP BY stage ORDER BY stage")
  .all<{ stage: string; n: number }>();

console.log(`seeded cohort into ${databaseLabel()}`);
console.log(
  `created=${result.created} skipped=${result.skipped} events=${result.events} ` +
    `cohort_cases=${await count("SELECT count(*) AS n FROM cases WHERE id LIKE 'SY-%'")} ` +
    `cohort_events=${await count("SELECT count(*) AS n FROM events WHERE case_id LIKE 'SY-%'")} ` +
    `closed=${await count("SELECT count(*) AS n FROM cases WHERE id LIKE 'SY-%' AND status = 'closed'")} ` +
    `unowned_open=${await count("SELECT count(*) AS n FROM cases WHERE id LIKE 'SY-%' AND status = 'open' AND owner_actor_id IS NULL")}`,
);
console.log(`by stage: ${byStage.map((r) => `${r.stage}=${r.n}`).join(" ")}`);
console.log(`funnel (planned): ${JSON.stringify(funnel(cohort))}`);
console.log(`took ${((Date.now() - started) / 1000).toFixed(1)}s`);

// `--examples` writes the first generated case as FHIR JSON for the docs.
if (process.argv.includes("--examples")) {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/fhir-examples");
  mkdirSync(dir, { recursive: true });
  const samples = cohort.filter((c) => c.reached.includes("confirmed")).slice(0, 2);
  for (const sample of samples) {
    writeFileSync(resolve(dir, `${sample.caseId}.json`), JSON.stringify(sample.bundle, null, 2) + "\n");
  }
}

await closeDb();
