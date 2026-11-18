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

## Patient outreach ladder (TICKET-10)

Code in `server/outreach/`; templates in `server/outreach/templates/`.

- **Templates are data.** `fit-positive-result.<lang>.json` holds the message and patient-page text for one language: English and Arabic written, Urdu, Hindi and Tagalog as `draft_slot` files with no text. `fit-positive.ladder.json` holds the step deadlines (each with `"source": "unsourced, needs clinical review"`), the fictional clinic and the Atlas note. `templates.ts` validates them at import (every written language uses the same variables as English; no unknown variable; every deadline has a source) and `render` only substitutes `{name}`, `{date}`, `{place}`, `{phone}`, `{link}`, `{callback_date}`. Nothing is generated at send time.
- **Steps.** `ladder.ts` runs inside `tick()` (`server/escalation.ts`), on the demo clock. Step 1 sends the message to an open case at `result_received` (event `outreach_message_sent`, actor `system`, with the exact text, language and simulated link) and creates the case's link token. Step 2, 48 h later with no answer, opens an `outreach_call` task for the coordinator who owns the case (`outreach_staff_call_due`). Step 3, 48 h after the first call step with the case still at `result_received`, opens an `outreach_navigator` task (`outreach_navigator_assigned`); a delay reason recorded by coordination staff does the same at once. At most one step fires per case per evaluation, so the ladder climbs one rung per tick, like escalation.
- **Idempotency.** Each fired step is a row in `outreach_steps`, unique on `(case_id, run_id, step)`. A run is one visit of the case to `result_received` (`stage@stage_entered_at`), so a reopened case starts a fresh ladder. The step row, its task and its event go out in one batch; the event is built by `outreachEventStatement` in `server/events.ts`, so `events` still has one INSERT.
- **Patient page.** `outreach_links` maps an opaque token to one case. `/p/:token` (`src/pages/Patient.tsx`) reads `GET /api/patient/{token}` and offers two answers. "I understand and will come" records `patient_acknowledged` (actor role `patient`), then `patient_notified` through `applyEvent` as `system` if the case is still at `result_received` (the template lets `system` record it for this reason only), and cancels the open ladder tasks (`outreach_ladder_stopped`). "I would like a phone call" records `callback_requested` and opens a `patient_callback` task for coordination staff with a 24 h deadline; it counts as the call step. Arabic renders with `dir="rtl"` and `lang="ar"`; Latin names and the phone number are isolated (`<bdi>`, Unicode isolates in the SMS text).
- **Stopping.** The ladder stops when the patient confirms, when the case leaves `result_received` by any write, or when it closes; open ladder tasks are cancelled with an `outreach_ladder_stopped` event.
- **Navigator, with three roles in the picker.** The navigator (`act_002`) has no screen and stays unselectable (`tickets/README.md`). The program manager sees every case in the register, including the navigator task, and the outreach screen shows a navigator form that records the call under the navigator's own actor header, so the audit line names the navigator rather than the program manager.
- **Deadlines differ from Atlas on purpose.** Atlas et al. (JAMA 2023) sent letters in week 2 and calls in week 4, too slow for the 31-day referral-to-colonoscopy limit. Ours are day 0, day 2 and day 4, unsourced, and listed in `docs/assumptions.md` for clinical review.
