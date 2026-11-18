// Walks the demo through the UI in Edge, the way docs/demo-script.md tells the presenter
// to, times it, and saves 1280x800 screenshots to docs/shots/.
//
//   node tools/demo-walk.mjs [repoRoot] [paceMs] [--video] [--no-shots]
//
// Default: the live script, all of it: case 3 (reopen, repeat colonoscopy, closure), case
// 2, case 1, the programme view. The inbound FHIR steps (3.6, 3.7, 3.9, 2.6) are sent with
// `npm run demo:step`, as on stage. --video: the video's path only (case 3 to the reopen,
// case 2, the next-deadline jump, the programme view), no inbound steps.
// paceMs: pause after each visible action, to time the walk at a presenter's speed.
//
// Needs `npm run demo:reset` right before, the API on 3001 and `npm run dev` on 5173, and
// Microsoft Edge (playwright-core drives the installed browser; no download). It writes to
// the demo database, so reset again before the next run or the recording.
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const root = resolve(positional[0] ?? ".");
const pace = Number(positional[1] ?? 0);
const video = args.includes("--video");
const noShots = args.includes("--no-shots");
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
const mark = (label) => marks.push([label, Number(((Date.now() - t0) / 1000).toFixed(1))]);
const pause = () => (pace ? page.waitForTimeout(pace) : Promise.resolve());
const typeDelay = pace ? 25 : 0;
const shot = async (name, options = {}) => {
  if (noShots) return;
  await page.screenshot({ path: join(shots, name), ...options });
};
const scrollTo = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
};

// Inbound messages from the endoscopy unit or the laboratory: a terminal on stage.
const inbound = (id) => {
  execSync(`npm run demo:step -- ${id}`, { cwd: root, stdio: "pipe" });
  mark(`inbound ${id}`);
};

async function actAs(role) {
  await page.locator("#role").selectOption(role);
  await page.waitForTimeout(300);
}

async function openCase(id) {
  await page.goto(`${BASE}/cases/${id}`);
  await page.getByRole("heading", { level: 1 }).filter({ hasText: id }).waitFor();
}

// The case page's "Record next step": choose the step by its label, then the extras.
async function recordStep(label, extra = {}) {
  const select = page.locator("#step-event");
  await scrollTo(select);
  const value = await select.locator("option", { hasText: label }).first().getAttribute("value");
  await select.selectOption(value);
  await pause();
  if (extra.owner) await page.locator("#step-owner").selectOption(extra.owner);
  if (extra.outcome) await page.locator("#step-outcome").selectOption(extra.outcome);
  if (extra.note) await page.locator("#step-note").fill(extra.note);
  if (extra.shot) {
    await scrollTo(page.getByRole("heading", { name: "Record next step" }));
    await shot(extra.shot);
  }
  await page.getByRole("button", { name: "Record step" }).click();
  await page.locator("#step-event").locator("option", { hasText: "Choose the step" }).waitFor({ state: "attached" });
  await page.waitForTimeout(300);
}

// ---- Case 3: "done" that is not done -----------------------------------------------------
await page.goto(`${BASE}/cases`);
await actAs("physician");
await page.locator('a.cell[href="/cases/CX-1003"]').waitFor();
mark("register, acting as physician");
await shot("case3-1-register.png");
await pause();
await page.locator('a.cell[href="/cases/CX-1003"]').click();
await page.getByRole("link", { name: "Closure review" }).click();
await page.getByText("AI proposal, not a decision: Reopen the case").waitFor();
mark("3.1 closure review: reopen, two quotes");
await shot("case3-2-closure-reopen.png");
await pause();
await page.locator("#reason").fill("Repeat colonoscopy needed");
await pause();
await page.getByRole("button", { name: "Reopen case" }).click();
await page.getByText("Case reopened by Dr. Fulan").waitFor();
mark("3.3 reopened");
await scrollTo(page.getByText("Case reopened by Dr. Fulan"));
await shot("case3-3-reopened.png");
await pause();
await page.getByRole("link", { name: "Open the case" }).click();
await page.getByText("Referral sent").first().waitFor();
mark("case page after reopen");
await shot("case3-4-case-referral-sent.png");
await pause();

if (!video) {
  // 3.4 hand over to S. Al Ali to rebook
  await recordStep("Owner assigned or handed over", {
    owner: "act_005",
    note: "Handed to S. Al Ali to rebook the repeat colonoscopy",
    shot: "case3-5-next-step.png",
  });
  mark("3.4 handed to S. Al Ali");
  // 3.5 the endoscopy unit accepts (coordinator)
  await actAs("coordinator");
  await recordStep("Receiving provider accepted the referral", { note: "Endoscopy unit E accepted the repeat colonoscopy" });
  mark("3.5 referral accepted");
  inbound("3.6");
  inbound("3.7");
  await actAs("physician");
  await page.reload();
  await page.locator("#step-event").waitFor();
  await recordStep("Pathology ordered", { note: "Polyp sent for histology" });
  mark("3.8 pathology ordered");
  inbound("3.9");
  await actAs("coordinator");
  await page.reload();
  await page.locator("#step-event").waitFor();
  await recordStep("Closure proposed with an outcome", {
    outcome: "surveillance_scheduled",
    note: "Closure proposed: surveillance colonoscopy in 3 years",
  });
  mark("3.10 closure proposed");
  await actAs("physician");
  await page.goto(`${BASE}/cases/CX-1003/closure`);
  await page.getByText("Latest report not read yet").waitFor();
  mark("closure review: latest report not read");
  await shot("case3-6-latest-not-read.png");
  await pause();
  await page.getByRole("button", { name: "Read the latest report" }).click();
  await page.getByText("AI proposal, not a decision: Propose closure").waitFor();
  mark("3.11 latest report read: propose closure");
  await shot("case3-7-propose-closure.png");
  await pause();
  await page.getByRole("button", { name: "Confirm closure" }).click();
  await page.getByText("Closure confirmed by Dr. Fulan").waitFor();
  mark("3.12 closure confirmed");
  await scrollTo(page.getByText("Closure confirmed by Dr. Fulan"));
  await shot("case3-8-closed.png");
  await page.getByRole("link", { name: "Open the case" }).click();
  await page.getByRole("heading", { name: "Audit trail" }).waitFor();
  await shot("case3-9-closed-full.png", { fullPage: true });
}

// ---- Case 2: referral rejected, the patient moves ---------------------------------------
await actAs("coordinator");
await page.goto(`${BASE}/cases?filter=unowned`);
await page.getByRole("link", { name: "CX-1002" }).waitFor();
mark("2.1 unowned list");
await shot("case2-1-unowned-list.png");
await pause();
await page.getByRole("link", { name: "CX-1002" }).click();
await page.getByText("Unowned 20h").first().waitFor();
mark("case 2 open, unowned");
await shot("case2-2-case-unowned.png");
await pause();
await page.locator("#move-provider").selectOption("prov_clinic_b");
await pause();
await page.getByRole("button", { name: "Record move" }).click();
await page.getByText("Assign-owner task with S. Al Ali").waitFor();
mark("2.2 move recorded");
await shot("case2-3-moved.png");
await pause();
await actAs("physician");
await page.locator("#consult-question").waitFor();
await pause();
await page.locator("#consult-question").pressSequentially(
  "Missing FIT date and history now attached. Can you accept the referral?",
  { delay: typeDelay },
);
await pause();
await page.getByRole("button", { name: "Send consultation request" }).click();
await page.getByRole("heading", { name: /Answer as Dr\. Fulana/ }).waitFor();
mark("2.3 consultation sent");
await shot("case2-4-consultation.png");
await pause();
await page.getByRole("button", { name: "+1 day" }).click();
await page.locator(".clock b", { hasText: "18 Nov" }).waitFor();
mark("2.4 clock +1 day");
await pause();
await page.locator("#answer-owner").selectOption("act_005");
await page.locator("#answer-note").fill("History received. Referral accepted; booking the colonoscopy.");
await pause();
await page.getByRole("button", { name: "Record answer as Dr. Fulana" }).click();
await page.getByText("Owned by S. Al Ali").waitFor();
mark("2.5 answered, owned");
await shot("case2-5-owned.png");
await pause();
if (!video) {
  inbound("2.6");
  await page.goto(`${BASE}/cases?filter=unowned`);
  await page.getByText("Every open case has an owner").waitFor();
  mark("unowned list empty");
  await shot("case2-6-unowned-empty.png");
}

// ---- Case 1: the silent patient (live script only) ---------------------------------------
if (!video) {
  await actAs("coordinator");
  await page.goto(`${BASE}/cases/CX-1001/outreach`);
  await page.locator("#staff-result").waitFor();
  mark("1.1 outreach ladder");
  await shot("case1-1-ladder.png");
  await page.locator("#staff-connected").selectOption("no");
  await page.locator("#staff-result").fill("No answer");
  await page.getByRole("button", { name: /Log attempt as/ }).first().click();
  await page.waitForTimeout(600);
  mark("1.2 call logged: no answer");
  await page.getByRole("button", { name: "+1 day" }).click();
  await page.locator(".clock b", { hasText: "19 Nov" }).waitFor();
  await page.getByRole("button", { name: "+1 day" }).click();
  await page.locator(".clock b", { hasText: "20 Nov" }).waitFor();
  mark("1.3 / 1.4 clock to 20 Nov");
  await page.locator("#navigator-result").waitFor();
  await scrollTo(page.getByRole("heading", { name: "Navigator call" }));
  await shot("case1-2-navigator-task.png");
  await page.locator("#navigator-connected").selectOption("yes");
  await page.locator("#navigator-reason").selectOption("fear");
  await page.locator("#navigator-result").fill("Reached the patient; afraid of the bowel preparation");
  await page.getByRole("button", { name: "Log attempt as Nur H." }).click();
  await page.waitForTimeout(800);
  mark("1.5 navigator: fear recorded");
  await shot("case1-3-fear.png");
  await page.goto(`${BASE}/p/hq7m3kx9va`);
  await page.locator("[dir=rtl]").first().waitFor();
  mark("1.6 patient page (Arabic)");
  await shot("patient-ar.png");
  await page.locator(".patient-actions .btn.primary").click();
  await page.locator(".patient-note").waitFor();
  mark("1.7 patient: understood");
  await shot("case1-4-patient-understood.png");
  await page.goto(`${BASE}/cases/CX-1001`);
  await page.getByText("Patient notified").first().waitFor();
  mark("case 1 at Patient notified");
  await shot("case1-5-notified.png");
}

// ---- The clock moves, escalation runs, programme view -------------------------------------
await page.getByRole("button", { name: "Next deadline" }).click();
await page.locator(".clock b", { hasText: video ? "20 Nov" : "23 Nov" }).waitFor();
mark("P.0 next deadline");
await actAs("program_manager");
await page.goto(`${BASE}/programme`);
await page.getByRole("heading", { name: /Delay reasons/ }).waitFor();
mark("P.1 programme view");
await shot(video ? "programme-video-1-top.png" : "programme-1-top.png");
await pause();
await scrollTo(page.getByRole("heading", { name: /Delay reasons/ }));
await shot(video ? "programme-video-2-delays.png" : "programme-2-delays.png");
await pause();
await scrollTo(page.getByRole("heading", { name: /Escalations per role/ }));
await shot(video ? "programme-video-3-escalations.png" : "programme-3-escalations.png");
const total = Number(((Date.now() - t0) / 1000).toFixed(1));
if (!noShots && !video) await page.screenshot({ path: join(shots, "programme-full.png"), fullPage: true });

const fear = await page.request
  .get(`${BASE}/api/program/summary?role=program_manager`)
  .then((r) => r.json())
  .then((s) => ({ fear: s.delay_reasons.find((r) => r.delay_reason === "fear")?.count, ai_divergence: s.ai_divergence }));

console.log(JSON.stringify({ mode: video ? "video" : "live", pace, total_seconds: total, marks, programme: fear, errors }, null, 2));
await browser.close();
