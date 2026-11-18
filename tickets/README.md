# Nexyra project tickets (Challenge 05)

Compiled on 15 Nov 2026. Submission deadline: **Saturday, 21 Nov 2026 at 02:59 UTC+7** (01:29 IST). Target for the first version: the afternoon of 20 Nov (UTC+7). The product specification is in [`brief-c05-nexyra.html`](../brief-c05-nexyra.html); these tickets break it down into work that can be picked up one piece at a time.

## What we submit

> **Flagged: two human review slots are the critical path, and neither is booked.**
> Slot 1 (label check, TICKET-12) is needed by **end of 17 Nov** and must happen *before* TICKET-13 runs, or the evaluation numbers are measured against tuned labels. Slot 2 (clinical review, TICKET-19) is needed **18 Nov** and blocks the deck, the brief update, and the documentation. Both are with Fulan. See [`docs/review-slots.md`](../docs/review-slots.md) for materials, prompts, and reminders. Nothing on the schedule recovers if these slip a day.

Details are in [`docs/submission.md`](../docs/submission.md).

| Deliverable | Limit | Ticket |
|---|---|---|
| Solution deck from the mandatory PPT template, as PDF | 5 MB | TICKET-26 |
| Demo video via a public link | under 3 minutes | TICKET-21 |
| Prototype or deployment link | – | TICKET-21 |
| Solution summary | 2,000 characters | TICKET-27 |
| What has been built during the challenge | 1,500 characters | TICKET-27 |
| Conflict of interest declaration | – | TICKET-27 |

## How to use

- One file per ticket. Change the `Status` line in the ticket file when starting and when finishing (`not started` → `in progress` → `done`).
- Tickets marked **Claude Code** can be handed straight to a Claude Code session, for example: "work on `tickets/TICKET-05.md`". Tickets marked **human** must be done by a team member.
- A ticket is done when every item in the "Done when" section is met and its tests pass.
- Priority: **P0** is mandatory for the submission, **P1** is done when that day's P0 work is finished, **P2** is cut first when time runs out.

## Decisions made

- Demo pathway: positive FIT → colonoscopy → pathology → follow-up. Other pathways are added via templates (see TICKET-04 and TICKET-18).
- No drop-off risk prediction model is built.
- AI only extracts and proposes. Case closure is always confirmed by a clinician.
- All data is synthetic. No real patient data.
- Nexyra builds on Malaffi referral data (DoH Circular 144/2026) and does not create a competing inter-clinician messaging channel.
- The stack is chosen for the project's needs, not for what is already installed: TypeScript on Node.js, React, and SQLite. Anything not yet installed is set up in TICKET-02, and the team may replace it in that ticket. SQLite replaced PostgreSQL via Docker Compose on 17 Nov to cut technical complexity (see [`docs/ideas/build-readiness.md`](../docs/ideas/build-readiness.md)).
- Roles: the picker keeps three (`coordinator`, `physician`, `program_manager`) for the demo. `docs/api.md` also defines `navigator`; it exists in the client `Role` type and in the permission table, but has no screen and is not selectable. Decided 18 Nov, before Phase 2 of [`docs/prompts/README.md`](../docs/prompts/README.md).
- Frontend stays in `src/`, the server goes in `server/` (deviation from TICKET-02's `src/engine` + `src/web` split). Recorded 18 Nov, Phase 3. `src/` is not moved or renamed.
- Vitest is pinned to v2 because v5 requires Vite 6+ and the app is on Vite 5. Typescript for `server/` is a separate project (`tsconfig.server.json`) because the app's `tsconfig.json` covers `src/` only.
- **Database driver and hosting, 18 Nov:** `better-sqlite3` was replaced by `@libsql/client`, and the app deploys to Vercel with Turso as the database. A Vercel function has no disk that survives between requests, so a local SQLite file cannot hold the demo state there. libSQL speaks the same SQLite dialect, so the schema and every query are unchanged; only the calls became async, and the three multi-statement writes became atomic batches. Locally the same client opens `data/nexyra.sqlite`; when `TURSO_DATABASE_URL` is set it talks to Turso instead. No install scripts or native builds are needed any more. Deployment steps are in [`docs/deploy.md`](../docs/deploy.md).

### Decisions taken before Phase 6 (18 Nov)

These settle every question the frontend would otherwise have to guess at. They are recorded here rather than discovered mid-session.

- **The engine's rules live in `server/engine.ts` only.** `availableActions(caseRow, role)` produces both the payload's `available_actions` and the answer every guard uses. `server/caseView.ts` reads and formats; `server/events.ts` writes; neither decides.
- **Closure needs no request body.** `CX-1003` is seeded with the outcome the engine proposed (`returned_to_routine_screening`) plus a `closure_proposed` event, so `POST /api/cases/{id}/closure/confirm` with only the actor header closes it. The optional `{ "final_outcome": ... }` body stays for a screen that lets the physician override; it is an extension of the contract, documented in `docs/api.md`.
- **Confirmation finalises the case.** One `closure_confirmed` event moves it straight to `closed`. The `closure_confirmed` stage remains visible in the stage strip as the step between proposal and closure.
- **Outreach is an event, not a transition.** `POST /api/cases/{case_id}/outreach` appends `outreach_attempted` and leaves the stage alone, so `outreach_attempts[]` and the timeline cannot disagree. `api.logOutreach(caseId, input, actor)` in `src/api/http.ts` maps to this endpoint; the client sends `outcome` and optionally `delay_reason`, and the server defaults `channel` to `call` because `OutreachInput` carries no channel.
- **Actor mapping for the role picker** (ids are from `server/seed.ts`): `coordinator` → `act_001` / `coordination_staff` / "R. Haddad"; `physician` → `act_003` / `responsible_physician` / "Dr. Fulan"; `program_manager` → `act_004` / `program_manager` / "A. Al Suwaidi". `navigator` (`act_002`) stays unselectable.
- **Reads keep accepting `?role=` until Phase 6 switches the client to the header.** A present-but-invalid header is always refused; it never falls back to the query parameter. Once `src/api/http.ts` sends the header, `GET /api/cases` and `GET /api/cases/{id}` can be tightened to require it without touching any page.
- **`GET /api/cases/{id}/verification` takes no actor.** It is report text and citations, not a decision, and the contract does not guard it. A header sent anyway is still validated.
- **Program view stays mock-shaped for the demo.** `GET /api/program/summary` is not built (Phase 8). `/programme` keeps reading the fixture programme through the same `NexyraApi` interface, so switching `api` to HTTP must not remove that call from the interface.


## Ticket list

| ID | Title | Priority | Day | Assignee | Depends on |
|---|---|---|---|---|---|
| [TICKET-01](TICKET-01.md) | Complete the official submission requirements | P0 | 15 Nov | human | – |
| [TICKET-02](TICKET-02.md) | Set up the project and stack | P0 | 15 Nov | Claude Code | – |
| [TICKET-03](TICKET-03.md) | Data model and audit trail | P0 | 15 Nov | Claude Code | 02 |
| [TICKET-04](TICKET-04.md) | FIT pathway template as configuration | P0 | 15 Nov | Claude Code | 02 |
| [TICKET-05](TICKET-05.md) | Case state machine and closure rules | P0 | 15 Nov | Claude Code | 03, 04 |
| [TICKET-06](TICKET-06.md) | Timers, demo clock, and escalation | P0 | 16 Nov | Claude Code | 05 |
| [TICKET-07](TICKET-07.md) | Synthetic data generator | P0 | 16 Nov | Claude Code | 03, 04 |
| [TICKET-08](TICKET-08.md) | Unowned cases and event stitching | P0 | 16 Nov | Claude Code | 05, 06 |
| [TICKET-09](TICKET-09.md) | Worklist and case detail page | P0 | 16 Nov | Claude Code | 05, 06 |
| [TICKET-10](TICKET-10.md) | Patient outreach ladder | P0 | 17 Nov | Claude Code | 06, 09 |
| [TICKET-11](TICKET-11.md) | Inter-clinician consultation monitoring | P1 | 18 Nov | Claude Code | 08, 09 |
| [TICKET-12](TICKET-12.md) | Labeled report test set | P0 | 16 Nov | Claude Code + human | 02 |
| [TICKET-13](TICKET-13.md) | Report extraction with citations | P0 | 17 Nov | Claude Code | 05, 12 |
| [TICKET-14](TICKET-14.md) | Closure verification evaluation | P0 | 17 Nov | Claude Code | 12, 13 |
| [TICKET-15](TICKET-15.md) | Closure confirmation screen | P0 | 17 Nov | Claude Code | 09, 13 |
| [TICKET-16](TICKET-16.md) | Program view | P0 | 18 Nov | Claude Code | 07, 08 |
| [TICKET-17](TICKET-17.md) | Three demo cases with one-command reset | P0 | 18 Nov | Claude Code | 08, 10, 15 |
| [TICKET-18](TICKET-18.md) | Second pathway via configuration | P2 | 19 Nov | Claude Code | 04, 05, 06 |
| [TICKET-19](TICKET-19.md) | Clinical review | P0 | 18 Nov | Fulan (external) | 04, 12 |
| [TICKET-20](TICKET-20.md) | Submission documentation | P0 | 19 Nov | Claude Code + human | 14, 19 |
| [TICKET-21](TICKET-21.md) | Demo video and prototype link | P0 | 18–19 Nov | human + Claude Code | 17 |
| [TICKET-22](TICKET-22.md) | Recording rehearsal and Q&A preparation | P0 | 19 Nov | human | 17 |
| [TICKET-23](TICKET-23.md) | Final from-scratch check | P0 | 19 Nov | Claude Code | all P0 |
| [TICKET-24](TICKET-24.md) | Update the brief | P1 | 19 Nov | Claude Code | 19 |
| [TICKET-25](TICKET-25.md) | HL7 v2 message ingest for referrals and lab results | P1 | 18 Nov | Claude Code | 05, 08 |
| [TICKET-26](TICKET-26.md) | Solution deck from the mandatory template | P0 | 17–19 Nov | Claude Code + human | 01, 14, 19 |
| [TICKET-27](TICKET-27.md) | Fill in the form and submit | P0 | 19–20 Nov | human + Claude Code | 21, 23, 26 |

## Schedule

| Day | Tickets | Result at end of day |
|---|---|---|
| 15 Nov | 01, 02, 03, 04, 05 | One case can be created and driven through tests, with an audit trail |
| 16 Nov | 06, 07, 08, 09, 12 | Cases move on their own when the clock advances and show up in the worklist |
| 17 Nov | 10, 13, 14, 15, deck skeleton 26 | Closure verification runs and has evaluation numbers; the deck skeleton already follows the template |
| 18 Nov | 16, 17, 19, first deploy 21, 25, 11 | The three demo cases run from start to closure; the flow has been clinically reviewed; the app can be opened from outside |
| 19 Nov | 20, 26, 22, video 21, 23, draft 27, 24, 18 | Deck and video finished, build checked from scratch |
| 20 Nov | 27 | Send the first version in the afternoon (UTC+7). Remaining time is only for small fixes. |
| 21 Nov 02:59 UTC+7 | – | Deadline. Do not rely on these hours. |

## Status on 18 Nov

Read from the ticket files and the code (317 tests pass in 26 files). "Human" means a person must act; the code cannot finish it.

| Ticket | Status | What is left |
|---|---|---|
| 01 Submission requirements | in progress (human) | Record the form options (Solution stage, Challenges) |
| 02 Project and stack | done | |
| 03 Data model and audit trail | done | |
| 04 FIT pathway template | done | Deadlines await clinical review (19) |
| 05 State machine and closure | done | |
| 06 Timers, clock, escalation | done | |
| 07 Synthetic data generator | done | Parameters are team guesses |
| 08 Unowned cases and stitching | done | Probabilistic matching designed, not built |
| 09 Worklist and case detail | done | |
| 10 Outreach ladder | done | Arabic native-speaker review (human); Urdu, Hindi, Tagalog empty |
| 11 Consultation monitoring | done | Answers enforced to the addressed physician (403 otherwise); Dr. Fulana and Nur H. act through forms on the case page |
| 12 Labelled test set | in progress (human) | A person must check `labels.json` before the evaluation runs |
| 13 Report extraction | done in code | Not run against a real model |
| 14 Closure verification evaluation | in progress | Harness ready; needs a model key and the checked labels. `[EVAL RESULTS PENDING — TICKET-14]` |
| 15 Closure confirmation screen | done | `proposal/reject` (`proposal_rejected`), Reopen case (`procedure_incomplete`) and the `ai_divergence` count are built; the closure review reads the latest report |
| 16 Program view | done | Check the delay-reason count after a logged call (see `docs/demo-script.md`) |
| 17 Demo cases and reset | in progress | Demo walk done; a timed rehearsal remains (video path about 2:35) |
| 18 Second pathway | done | Demonstration only, not clinically reviewed |
| 19 Clinical review | not started (human) | Fulan. `[CLINICAL REVIEW PENDING — TICKET-19]` |
| 20 Submission documentation | in progress | Docs updated 18 Nov; update again after 14 and 19 |
| 21 Video and prototype link | in progress (human) | Deployed: https://nexyra-health.vercel.app (reset verified). Record the video. `[PENDING — TICKET-21]` |
| 22 Rehearsal and Q&A | not started (human) | |
| 23 From-scratch check | not started | After all P0 tickets |
| 24 Update the brief | not started | After 19 |
| 25 HL7 v2 ingest | done | Generic v2.5; Malaffi spec not seen |
| 26 Deck | in progress (human + Claude Code) | Final text in `docs/deck-content.md`; team fields and screenshots |
| 27 Form and submit | in progress (human) | Team fields, conflict of interest, links |

## Cut order if time runs out

1. TICKET-18 (second pathway)
2. TICKET-11 (consultation monitoring), covered in the documentation instead
3. TICKET-25 (HL7 v2 ingest), covered in the documentation instead
4. TICKET-24 (brief)
5. Arabic in TICKET-10, keep English only with Arabic as a draft
6. The 1,000-case funnel in TICKET-16, keep only the exception list

Do not cut TICKET-13, TICKET-14, TICKET-15, or TICKET-17. Those four tickets are Nexyra's differentiators. TICKET-21, TICKET-26, and TICKET-27 cannot be cut either, because without them there is nothing to submit.
