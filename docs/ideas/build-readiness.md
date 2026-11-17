# Nexyra — build-readiness verdict

Written 17 Nov 2026. Answers the question: *is the plan detailed enough to build from?*

## Problem Statement

How might we hand a 27-ticket plan to a builder without it stopping for clarification?

## Verdict

**The plan is detailed enough to build from. The schedule is not.** Those are different failures, and only one of them is fixable by editing docs.

The tickets name tables and columns (`events`, `timers`, `tasks`, `documents`), functions (`appendEvent()`, `rebuildCase()`, `applyEvent()`, `tick(now)`), file paths (`src/pathways/fit-colonoscopy.json`), the folder layout, the npm scripts, and acceptance criteria that read like test names. `TICKET-05` and `TICKET-13` even pin the safe direction of error. An agent can start `TICKET-02` and finish `TICKET-05` without a conversation.

What is not ready is the clock: `tickets/README.md` expected tickets 01–10 done by end of 16 Nov, and nothing is built yet (the workspace holds 31 Markdown files, the brief HTML, and no `src/`, `package.json`, or `.git`).

## Recommended Direction

A 45-minute contract pass, then build as written. The four blocking gaps are documentation seams, not design gaps; fixing them costs less than one rework cycle on the engine↔UI boundary. Nothing about the product direction changes. `TICKET-13`, `14`, `15`, and `17` remain the differentiators and remain uncuttable.

### The four gaps that would stop a builder

1. **No API contract.** Ten tickets depend on one HTTP surface between `src/engine` and `src/web`, and it is never written down — only implied by "the server still rejects them if called directly" (`TICKET-09`, `TICKET-15`). Most likely source of rework on day 2.
2. **No actor/trust model, even a fake one.** `TICKET-05` requires rejecting closure by the `system` or coordination-staff role *server-side*. Nothing says how the role picker's choice reaches the server or whether the server trusts it. One paragraph fixes it.
3. **The repo path was stale.** `TICKET-02` says `git init` in `D:\futurehealth-h2s`; the project now lives at `c:\Users\User\Projects\nexyra`.
4. **The human-gated chain is the real risk.** `TICKET-12` labels → `13` → `14` → `TICKET-26` deck → `27` submit. `TICKET-04` states plainly that the team has no clinician. `TICKET-19` is P0 with no owner. `TICKET-26`/`27` need the exact requirement wording that `brief-c05-nexyra.html` still marks in 11 places.

Smaller: `NEXYRA_MODEL` is now fixed to `deepseek/deepseek-v4.1-flash-1017` via an OpenAI-compatible endpoint (17 Nov), so `TICKET-13` no longer has to guess a model id.

## Decisions closed on 17 Nov

- **Project directory:** `c:\Users\User\Projects\nexyra` (this folder). `TICKET-02`'s `D:\futurehealth-h2s` is obsolete.
- **Clinical reviewer for `TICKET-19`, and label checker for `TICKET-12`:** Fulan, a hospital colleague of the team. The "team has no clinician" note in `TICKET-04` is now out of date — Fulan is external, so reviews need to be scheduled against his availability.
- **Database: SQLite, not PostgreSQL via Docker Compose.** Chosen to keep Docker out of the critical path. `TICKET-02`'s Docker Desktop + WSL2 install and admin rights requirement drop away. This changes the database row in the `TICKET-02` stack table and the "if Docker cannot be installed" note, which is now just the decision.

### What SQLite changes, and does not

- Timers still work: SQLite serialises writes, so `tick(now)` idempotency (`TICKET-06`) is easier, not harder — but it must still be tested, because a repeated tick is the failure mode, not concurrent writes.
- Row locking language in `TICKET-02` no longer applies. Say `BEGIN IMMEDIATE` where atomicity matters, or accept single-writer semantics and state it in `docs/architecture.md`.
- "Deployment readiness" no longer gets credit from Docker. Compensate in the deck by showing the SQLite file path and backup/restore, not by claiming production scale.
- Migrations stay, run automatically on first start (`TICKET-03` depends on this).
- `DATABASE_URL` becomes `DATABASE_FILE`, and deployment (`TICKET-21`) now needs a host with a persistent disk rather than a database service.

### Applied to the tickets on 17 Nov

- `TICKET-02`: stack table, scope, `.env.example`, done-when, and notes now say SQLite and `c:\Users\User\Projects\nexyra`; no admin-rights installs.
- `TICKET-04`: the "team has no clinician" note now names Fulan as the external reviewer.
- `TICKET-12`: Fulan named as label checker, in the Assignee line, the scope, and done-when.
- `TICKET-19`: Assignee is Fulan; goal, the scheduling line (now dated 17 Nov), and notes name him.
- `TICKET-20`, `TICKET-21`, `tickets/README.md`: follow-on corrections (stack row, hosting, credit line, assignee row).
- The brief (`brief-c05-nexyra.html`) still says "no clinician sits on the team" in three places. That stays true — Fulan is external, not a team member — so no edit needed.

### Seams 1 and 2 closed on 17 Nov

`docs/api.md` now holds the engine↔web contract and the actor model:

- Endpoints, response shapes, error codes, and the `X-Nexyra-Actor` header.
- The rule that `role: "system"` cannot arrive over HTTP, and that a missing or unknown actor is rejected rather than defaulted.
- A role permission table, with `available_actions` produced by the engine so the UI and the guards cannot drift.
- `quote_offset` in the verification response, so citation highlighting does not depend on a client-side text search.
- An explicit statement that this is not security and must be recorded in `docs/limitations.md`.

Referenced from `TICKET-02`, `05`, `06`, `08`, `09`, `13`, `15`, `16`.

## Key Assumptions to Validate

- [ ] A 3–4 hour estimate holds for an agent ticket — test with `TICKET-02`; re-plan if it overruns 6h
- [ ] Fulan can review labels and the clinical assumptions before `TICKET-13` runs and before `TICKET-19` — schedule both slots today; his availability is now a P0 dependency

**Flagged 17 Nov:** the two review slots are the only dependency that cannot be shortened by writing more code, and neither is booked. Slot 1 (labels, `TICKET-12`) is needed by the end of 17 Nov and must precede extraction; slot 2 (clinical review, `TICKET-19`) is needed 18 Nov and blocks the deck. Materials, prompts, and a reminder checklist are in [`docs/review-slots.md`](../docs/review-slots.md).
- [ ] The exact wording of challenge requirements 1, 2, 5 and the key question can be recovered from the challenge page — 11 fill-marks block the deck
- [ ] SQLite keeps `TICKET-06`'s restart-survival test green (demo clock and timers persisted to disk, not memory)

## MVP Scope

One case, the FIT pathway, driven from `result_received` to `closed` through the API, with the audit trail and the three closure rules enforced (`TICKET-03`/`04`/`05`). That is the spine. Everything else attaches to it.

## Not Doing (and Why)

- A second pathway (`TICKET-18`) — P2, already first in the cut order
- Drop-off risk prediction — the brief forbids claiming what cannot be shown
- Workflow engine (Temporal), FHIR server (HAPI), Synthea — reasons already written in `TICKET-02`
- Docker, PostgreSQL, WSL2 — removed on 17 Nov to reduce technical complexity
- Real auth — out of scope by `TICKET-09`; only the role-picker trust line is needed
- Rewriting the tickets — the detail level is sufficient; only the four seams need text

## Open Questions

- None blocking. The three that were open on 17 Nov are closed in "Decisions closed" above.
