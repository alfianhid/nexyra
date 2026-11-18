# TICKET-02 · Set up the project and stack

- **Priority:** P0 · **Day:** 15 Nov · **Estimate:** 2–3 hours · **Assignee:** Claude Code
- **Depends on:** –
- **Status:** done (checked 18 Nov against the code). Project runs: `npm test` (317 tests in 26 files), `npm run build`, `npm run typecheck:server`, `npm run demo:reset`. Stack as in `tickets/README.md` (libSQL replaced better-sqlite3).

## Goal

A project skeleton that runs and can be tested with a single command, so the other tickets only have to fill it in.

## Stack

The stack is chosen for the project's needs, not for what is already installed. Anything missing is installed in this ticket.

| Part | Choice | Reason |
|---|---|---|
| Application | TypeScript on Node.js | One language for the case engine, API, and interface; types help keep the state machine rules honest |
| Interface | React | The worklist and closure confirmation screens have heavy interactions, and demo quality is also judged |
| Database | SQLite, single file on disk | No Docker, no WSL2, no admin rights, so the stack runs anywhere. A single writer is enough for a demo cohort, and `BEGIN IMMEDIATE` covers atomicity where it matters. Chosen on 17 Nov over PostgreSQL via Docker Compose to cut technical complexity |
| Tests | Node's built-in test runner or Vitest | Fast, no heavy configuration |
| AI | OpenAI-compatible API | Used only in closure verification (TICKET-13). Default model `deepseek/deepseek-v4.1-flash-1017` |

Deliberately not used, with reasons:
- **Workflow engines like Temporal.** The demo needs a clock that can be advanced day by day from the screen, and that is simpler with timers in the database (TICKET-06).
- **Synthea.** Synthea does not model patients who drop out midway through the FIT pathway, so our own generator is still needed (TICKET-07).
- **FHIR servers like HAPI.** Incoming data is in the form of FHIR resources and schema-validated. A real FHIR server is only added if all P0 work is finished.

If the team is more comfortable with a different stack, replace it in this ticket now, write the decision down in `tickets/README.md`, and do not change it again afterwards.

## Scope

- Install anything missing. When this ticket was written, the work machine only had Node.js 26 and git. Nothing else is needed: no Docker Desktop, no WSL2, no admin rights.
- `git init` in the project folder `c:\Users\User\Projects\nexyra` (the earlier `D:\futurehealth-h2s` path is obsolete), with a `.gitignore` (node_modules, `*.sqlite`, `*.sqlite-journal`, `.env`).
- SQLite database file (for example `data/nexyra.sqlite`), with schema migrations run automatically on first start.
- Folder structure: `src/engine` (case engine), `src/pathways` (pathway templates), `src/verify` (closure verification), `src/ingest` (data ingest), `src/web` (API and interface), `data/` (synthetic data and test sets), `docs/`, `scripts/`.
- The contract between `src/engine` and `src/web` is written in [`docs/api.md`](../docs/api.md). Build against it; do not invent endpoints outside it.
- Commands: `npm run dev`, `npm test`, `npm run seed`, `npm run demo:reset`, `npm run eval`. Commands that do not exist yet may be stubs that print "not built yet".
- `.env.example` with `DATABASE_FILE`, `LLM_BASE_URL`, `LLM_API_KEY`, and `NEXYRA_MODEL` (default `deepseek/deepseek-v4.1-flash-1017`).
- Initial `README.md`: what must be installed (Node.js and git only), how to run, and where the database file lives.

## Out of scope

Real authentication, deployment.

## Done when

- [ ] From a clean folder, the commands in the README create the database and start the application, and a page titled Nexyra opens in the browser
- [ ] `npm test` runs and passes with one example test that touches the database
- [ ] The database schema is created automatically on first run, and the SQLite file is ignored by git
- [ ] No API keys or database data end up in git
- [ ] Everything that needs installing is listed in the README along with its version

## Notes

SQLite is the decision, not a fallback (17 Nov 2026). Docker Desktop and PostgreSQL were dropped to keep the stack simple and free of admin-rights installs. Do not reintroduce Docker in this ticket; the reason is recorded in `docs/ideas/build-readiness.md`. Consequence: the deck must not claim "deployment readiness" from containerisation — show the database file, its backup, and its restore instead. Do not commit unless the project owner asks.
