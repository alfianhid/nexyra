import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractReport, llmConfigFromEnv, PROMPT_VERSION } from "../server/verify/index.js";
import { compare, renderResults, type EvalResult, type Label } from "./evalCompare.js";

// npm run eval
// Runs closure verification over every data/test-reports/r*.txt, with no cache and one
// report at a time, compares with labels.json and writes docs/evaluation-results.md.
// Needs LLM_BASE_URL and LLM_API_KEY (and optionally NEXYRA_MODEL) in .env.

const dir = "data/test-reports";
const labelFile = JSON.parse(readFileSync(join(dir, "labels.json"), "utf8")) as {
  checked_by: string | null;
  checked_at: string | null;
  reports: Label[];
};

const llm = llmConfigFromEnv();
const results: Record<string, EvalResult> = {};
const files = readdirSync(dir).filter((f) => /^r\d+\.txt$/.test(f)).sort();

for (const file of files) {
  const id = file.replace(".txt", "");
  const text = readFileSync(join(dir, file), "utf8");
  process.stderr.write(`reading ${id}\n`);
  results[id] = await extractReport(text, { llm, source: file });
}

const cmp = compare(labelFile.reports, results);
if (cmp.read === 0) {
  console.error("No model configured (or none reachable): nothing was evaluated. Set LLM_BASE_URL and LLM_API_KEY in .env.");
  console.error("docs/evaluation-results.md was not written.");
  process.exit(1);
}

const text = renderResults(cmp, {
  date: new Date().toISOString().slice(0, 10),
  model: llm?.model ?? "unknown",
  promptVersion: PROMPT_VERSION,
  checkedBy: labelFile.checked_by,
  checkedAt: labelFile.checked_at,
  promptChangesAfterResults: 0,
});
console.log(text);
writeFileSync("docs/evaluation-results.md", text);
console.error("Wrote docs/evaluation-results.md");
