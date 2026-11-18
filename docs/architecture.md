# Nexyra architecture

Short notes on how the server is put together. The HTTP contract is in [`api.md`](api.md).

## Storage schema

SQLite dialect through libSQL (`server/db.ts`): a local file in development and tests, Turso when deployed.

| Table | Holds |
|---|---|
| `events` | The record. `id`, `case_id`, `type`, `actor_id`, `actor_role`, `occurred_at` (demo clock), `recorded_at` (real time), `payload` (JSON). Append-only: database triggers reject every `UPDATE` and `DELETE`. |
| `cases` | Identity (patient, `pathway_id`) plus a cache of the status columns: `stage`, `status`, `owner_actor_id`, `final_outcome`, `stage_entered_at`. |
| `actors` | Who can act, with one role each (`coordination_staff`, `navigator`, `responsible_physician`, `program_manager`, `patient`, `system`). |
| `tasks` | Work for a person: owner, deadline, status. |
| `documents` | Colonoscopy and pathology report text attached to a case. |
| `extractions` | Cached report extractions, keyed by text hash. |
| `clocks`, `timers` | The demo clock (one row) and one row per escalation that fired. |

The status columns on `cases` are a cache. `rebuildCase(caseId)` in `server/events.ts` replays the case's events in recorded order through the engine's `nextState` step and writes the result back. Every write goes through the same step (`applyEvent` computes the next row from the event it is about to store), so a write and a rebuild cannot disagree; `server/caseEngine.test.ts` wipes the columns of every seeded case and checks the rebuild reproduces them. The seed builds its case rows the same way and refuses to run if a demo case's events do not lead to the state its story describes.

## Pathway template

A screening pathway is data, not code (TICKET-04). The FIT pathway is `server/pathways/fit-colonoscopy.json`; `server/pathways/index.ts` validates it by hand and the engine reads the result. `server/engine.ts` names no stage and no deadline; a test reads its source to keep it that way.

The template holds:

- **`trigger`**: the event that creates a case (`case_created`, from a positive FIT) and the stage it starts in.
- **`stages`**, in pathway order. Each has `owner_role`, `sla_hours` (hours from entering the stage), `urgency` (worklist order, lower first), an `escalation` ladder (level *n* alerts the *n*-th role), `exits` (which event moves the case to which stage, backward paths included) and a `source`.
- **`events`**: for each event type, the roles that may record it and what it does to the owner (`keep`, `clear` for the explicit unowned state, `assign`, `assign_if_unowned`). Closing events are flagged `closure`.
- **`outcomes`**: the three closure outcomes, each with the document kinds it requires as evidence.
- **`limits`** across stages. The only one is referral → colonoscopy ≤ 31 days.
- **`actions`**: which roles see which case action, and which event an action records.

**Sources.** Only the 31-day referral-to-colonoscopy limit has one ("HAAD standard, cited in BMC Cancer 2021"). Every stage deadline and every outcome's evidence rule says `"unsourced, needs clinical review"`. These are starting values for the clinical review (TICKET-19), which works from the printout of `npm run pathway:deadlines`.

**Validation.** The loader collects every problem before it fails, then throws `PathwayTemplateError` naming the file and each bad field. The template is imported by the engine, so a broken file stops `npm run server`, the Vercel function and every test at startup. Besides types, it checks that exits point at real stages and events, that every open stage can move forward, that only closure events reach the terminal stage, that no closure event lists `system` or `coordination_staff`, that the creation event assigns an owner, and that the stage deadlines inside a limit add up to no more than the limit.

**Adding a pathway** (TICKET-18) means writing a second JSON file and registering it in `server/pathways/index.ts`. The engine currently runs the default pathway for every case; routing by `cases.pathway_id` is the remaining step.
