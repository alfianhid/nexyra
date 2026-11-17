import { rmSync } from "node:fs";
import { databaseFile } from "./db";
import { seed } from "./seed";

// `npm run demo:reset`: delete the database file, then rebuild it from the seed.
// TICKET-17 requires the same result every time and a runtime under a minute; both
// hold because the seed is deterministic and the file is small.

const file = databaseFile();

for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${file}${suffix}`, { force: true });
}

const result = seed();
console.log(`reset ${file}`);
console.log(
  `actors=${result.actors} cases=${result.cases} events=${result.events} clock=day 0`,
);
