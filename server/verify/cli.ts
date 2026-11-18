import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { extractReport } from "./extract.js";

// npm run verify:file -- <path>
// Extracts one report text file and prints the result as JSON. No cache: every run calls
// the model when a key is configured, and answers needs_human_reading when not.

const path = process.argv[2];
if (!path) {
  console.error("usage: npm run verify:file -- <path-to-report.txt>");
  process.exit(2);
}

const file = resolve(path);
if (!existsSync(file)) {
  console.error(`No such file: ${file}`);
  process.exit(2);
}

// LLM_BASE_URL, LLM_API_KEY and NEXYRA_MODEL may live in .env (never committed).
if (existsSync(".env")) process.loadEnvFile(".env");

const result = await extractReport(readFileSync(file, "utf8"), { source: basename(file) });
console.log(JSON.stringify(result, null, 2));
