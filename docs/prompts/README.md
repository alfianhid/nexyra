# Prompts to finish Nexyra, phase by phase

Written 18 Nov 2026. One phase per agent session. Paste the prompt block, let the agent work,
check the "You check" list, then stop. Do not start the next phase in the same session.

Deadline context: submit 21 Nov 02:59 UTC+7. Phases 0-6 are the demo path. Phase 7+ is cut
material. If a phase runs long, skip the optional lines rather than the done-condition.

---

## Why prompts fail, and the shape that works

A prompt fails when the agent has to guess: which files, what "done" means, or how big the change is.
Every prompt below is built from five parts. Copy the shape even when you write your own.

1. **Context** - what exists now, in file names.
2. **Scope** - the one thing to build. Name the files to create or edit.
3. **Constraints** - what not to touch, which source of truth wins.
4. **Done when** - a command that passes or a screen that behaves, not an adjective.
5. **Report back** - what you want to see, so silence is not acceptance.

Rules that keep you sane:

- One phase, one concern. Never let UI and engine change in the same session.
- The agent must run something (`npm run build`, `npm test`, a browser check) before claiming done.
- `docs/api.md` is the contract. If a field is missing, extend the contract first, then the code.
- Nothing is committed unless you say so.
- After every phase: `npm run dev`, walk the five routes, look at the screen. The browser is the truth,
  not the agent's summary.

---

## Skills and MCPs: what fires on its own, and what does not

A well-written prompt does **not** automatically select a skill. Skills are chosen by matching the
task against each skill's `description` text, which is a judgement call, not a rule. The same is true
**Pair with:** `verify-and-stop`. Do not invoke any design skill.

of MCP tools: the agent uses one when it decides the tool fits the job.

Consequence: **name them.** "Follow the `test-driven-development` skill" is deterministic.
"This is a backend task" is not. Naming costs one line and removes the lottery.

### Use these here

| Phase | Skill to name | Why |
|---|---|---|
| 0 | `verification-before-completion` / `verify-and-stop` | establishes what "working" means before edits |
| 1 | `api-and-interface-design` | the seam is an interface; get the boundary right once |
| 1-2 | `incremental-implementation` | one page at a time, app never broken in between |
| 2 | `frontend-ui-engineering` | async states (loading, error, empty) without new CSS |
| 3 | `source-driven-development` + **context7** | `better-sqlite3` and Express APIs are version-sensitive |
| 4-5 | `test-driven-development` | the state machine and guards are exactly where tests pay off |
| 4-5 | `security-and-hardening` | actor header, 403 paths, no `system` role over HTTP |
| 6 | `browser-testing-with-devtools` or the **browser** tools | prove the role gate in a real browser, not by reading code |
| any | `debugging-and-error-recovery` | only when something is actually broken, not pre-emptively |
| end | `code-review-and-quality` | one review over the whole seam before recording the video |

### Do not name these

`impeccable`, `design-taste-frontend`, `hallmark`, `antislop-ui`. The visual layer is already built and
already verified (see `docs/frontend-handoff.md`). Invoking a design skill now invites a restyle you
cannot afford on 18 Nov. The one exception is `polish` on a single broken screen, and only after the
demo video exists.

### Use sparingly

More than two or three skills per phase floods the context with process text and the actual task gets
squeezed out. One primary skill, one MCP, per phase.

### The line to put in each prompt

Every phase below carries a `**Pair with:**` line. Paste it verbatim into the prompt. It is the
cheapest way to make skill use intentional instead of hopeful.

For MCPs, name the tool by what you want, not by its server id:

- **context7** - "look up the current `better-sqlite3` transaction API in context7 before writing `db.ts`"
- **browser** - "open `http://localhost:5173/cases/CX-0452/closure` and report what the confirm button does as each role"
- **memory / agentmemory** - "recall anything we already decided about the engine design before proposing one"
- **sonarqube** - "analyze `server/engine.ts`" after it is written, not before

---

## Phase 0 - Confirm the app still runs

**Goal:** you know what "working" looks like before anything changes.

```
Read docs/frontend-handoff.md. Do not change any file.

Run `npm install` and `npm run build`, then report:
- the exit code of the build,
- every file under src/ with a one-line description,
- every symbol exported by src/data.ts,
- every route in src/App.tsx.

Do not start the dev server for me. Do not edit files.
```

**You check:** build is clean; the file list matches the handoff doc.
Then run `npm run dev` yourself and click: `/cases`, `/cases/CX-0409`, `/cases/CX-0409/outreach`,
`/cases/CX-0409/closure`, `/programme`, and a bad URL. Switch the role picker on each page.

**Known drift to settle now (say it out loud in the chat, then move on):**
`src/components/Shell.tsx` defines three roles (`coordinator`, `physician`, `program_manager`);
`docs/api.md` defines four (adding `navigator`). Decide: keep three for the demo, or add `navigator`
with no screens. Whichever you choose, the rest of the phases follow it.

---

## Phase 1 - Put a seam between the pages and the data

**Pair with:** `api-and-interface-design` then `incremental-implementation`. No design skill.

**Goal:** no page imports `src/data.ts` directly. The app looks 100% identical afterwards.

```
Read docs/api.md and docs/frontend-handoff.md first.

Context: the frontend is a Vite + React 18 + TS prototype. Every page imports from src/data.ts
(`cases`, `programme`, `stages`, `getCase`, `stageIndex`) and the role comes from
src/components/Shell.tsx. docs/api.md is the contract for the server that does not exist yet.

Build the data seam only:

1. src/api/types.ts - TypeScript types for the shapes in docs/api.md: Role, Actor, CaseSummary,
   CaseListResponse, CaseDetailResponse, Verification, ProgramSummary, Clock, CaseFilter.
   Copy field names exactly as the contract writes them. Do not invent fields.
2. src/api/client.ts - a `NexyraApi` interface with:
   listCases(role, filter?), getCase(caseId, role), getVerification(caseId, role),
   getProgramme(role), confirmClosure(caseId, actor), reopenCase(caseId, actor),
   logOutreach(caseId, input, actor).
3. src/api/mock.ts - implements NexyraApi by mapping the existing src/data.ts records
   (Case, Evidence, CaseEvent, OutreachAttempt) into the contract shapes. Keep src/data.ts
   unchanged; the mock is an adapter, not a rewrite. Add a small artificial delay (~150ms)
   so loading states are real.
4. src/hooks/useAsync.ts - a hook returning { data, error, loading, reload } for a
   promise factory, and cancelling on unmount.
5. export `export const api: NexyraApi = mockApi` from src/api/index.ts.

Convert ONLY src/pages/Worklist.tsx to use useAsync(api.listCases(role, filter)).
Keep the existing JSX, class names and copy byte-for-byte; only the data source changes.
Keep `dueFigure` and `matches` behaviour.

Do not touch src/styles.css, src/data.ts, the other pages, vite.config.ts or package.json.
Run `npm run build` and report the exit code plus the diff stat.
```

**You check:** `/cases` renders the same twelve cells as before; the filters still work; the build is clean.
If anything looks different, that is a bug in the adapter, not a design change.

---

**Pair with:** `frontend-ui-engineering` for the async states, `incremental-implementation` for
one page per change.

## Phase 2 - Convert the remaining pages

**Goal:** the seam is used everywhere. Same visual result.

```
Context: src/api/ now exists (client.ts, mock.ts, types.ts, index.ts) and src/pages/Worklist.tsx
already uses useAsync(api.listCases(...)). The other pages still import src/data.ts.

Convert, one page per commit-sized change, keeping every existing class name, aria attribute and
user-visible string identical:
1. src/pages/CaseDetail.tsx - use api.getCase.
2. src/pages/Outreach.tsx - use api.getCase, and keep the log form's local state; the submit
   handler may call api.logOutreach but must still work with the mock.
3. src/pages/Closure.tsx - use api.getVerification and api.getCase. Keep the confirm/return
   controls wired but still gated by the local role for now; note in a short comment where
   `available_actions` will replace that gate.
4. src/pages/Programme.tsx - use api.getProgramme.
5. src/pages/NotFound.tsx - no data, leave it alone.

Add loading and error rendering that uses classes already present in src/styles.css
(the existing `.empty` or equivalent). Do not add new CSS. Do not change copy.

Afterwards, `grep -r "from \"../data\"" src/` must return only src/api/mock.ts.
Run `npm run build` and report the exit code.
```

**You check:** all five routes, both viewports if quick (1440 wide, then narrow). No layout shift,
no missing text. Loading flash is acceptable, ugly error text is not.

---
**Pair with:** `source-driven-development`, and look up the current `better-sqlite3` and Express
APIs in context7 before writing `db.ts`.


## Phase 3 - Server skeleton and the database

**Goal:** a real SQLite file, created automatically, with the actors and the three demo cases.

```
Read tickets/TICKET-02.md, tickets/TICKET-03.md, tickets/TICKET-17.md and docs/api.md.

Deliberate deviation to follow: the frontend stays in src/. The server goes in server/.
Do not move or rename anything under src/. Record that deviation in tickets/README.md
under "Decisions made" as a one-line note.

Build:
1. package.json: add dependencies better-sqlite3 and express; devDependencies tsx, vitest,
   @types/express, @types/better-sqlite3. Add scripts: "server": "tsx watch server/index.ts",
   "seed": "tsx server/seed.ts", "test": "vitest run", "demo:reset": "tsx server/reset.ts".
2. .env.example with DATABASE_FILE, LLM_BASE_URL, LLM_API_KEY, NEXYRA_MODEL.
3. .gitignore: node_modules, data/*.sqlite*, .env.
4. server/db.ts - open the SQLite file at data/nexyra.sqlite, WAL mode, and create tables if
   missing: actors, cases, events, tasks, documents, extractions. Columns follow TICKET-03;
   events is append-only with actor_id, actor_role, occurred_at, recorded_at, type, payload JSON.
5. server/seed.ts - idempotent seed with the three demo cases from TICKET-17 plus the actors used
   by src/components/Shell.tsx. Upsert, so running it twice does not duplicate.
6. server/index.ts - Express on port 3001 with GET /api/clock and GET /api/cases returning
   deliberately hardcoded-but-contract-shaped JSON for now.
7. server/db.test.ts - one test that opens a temp database, inserts an event, reads it back,
   and asserts the append-only table rejects an update (or documents why it does not).

Run `npm test` and `npm run seed`, then report output. Do not touch the frontend.
```

**You check:** `data/nexyra.sqlite` exists and is git-ignored; `npm test` passes;
**Pair with:** `test-driven-development` (write the role/action table as a failing test first) and
`security-and-hardening` for the header validation. Run the `sonarqube` analysis on
`server/engine.ts` afterwards.

`curl http://localhost:3001/api/cases` returns JSON.

---

## Phase 4 - Actor header and the engine's one source of truth

**Goal:** the rules live in one place, and both the guard and `available_actions` come from it.

```
Read tickets/TICKET-05.md and docs/api.md ("Actor and trust model" and "Reads" sections).

Build in server/:
1. server/actor.ts - Express middleware reading `X-Nexyra-Actor` as JSON
   { actor_id, role, display_name }. Reject a missing header, a role of "system", an unknown
   actor_id, and a header role that disagrees with the stored role - all 403 role_not_permitted
   with the { error: { code, message } } envelope.
2. server/engine.ts - the FIT pathway stage machine from TICKET-05: legal transitions, the three
   closure conditions, the permission table from docs/api.md. Export ONE function
   `availableActions(caseRow, role)` and have every guard call it. The endpoint and the payload
   must never disagree.
3. Implement GET /api/cases/:case_id returning the full case view from the contract, including
   `available_actions`, `stages`, `timeline`, `documents`, `tasks`, and `verification.status`.
4. Implement GET /api/cases as a real query with `role` and `filter` (late, unowned,
   awaiting_closure_confirmation), ordered server-side.
5. server/engine.test.ts - a table-driven test: for each role, which actions are allowed at each
   stage. Include the negative cases (system cannot confirm closure, coordinator cannot confirm).

Run `npm test`. Report the passing test names.
```
**Pair with:** `test-driven-development`, then `security-and-hardening` over the guards.


**You check:** read `server/engine.ts` yourself. If `available_actions` is computed anywhere else,
send it back.

---

## Phase 5 - The three writes the demo actually needs

**Goal:** the screen can change the world, and the server refuses illegal changes.

```
Context: server/engine.ts exports availableActions(); server/actor.ts validates the actor header.

Implement, all going through the engine and writing an event row (never a bare table update):
1. POST /api/cases/:case_id/closure/confirm - no body; 409 closure_conditions_unmet with
   details { final_outcome, evidence_attached, physician_confirmation }.
2. POST /api/cases/:case_id/reopen - writes a `reopened` event and assigns an owner.
3. POST /api/tasks/:task_id/complete - body { outcome, delay_reason? } where delay_reason is one
   of fear, transport, cost, language, other.
4. POST /api/cases/:case_id/events - body { type, payload }, validated against the pathway
   template; 409 invalid_transition.
5. GET /api/cases/:case_id/verification - read from the extractions table; if no row exists,
   return proposal "needs_human_reading" with fields: []. Do not call a model yet.

Every response is the updated case view plus `recorded`. Add vitest coverage for each guard:
an illegal transition, a wrong role, a missing header.
Run `npm test` and report which endpoints are covered by which test.
```
**Pair with:** `incremental-implementation`, and verify in a real browser rather than by reading
code. In the verification step, open the closure route and report the button state per role; do not
close this phase on the agent's summary alone.


**You check:** try to confirm closure as coordinator with `curl`; you must get 403.

---

## Phase 6 - Connect the frontend for real

**Goal:** one line flips mock to HTTP. The role picker drives the actor header.

```
Context: src/api/index.ts exports `api`. src/api/http.ts does not exist yet.
The dev server must talk to the server on port 3001.

1. vite.config.ts - add server.proxy so "/api" forwards to http://localhost:3001. Leave the
   react plugin and everything else untouched.
2. src/api/http.ts - implement NexyraApi with fetch. Base path "/api". Every mutating call sends
   the X-Nexyra-Actor header built from the role picker's actor (add actor ids to a small
   src/api/actors.ts mapping: coordinator -> R. Haddad, physician -> Dr. Fulan,
   program_manager -> A. Al Suwaidi). Parse the { error: { code, message } } envelope and throw
   a typed ApiError so a page can render the message.
3. src/api/index.ts - switch the export to httpApi, keep mockApi exported for tests.
4. src/components/Shell.tsx - keep the same select and copy, but expose the full actor
   (id, role, display_name) through the context, not just the role string.
5. src/pages/Closure.tsx - replace the local role gate with the case payload's
   `available_actions`. Keep the disabled state and its explanatory sentence verbatim; only the
   source of the boolean changes.

Do not restyle anything. Run `npm run build`, then with both `npm run server` and `npm run dev`
running, verify seven routes in the browser and report what each returned.
```

**You check:** `/closure` as coordinator shows confirm disabled with the reason; switched to
physician it enables. That is the reviewer-visible proof that the server owns the rules.

---

## Phase 7 - Demo clock

```
Read tickets/TICKET-06.md and docs/api.md (GET /api/clock, and the occurred_at vs recorded_at rule).

Implement the demo clock: a clocks table row holding the demo now and day offset,
POST /api/clock/advance (days), and timers that fire on advance to escalate late and unowned
cases. Replace the hardcoded timestamp in src/components/Shell.tsx with api.getClock().
Every escalated case must still print a negative number and the word "escalated" - that
requirement is in docs/frontend-handoff.md.

Test: advancing the clock twice produces the same escalation once, never twice (idempotent).
Run `npm test`, then `npm run demo:reset` and report the resulting case list.
```

**You check:** the clock in the header moves; the worklist changes; reset restores exactly
the three demo cases.

---

## Phase 8 - Optional, only if Phases 0-7 are done and the video is recorded

- **Extraction with citations** (`TICKET-13`): cached results first, live model only when a key exists.
  `POST /api/cases/:id/verification` must be idempotent per report text hash.
- **Unowned list and event stitching** (`TICKET-08`): `GET /api/unowned`, `GET /api/ingest/unstitched`.
- **Programme view** (`TICKET-16`): `GET /api/program/summary`, funnel computed from `events`.
- **Second pathway** (`TICKET-18`): cut first.
- **HL7 v2 ingest** (`TICKET-25`): documentation only.

---

## Recovery prompts (when a phase goes wrong)

**The agent claims done but nothing changed in the browser.**

```
You reported this phase done. Prove it: list every file you changed with a one-line reason,
paste the exact command output you ran, and state which route you loaded in the browser.
If you did not load a route, say so plainly and stop.
```

**The agent edited UI and server in the same session.**

```
Stop. This phase was supposed to touch only <scope>. Show me `git diff --stat`. Revert every
change outside <scope> and redo only the in-scope part.
```

**The shapes no longer match the contract.**

```
Compare src/api/types.ts against docs/api.md field by field and print a table of mismatches
(contract field, code field, verdict). Change the code, not the contract, unless I say otherwise.
```

**You are out of time.**

```
We have <n> hours. Rank the remaining work by what the demo video needs to be truthful, cut
everything else, and write the cut list into tickets/README.md under "Cut order".
```

---

## What not to ask for

Do not ask the agent to "finish the backend", "improve the code", or "make it production ready".
Those have no done-condition, so they produce churn. Name the endpoint, the file, the test, or the
route. That is the whole skill; everything above is just that rule repeated eight times.
