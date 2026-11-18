# Nexyra

Nexyra is a case engine for positive screening results, built for Challenge 05 "Closing the Screening-to-Care Loop" of the Future Health Digital Innovation Challenge. Every case has one owner, a deadline per stage and an audit trail, and it escalates by role when nobody acts. A case closes only when evidence is attached and a responsible physician confirms. AI may read a report and propose; the `system` role can never close a case. All data in this repository is synthetic.

Nexyra builds on Malaffi e-Referral data (DoH Circular 144/2026). It is not a referral tracker and not a messaging channel. No drop-off risk model is built.

## What is in the build

- **Two pathways, one engine.** Positive FIT to colonoscopy, pathology and follow-up is built and demoed. Mammography to biopsy is a configuration demonstration only (a second JSON file, no engine change); it has not been clinically reviewed. Both are in `server/pathways/`.
- **Outreach ladder.** Automated message, then a staff call task, then the navigator, each on a deadline. Patient page in English and Arabic (Arabic not yet reviewed by a native speaker). Urdu, Hindi and Tagalog are empty draft slots.
- **Unowned cases.** A rejected referral, an unanswered referral or a patient who moves provider leaves the case with no owner. It goes to an unowned queue with a task and a clock. Incoming FHIR Appointment, Procedure and DiagnosticReport resources are stitched to the case on two exact keys; anything that does not match goes to an unstitched queue and is never dropped.
- **Consultation monitoring.** One question from referring to receiving provider, with an owner, a deadline and escalation. It sits on top of e-Referral and is not a messaging channel.
- **HL7 v2 ingest.** REF and ORU messages are turned into the same case events. The structure is generic HL7 v2.5; the Malaffi specification has not been seen.
- **Report extraction with citations.** A model reads a colonoscopy or pathology report and returns six fields, each with a quote. Code checks that every quote is in the report; a field whose quote fails becomes unknown. Plain rules in code, not the model, turn the fields into a proposal. A physician confirms, or rejects the proposal with a reason. Closure review reads the case's latest report (the latest colonoscopy report together with any later pathology report) and also offers **Reopen case**. The programme view counts physician-AI divergence.
- **Evaluation harness.** `npm run eval` compares extraction with 24 labelled synthetic reports. It has not been run against a live model, so no accuracy figure is claimed.
- **Programme view.** Exceptions, funnel, referral to colonoscopy against the 31-day limit, delay reasons, escalations per role per day, and a scenario panel labelled as an assumption. It reads a synthetic cohort of 1,000 cases whose drop-off rates are inputs, not findings.
- **Demo reset.** `npm run demo:reset` gives the same state every time (about 6 s). The hosted demo resets itself every day.

## Prerequisites

- Node.js 22 or newer, with npm.
- No database server. Locally the app uses a SQLite file (`data/nexyra.sqlite`, created on first run). Deployed, it uses Turso (libSQL).
- No API key is needed to run the demo: the two readings for demo case 3 are stored demo readings, not model output (the first carries a model label but was not produced by a verified live model call; the second is labelled `hand-written demo reading (no model call)`). With `LLM_BASE_URL` and `LLM_API_KEY` set, the extraction step calls any OpenAI-compatible model endpoint (DeepSeek is the default; Meta Muse Spark through the Meta Model API is possible). Only synthetic data is ever sent.

## Install

```bash
npm install
```

## Run locally

Run these in order. The last two keep running, so use two terminals.

```bash
npm run demo:reset    # creates data/nexyra.sqlite: three FIT demo cases, three mammography cases, the 1,000-case cohort, day 0
npm run server        # API on http://localhost:3001
npm run dev           # frontend on http://localhost:5173, proxies /api to the server
```

Open the frontend URL, pick a role and follow [`docs/demo-script.md`](docs/demo-script.md). The demo clock is controlled from the screen. Run `npm run demo:reset` again to return to the starting state.

Windows note: in PowerShell, if script execution is blocked, use `npm.cmd` and `npx.cmd` instead of `npm` and `npx`.

Other commands: `npm run demo:step -- list` (send a demo step from a terminal), `npm run ingest:hl7 -- data/hl7` (HL7 v2 messages), `npm run verify:file -- <report.txt>` (extract one report), `npm run perf` (round trips per request), `npm run pathway:deadlines`.

## Tests

```bash
npm test                  # 317 tests in 26 files (Vitest)
npm run typecheck:server  # type check for server/
npm run build             # type check and build the frontend
```

## Deploy

Vercel serves the frontend and runs the API as one function; Turso is the database. Steps are in [`docs/deploy.md`](docs/deploy.md). Environment variables are listed in `.env.example`. Never commit `.env`. The prototype is deployed at **https://nexyra-health.vercel.app** (public, no login; API and Turso database both in Mumbai; daily reset by Vercel Cron). Demo video: `[PENDING — TICKET-21]`.

## Documentation

| File | Content |
|---|---|
| [`docs/assumptions.md`](docs/assumptions.md) | Every assumption, with its source or an assumption label |
| [`docs/dependencies.md`](docs/dependencies.md) | What a pilot needs and does not have yet, and what the prototype runs on |
| [`docs/limitations.md`](docs/limitations.md) | What this build does not do or prove |
| [`docs/data-sources.md`](docs/data-sources.md) | Data and literature sources |
| [`docs/evidence.md`](docs/evidence.md) | Evidence summary with caveats as in the sources |
| [`docs/responsible-ai.md`](docs/responsible-ai.md) | Role of AI, limits on it, and how they are enforced |
| [`docs/api.md`](docs/api.md) | API contract |
| [`docs/architecture.md`](docs/architecture.md) | Architecture |
| [`docs/demo-script.md`](docs/demo-script.md), [`docs/video-script.md`](docs/video-script.md) | Live demo and the video |
| [`docs/deck-content.md`](docs/deck-content.md) | Final text for each slide of the submission deck |
| [`docs/form-answers.md`](docs/form-answers.md) | Draft of the submission form |
| [`docs/submission.md`](docs/submission.md) | Official submission requirements |

The product brief is [`brief-c05-nexyra.html`](brief-c05-nexyra.html).
