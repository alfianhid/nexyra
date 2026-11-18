import { DEMO_STEPS, httpSend, runStep, type Memo } from "./demo/steps.js";

// `npm run demo:step -- <id> [<id> ...]` sends demo steps (scripts/demo/steps.ts) to a
// running API, for the moments that stand for another system (FHIR from the endoscopy
// unit or the laboratory) or that have no button yet. `npm run demo:step -- list` prints
// them. DEMO_API_URL picks the server (default http://localhost:3001; the hosted demo is
// https://<deployment>). The order of the script in docs/demo-script.md still applies.

const base = (process.env.DEMO_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const ids = process.argv.slice(2);

if (ids.length === 0 || ids[0] === "list") {
  for (const step of DEMO_STEPS) console.log(`${step.id.padEnd(5)} ${step.case.padEnd(10)} ${step.title}`);
  process.exit(0);
}

const send = httpSend(base);
const memo: Memo = {};
let failed = false;

for (const id of ids) {
  const step = DEMO_STEPS.find((s) => s.id === id);
  if (!step) {
    console.error(`No demo step "${id}". Run \`npm run demo:step -- list\`.`);
    process.exit(1);
  }
  // Step 2.5 answers the consultation step 2.3 opened; run alone, it looks the id up.
  if (step.id === "2.5" && memo.consultation_id === undefined) {
    const detail = (await send("GET", "/api/cases/CX-1002?role=program_manager", undefined, undefined)).body as {
      consultations?: { consultation_id: string; status: string }[];
    };
    memo.consultation_id = detail.consultations?.find((k) => k.status === "open")?.consultation_id;
  }
  const result = await runStep(step, memo, send);
  const ok = result.status >= 200 && result.status < 300;
  failed ||= !ok;
  const body = result.body as Record<string, unknown>;
  const summary =
    (body?.case as { stage?: string } | undefined)?.stage ??
    (body?.clock as { label?: string } | undefined)?.label ??
    JSON.stringify(body).slice(0, 160);
  console.log(`${ok ? "ok  " : "FAIL"} ${step.id} ${result.status} ${step.title}\n     ${summary}`);
}

process.exit(failed ? 1 : 0);
