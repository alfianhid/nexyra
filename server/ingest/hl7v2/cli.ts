import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { closeDb, databaseLabel, getDb } from "../../db.js";
import { ingestHl7Text } from "./ingest.js";

// `npm run ingest:hl7 -- <file or folder> [--json]`: ingest HL7 v2 message files into the
// database the server uses (a local file, or Turso when TURSO_DATABASE_URL is set).
// A folder is read in file-name order. The writes are made as the system actor.

const args = process.argv.slice(2);
const json = args.includes("--json");
const target = args.find((a) => !a.startsWith("--"));

if (!target) {
  console.error("usage: npm run ingest:hl7 -- <file or folder> [--json]");
  process.exit(2);
}

function filesOf(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .filter((name) => [".hl7", ".txt", ".er7"].includes(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(path, name));
}

const db = await getDb();
const all: unknown[] = [];
try {
  for (const file of filesOf(target)) {
    const results = await ingestHl7Text(db, readFileSync(file, "utf8"));
    for (const result of results) {
      if (json) {
        all.push({ file, ...result });
        continue;
      }
      const detail =
        result.outcome === "queued_unstitched"
          ? `${result.reason_code}: ${result.reason}`
          : result.events.map((e) => `${e.type} -> ${e.stage} (${e.case_id})`).join(", ") ||
            (result.reason ? `${result.reason_code}: ${result.reason}` : result.duplicate ? "duplicate" : "");
      console.log(`${file}  ${result.message_type ?? "?"} ${result.control_id}  ${result.outcome}  ${detail}`);
    }
  }
  if (json) console.log(JSON.stringify(all, null, 2));
  else console.log(`ingested into ${databaseLabel()}`);
} finally {
  await closeDb();
}
