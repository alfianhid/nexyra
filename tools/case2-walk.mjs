// Walks demo case 2 (CX-1002) through the UI, times it, and saves 1280px screenshots to
// docs/shots/case2-*.png. Needs `npm run demo:reset`, the API on 3001 and `npm run dev` on
// 5173, and Microsoft Edge (playwright-core drives the installed browser; no download).
// Usage: node tools/case2-walk.mjs [repoRoot] [paceMs] [--no-shots]
//   paceMs: pause after each visible action, to time the walk at a presenter's speed.
// It writes to the demo database (move, consultation, answer, one unmatched FHIR resource),
// so reset again before the next run or the recording.
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : ".");
const pace = Number(process.argv[3] ?? 0); // pause after each visible action, to mimic a presenter
const require = createRequire(join(root, "package.json"));
const { chromium } = require("playwright-core");

const BASE = "http://localhost:5173";
const shots = join(root, "docs", "shots");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const marks = [];
const t0 = Date.now();
const mark = (label) => marks.push([label, ((Date.now() - t0) / 1000).toFixed(1)]);
const pause = () => (pace ? page.waitForTimeout(pace) : Promise.resolve());
const shot = async (name, fullPage = false) => {
  if (process.argv.includes("--no-shots")) return;
  await page.screenshot({ path: join(shots, name), fullPage });
};

// 1. Register -> unowned list
await page.goto(`${BASE}/cases`);
await page.getByRole("button", { name: "Unowned" }).waitFor();
await pause();
await page.getByRole("button", { name: "Unowned" }).click();
await page.getByRole("link", { name: "CX-1002" }).waitFor();
mark("unowned list shown");
await shot("case2-1-unowned-list.png");
await pause();

// 2. Open CX-1002
await page.getByRole("link", { name: "CX-1002" }).click();
await page.getByText("No owner since").waitFor();
mark("case open, unowned");
await shot("case2-2-case-unowned.png");
await pause();

// 3. Coordinator records the move to clinic B
await page.locator("#move-provider").selectOption("prov_clinic_b");
await pause();
await page.getByRole("button", { name: "Record move" }).click();
await page.getByText("Assign-owner task with S. Al Ali").waitFor();
mark("move recorded");
await shot("case2-3-moved.png");
await pause();

// 4. Physician asks hospital B
await page.locator("#role").selectOption("physician");
await page.locator("#consult-question").waitFor();
await pause();
await page.locator("#consult-question").pressSequentially(
  "Missing FIT date and history now attached. Can you accept the referral?",
  { delay: pace ? 25 : 0 },
);
await pause();
await page.getByRole("button", { name: "Send consultation request" }).click();
await page.getByRole("heading", { name: /Answer as Dr\. Fulana/ }).waitFor();
mark("consultation sent");
await shot("case2-4-consultation.png");
await pause();

// 5. A day passes on the demo clock
await page.getByRole("button", { name: "+1 day" }).click();
await page.locator(".clock b", { hasText: "18 Nov" }).waitFor();
mark("clock +1 day");
await pause();

// 6. Dr. Fulana accepts, S. Al Ali takes the case
await page.locator("#answer-owner").selectOption("act_005");
await page.locator("#answer-note").fill("History received. Referral accepted; booking the colonoscopy.");
await pause();
await page.getByRole("button", { name: "Record answer as Dr. Fulana" }).click();
await page.getByText("Owned by S. Al Ali").waitFor();
mark("answered, owned");
await shot("case2-5-owned.png");
await pause();

// 7. The case has left the unowned list
await page.goto(`${BASE}/cases?filter=unowned`);
await page.getByText("Every open case has an owner").waitFor();
mark("unowned list empty");
await shot("case2-6-unowned-empty.png");

const total = ((Date.now() - t0) / 1000).toFixed(1);

// Full-page record of the owned case for the deck (outside the timed walk).
if (!process.argv.includes("--no-shots")) {
  await page.goto(`${BASE}/cases/CX-1002`);
  await page.getByText("Owned by S. Al Ali").waitFor();
  await page.screenshot({ path: join(shots, "case2-5-owned-full.png"), fullPage: true });

  // The unstitched queue with one resource that matches no case (sent through the API).
  const ingest = await page.request.post(`${BASE}/api/ingest/fhir`, {
    headers: {
      "X-Nexyra-Actor": JSON.stringify({ actor_id: "act_001", role: "coordination_staff", display_name: "R. Haddad" }),
    },
    data: {
      resourceType: "Procedure",
      id: "proc-hb-0918",
      status: "completed",
      meta: { source: "urn:nexyra:provider:prov_hospital_b" },
      subject: { identifier: { value: "NX-P-2291" } },
      basedOn: [{ reference: "ServiceRequest/REF-9020-1" }],
      code: { text: "Colonoscopy" },
      performedDateTime: "2026-11-18T09:00:00+07:00",
    },
  });
  console.log("ingest", ingest.status(), JSON.stringify((await ingest.json()).counts));
  await page.goto(`${BASE}/ingest/unstitched`);
  await page.getByText("proc-hb-0918").waitFor();
  await page.screenshot({ path: join(shots, "case2-7-unstitched.png") });
}

console.log(JSON.stringify({ pace, total_seconds: Number(total), marks, errors }, null, 2));
await browser.close();
