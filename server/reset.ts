import { closeDb, databaseLabel, getDb, resetDatabase } from "./db.js";
import { seed } from "./seed.js";

// `npm run demo:reset`: drop every table, recreate the schema, then rebuild from the seed.
// TICKET-17 requires the same result every time and a runtime under a minute; both
// hold because the seed is deterministic and small. The same command resets a local
// file and the deployed Turso database (set TURSO_DATABASE_URL to target the latter).

const db = await getDb();
await resetDatabase(db);
const result = await seed(db);
console.log(`reset ${databaseLabel()}`);
console.log(
  `actors=${result.actors} cases=${result.cases} events=${result.events} clock=day 0`,
);
await closeDb();
