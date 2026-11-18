# Final from-scratch check (TICKET-23)

- **Run:** Wed 18 Nov 2026, about 19:05 to 19:25 (UTC+7), Windows 11, Node v26.13.0, npm 11.20.0, 14 CPU cores.
- **Commit checked:** `05bc408a523da01432b9ba0af2d87465d910a2ed` (local master, cloned with `git clone D:/futurehealth-h2s <scratch>/fresh`; 272 tracked files; no `node_modules`, `.env` or database in the clone).
- **Method:** the README was followed in the fresh clone using the Bash tool. Nothing in the working repository was changed except this file. Nothing was committed, pushed, deployed or reset remotely. Only GET requests went to the public site.

## Verdict

Install, reset, build, type check, the three demo cases through the API and the public prototype all pass. **The full test suite fails with the README's plain `npm test` on this machine** (3 of 3 runs). It passes (317 of 317, 3 of 3 runs) when the number of parallel workers is limited. This is a real finding and is not fixed here (a fix would edit `vite.config.ts`, which is out of scope for this check).

## What passed

| Step | Command | Result |
|---|---|---|
| Install | `npm install` | exit 0, 26 s. Prints "8 vulnerabilities (5 moderate, 1 high, 2 critical)" from `npm audit` and a warning that 2 packages (esbuild) have install scripts not yet approved; neither blocked anything |
| Demo reset | `npm run demo:reset` | exit 0. Output: `cases=1006 (cohort 1000) events=5276 clock=day 0 rows=7085 batches=5`, `built in 6.5s, copied in 0.3s, total 6.8s`. About 10.5 s wall time including npm start-up. Creates `data/nexyra.sqlite`. Re-run with the server running: total 4.7 s, clock back to day 0, no error |
| Server | `npm run server` | "nexyra api on http://localhost:3001", `GET /api/clock` returns `17 Nov 2026 · 11:42`, day 0 |
| Dev server | `npm run dev` | Vite 5.4.21 on :5173, returns 200, `/api/clock` through the proxy returns the same clock |
| Type check | `npm run typecheck:server` | exit 0, no output |
| Build | `npm run build` | exit 0. `✓ 58 modules transformed`, `✓ built in 729ms` (about 6.9 s with `tsc -b`). `dist/assets/index-DOGFnX1r.js` 239.86 kB (72.55 kB gzip), CSS 18.59 kB |
| Tests, limited workers | `npx vitest run --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1` (and again with `maxForks=4`, twice) | 3 runs: `Test Files  26 passed (26)`, `Tests  317 passed (317)`, durations 68.16 s, 66.31 s, 77.51 s |
| Demo walk | `npm run demo:step -- 3.1 ... 3.12 2.1 ... 2.6 1.1 ... 1.7 P.0 P.1` (all 27 steps in script order, one call) | exit 0, every step `ok ... 200`, 3.1 s total. Case 3 ends `closed` (3.12), case 2 ends `referral_accepted` then the inbound booking is stitched (2.6), case 1 ends with the patient page in Arabic, `dir: rtl` (1.6, 1.7), clock ends 23 Nov 2026 · 11:42, programme view returns (P.1) |
| Reset after the walk | `npm run demo:reset` with the server still up | clock back to 17 Nov 2026 · 11:42; `/api/cases?role=program_manager` returns the six demo cases and 1,000 hidden cohort cases |

## What failed

### F1. Plain `npm test` fails on this machine (3 of 3 runs)

Commands and summary lines (stripped of colour):

- Run 1: `Test Files  10 failed | 16 passed (26)`, `Tests  181 passed | 136 skipped (317)`, duration 64.54 s, exit 1.
- Run 2: `Test Files  9 failed | 17 passed (26)`, `Tests  191 passed | 126 skipped (317)`, duration 66.62 s, exit 1.
- Run 3 (output saved): `Test Files  9 failed | 17 passed (26)`, `Tests  191 passed | 126 skipped (317)`, duration 59.27 s, exit 1.

Errors in the failed suites: `Error: Hook timed out in 10000ms.` (the `beforeAll` of the suites that build the 1,000-case database; each build takes 5 to 9 s alone, and with 14 test processes at once it passes the 10 s hook limit) and, in one suite, `EPERM, Permission denied` while deleting a temp folder (`nexyra-pathway2-*`) after the failed hook. Which suites fail changes from run to run (consultation, demoFlow, programme, secondPathway, unowned, writes, outreach/ladder, verification, hl7v2, and clock once).

Evidence that it is load and not a logic failure: `npx vitest run server/clock.test.ts` alone passes (10 of 10), and the whole suite passes 317 of 317 with `--poolOptions.forks.maxForks=3` or `4`.

Not known: whether it also fails on a machine with fewer cores (it would then run fewer workers) or on the team's own machines. The team's earlier "317 tests" claims were made on this same repo, so they may have been run with fewer parallel workers or with other load absent. A judge running `npm test` on a many-core Windows laptop could see red.

Suggested fix (not applied): in `vite.config.ts` set `test.hookTimeout` and `test.testTimeout` to 60000 and `poolOptions.forks.maxForks` to 4. Then re-run twice.

## README corrections needed

1. **`npm test` as written can fail** (F1). Either fix the config or add the limited-workers command to the README.
2. **README says "`npm run demo:reset` ... (about 6 s)".** Measured 6.8 s, 5.8 s, 4.7 s in the script's own timer; 10.5 s wall time on first run because of `tsx` start-up. Fine; "about 6 s" is acceptable, say "6 to 10 s" if wanted.
3. **Two terminals:** the README says "the last two keep running", which is right, but does not say the first command must finish before `npm run server` starts. It worked as written.
4. **`npm install` prints 8 audit vulnerabilities (2 critical) and an install-scripts warning.** Not mentioned in the README. They did not block anything; a judge may wonder. Consider one sentence ("dev dependencies; synthetic data only") after checking `npm audit` (only the severity levels were looked at here, not the packages).
5. **Windows note** covers PowerShell script blocking. Bash was used here and worked, so no other Windows quirk was met. Under Git Bash, a URL path beginning with `/` passed to `curl` is rewritten unless `MSYS_NO_PATHCONV=1` is set; this is a Git Bash issue, not a README issue.
6. **Demo reset while the server is running** works; the README says only "run `npm run demo:reset` again to return to the starting state". Good.
7. **Placeholders still in the README:** `Demo video: [PENDING — TICKET-21]` and `[EVAL RESULTS PENDING — TICKET-14]`. These are honest but must be replaced or removed before submission if the video exists.
8. The README says "Node.js 22 or newer"; v26.13.0 was used. Node 22 itself was not tested.

## Not checked

- **Network off.** Not done. The shell had no `LLM_*`, `TURSO_*` or proxy variables set, so the run used no model key and no network for the app (the stored demo readings were served from cache, steps 3.1, 3.2 and 3.11 returned 200). That shows no key is needed. It does not prove the app works with the network adapter disabled. Disabling the network was not attempted because it would change system settings.
- **Browser clicks.** The demo was walked through the API (`demo:step`) and the Vite page returned 200; no one clicked through the UI in this check. `tools/demo-walk.mjs` (browser click-through in Edge) was not run. `server/demo.test.ts` is part of the 317 passing tests and replays the same steps.
- `npm run eval`, `npm run perf`, `npm run ingest:hl7`, `npm run verify:file`, `npm run pathway:deadlines` were not run.
- Rendering of the Arabic patient page in a browser (the API returned `dir: rtl`; the page shell returned 200).
- Whether the deployed app's daily reset works (cron). Not triggered, by instruction.
- Node 22 and a machine with fewer cores.
- The deck: `docs/deck/` is being built by another agent. At 19:13 the folder held `Nexyra-C05-submission.pdf` (565 KB) and `.pptx` (2.0 MB). The deck contents were not read here, only the file sizes were seen. The deck is not in git yet, so the fresh clone does not contain it.

## Public prototype (read-only GETs, 18 Nov 2026 about 19:15)

| Request | Result |
|---|---|
| `GET https://nexyra-health.vercel.app/` | 200 (HTML shell, 2,030 bytes) |
| `GET /api/clock` | 200: `{"now":"2026-11-17T11:42:00+07:00","is_demo":true,"day":0,...,"label":"17 Nov 2026 · 11:42"}` (day 0, as it should be after the reset). First call 1.6 s (cold), later calls under 0.4 s |
| `GET /api/cases?role=program_manager` | 200, 0.34 s: counts open 5, unowned 1, register total 6, cohort of 1,000 not included; cases CX-1001, CX-1002, CX-1003, MM-2001, MM-2002, MM-2003 |
| `GET /p/hq7m3kx9va?lang=ar` | 200 (the same HTML shell; the page itself is drawn by the browser, so its Arabic content was not seen) |

No POST was sent.

## Repository hygiene (fresh clone, 272 tracked files)

- Tracked file names matching `.env`, `*.sqlite`, `*.db`, `arsip`, `144 2026`, `.claude/`, `.pem`, `.key`: only `.env.example`, which holds empty values (`TURSO_AUTH_TOKEN=`, `LLM_API_KEY=`, `CRON_SECRET=`, `DEMO_RESET_SECRET=` all empty). Clean.
- Content search over every tracked file for `TURSO_AUTH_TOKEN=<value>`, `LLM_API_KEY=<value>`, `Bearer <token>`, `sk-<16+ chars>`, `eyJ<token>`: one hit, `server/verify/extract.test.ts:376`, the test string `Bearer test-key-not-real` (a fake). Clean. This search used patterns only; it does not prove no other kind of secret exists.
- No database file, no `arsip-itmam`, no `144 2026.pdf`, no `.claude/`, no PDF or video in git. `.gitignore` covers `data/*.sqlite*`, `.env`, `.env.local`, `.vercel`, `dist/`, `node_modules/`.
- Data resembling real people: not checked beyond the project's own statement that all data is synthetic (names such as "L. Fernandes", "R. Kumar" are the documented fictional demo patients). `data/fhir-examples`, `data/hl7`, `data/test-reports` are tracked and were not read in full.
- Repository size: `.git` 15 MB on disk (4.1 MiB packed).

Ten largest tracked files:

| Size | File | Note |
|---|---|---|
| 5,065,904 | `docs/shots/programme-full.png` | Large for a screenshot. 33 files in `docs/shots/` total about 8.2 MB. Consider shrinking or dropping before the repo goes to judges |
| 1,040,291 | `public/brand/nexyra-og.png` | brand image |
| 1,028,090 | `public/brand/nexyra-deck-cover.png` | brand image |
| 729,671 | `public/brand/nexyra-icon.png` | brand image |
| 679,007 | `docs/[PUB] Future Health Digital Innovation Challenge _ Submission Template.pptx` | organizers' template; fine to keep, odd file name with brackets and spaces |
| 516,478 | `public/brand/nexyra-og-1200x630.png` | brand image |
| 354,932 | `docs/shots/case3-9-closed-full.png` | screenshot |
| 269,367 | `docs/shots/case2-5-owned-full.png` | screenshot |
| 227,018 | `public/brand/nexyra-icon-crop.png` | brand image |
| 142,313 | `package-lock.json` | expected |

Nothing unnecessary other than the oversized `programme-full.png`. Nothing blocks submission.

## Requirements against `docs/submission.md`

Status key: **met**, **not yet**, **human** (a person must do it).

| Requirement | Status | Note |
|---|---|---|
| Submit by 21 Nov 2026 01:29 IST (02:59 UTC+7); team target afternoon of 20 Nov | not yet | Not submitted. Date today is 18 Nov |
| Use the reference PPT template | not yet | Template is in the repo (`docs/[PUB] ...pptx`). A deck `Nexyra-C05-submission.pptx` is being built in `docs/deck/` by another agent; not verified against the template here |
| Challenge: Challenge 05 | human | Choice written in `form-answers.md`; dropdown is ticked on the form by a person |
| Solution summary, 2,000 characters | met (draft) | Draft in `form-answers.md` is 1,987 characters, re-measured here (2 blocks: 1,987 and 1,048). If the form counts a line break as two, the draft's own note gives 1,995, still under. Not yet entered in the form (human) |
| Solution stage dropdown | human | Options still not recorded in `submission.md`; pick the earliest "prototype" style option |
| What has been built, 1,500 characters | met (draft) | 1,048 characters. Mentions 317 tests: confirmed by the run above (317 pass when workers are limited). Not yet entered (human) |
| Technology type (checkboxes) | human | Plan: Software application and AI agent. The AI-agent tick depends on the stored readings counting as cached readings; the demo showed them served from cache, so the condition in `form-answers.md` is met |
| Prototype / deployment link, 1,024 characters, required | met | `https://nexyra-health.vercel.app` (37 characters) returns 200 publicly, no login; clock at day 0. Open it in a private window right before submitting (human) |
| Upload solution deck, PDF, 5 MB, from the template | not yet | A 565 KB PDF existed in `docs/deck/` at 19:13, well under 5 MB. Content, template fit and final version not checked here. Not in git |
| Conflict of interest, every member asked | human | `form-answers.md` has the table empty and "NOT DECIDED". Every member must be asked directly. The deck slide must say the same |
| Software, hardware or both | met | Software (planned answer; entered by a human) |
| Demo video link, under 3 minutes, viewable by anyone | not yet | No video link exists. `[PENDING — TICKET-21]` is still in the README, deck content and form answers. Script is in `docs/video-script.md` |
| Technical documentation, assumptions, dependencies, limitations | met (in repo) | `docs/assumptions.md`, `dependencies.md`, `limitations.md`, `architecture.md`, `api.md`, `responsible-ai.md` exist; they must also be in the deck per `submission.md`'s own guess |
| Pending markers resolved or reported honestly | not yet | `[EVAL RESULTS PENDING — TICKET-14]` and `[CLINICAL REVIEW PENDING — TICKET-19]` remain in README, assumptions, limitations, dependencies, evidence, deck content. They are honest statements, not errors, but the evaluation has not been run |
| Still to check in `submission.md`: option lists, update after submit, checkpoint sessions | not yet | The checklist in `submission.md` is all unticked |
| AI Evaluation Score Feedback section | human | Unexplained on the page; not touched |

## TICKET-23 "Done when" status

- Installation from scratch succeeds with only the README: **yes**, except that the test step in the README fails on this machine (F1).
- All tests pass, output copied: **partly**. Passes 3 of 3 with limited workers; fails 3 of 3 with the README command.
- Three demo cases complete with and without network: **with**: yes through the API. **Without**: not tested with the network disabled (see "Not checked"); no key or network was used.
- Every requirement marked met or with a reason: done above.
- Every failure fixed or written into `docs/limitations.md`: **not done**. F1 is neither fixed nor written into `limitations.md`; that needs a decision by the team.

## Follow-up applied after this check (18 Nov)

- **`npm test` timeouts fixed.** `vite.config.ts` now caps Vitest at 4 forks and raises hook/test timeouts to 60 s. On the main machine `npm test` then passed 317/317 twice in a row (65 s and 67 s).
- **npm audit, production dependencies only (`npm audit --omit=dev`):** 2 moderate findings in `react-router` / `react-router-dom` (client-side routing). The fix needs a major-version upgrade; not done two days before the deadline. The critical findings reported by a full `npm audit` are in development tooling, not in the deployed app.

## Later on 18 Nov: evaluation run

The evaluation listed above as pending was run against a live model (`muse-spark-1.3`, prompt `extract-v1`, 24 reports, none unavailable): 0 of 14 must-not-close reports proposed for closure; 4 of 10 closable reports proposed, 6 held for human reading. Full results in `docs/evaluation-results.md`. The deck and documents now state these figures.
