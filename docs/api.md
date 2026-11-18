# Nexyra API contract

Written 17 Nov 2026. This closes the seam between `src/engine` (the case engine) and `src/web` (the API and interface). It is the contract both sides are built against, so neither ticket has to guess what the other exposes.

Scope: the HTTP surface for the prototype. It is deliberately small. Anything not listed here is not built.

## Ground rules

- **Base path:** `/api`. JSON in, JSON out, `Content-Type: application/json`, UTF-8.
- **Errors:** every failure returns `{ "error": { "code": "...", "message": "..." } }` with the status code. Codes are stable strings (`invalid_transition`, `role_not_permitted`, `closure_conditions_unmet`, `not_found`, `validation_failed`); the message is for humans and may change.
- **The server owns the rules.** Every rule in `TICKET-05`, `TICKET-06`, and `TICKET-13` is enforced here, not in the UI. The UI hides buttons it knows will fail; the server still rejects the call. A test calls each guarded endpoint directly.
- **No state in the client.** The timeline, stage list, days remaining, and available actions all come from the server. The client never computes a deadline or derives a stage.
- **Timestamps:** ISO 8601 with offset. `occurred_at` is demo-clock time (TICKET-06); `recorded_at` is real time. Responses carry both where they differ.
- **No authentication** (out of scope by `TICKET-09`). Identity is the role picker, described under "Actor and trust model" below.

## Pathway stages and events

The stage list, deadlines, owners, escalation ladders, outcomes and the evidence each outcome needs come from the pathway template `server/pathways/fit-colonoscopy.json` (TICKET-04; see `docs/architecture.md`). `npm run pathway:deadlines` prints the deadlines with their sources. Every `stages[]` array in a response follows this order; the client renders what it receives and keeps no copy of the list.

| # | Stage key | Moved on by (event → next stage) |
|---|---|---|
| 1 | `result_received` | `patient_notified` → `patient_notified` |
| 2 | `patient_notified` | `referral_sent` → `referral_sent` |
| 3 | `referral_sent` | `referral_accepted` → `referral_accepted`; `referral_rejected` → `patient_notified`, owner cleared (unowned) |
| 4 | `referral_accepted` | `colonoscopy_booked` → `colonoscopy_booked` |
| 5 | `colonoscopy_booked` | `colonoscopy_performed` → `procedure_completed` |
| 6 | `procedure_completed` | `pathology_ordered` → `pathology_ordered`; `procedure_incomplete` → `referral_sent` |
| 7 | `pathology_ordered` | `pathology_received` → `pathology_received`; `procedure_incomplete` → `referral_sent` |
| 8 | `pathology_received` | `closure_proposed` → `closure_proposed`; `procedure_incomplete` → `referral_sent` |
| 9 | `closure_proposed` | `closure_confirmed` → `closure_confirmed` (or straight to `closed` from the closure endpoint); `procedure_incomplete` → `referral_sent` |
| 10 | `closure_confirmed` | `case_closed` → `closed`; `reopened` → `result_received` |
| 11 | `closed` | `reopened` → `result_received` |

Two events do not move the stage the usual way: `case_created` (the trigger, written by the engine or an ingest, payload `{ "owner_actor_id": "..." }`) and `owner_assigned` (any open stage, payload `{ "owner_actor_id": "..." }`; omitted means the caller takes the case). Event payload fields the engine reads: `outcome` (one of the three outcomes; recorded on the case), `owner_actor_id` (for events that assign an owner; the engine writes the owner it chose into the stored payload so the timeline alone can rebuild the case). `finalises` is reserved for the closure endpoint and is stripped from client payloads. `procedure_incomplete` and `reopened` clear the recorded outcome.

Event types outside the template (`outreach_attempted`, `task_completed`, `deadline_missed`, `extraction_completed`, and anything a later ticket adds) are history: they appear in the timeline but do not change the stage, owner or outcome.

## Actor and trust model

There is no login. The prototype still needs the server to know *who* is acting, because `TICKET-05` forbids closure by the `system` role or by coordination staff, and `TICKET-09`/`TICKET-15` require the server to reject a call made directly even when the UI hides the button.

**How identity travels.** Every mutating request carries one header:

```
X-Nexyra-Actor: {"actor_id":"act_003","role":"responsible_physician","display_name":"Dr Amal S."}
```

A JSON object, because the role picker switches all three fields together. The server reads it, validates it against the `actors` table (TICKET-03), and stamps `actor_id` and `actor_role` onto every event it creates. If the header is missing or names an actor not in the table, the request fails with `403 role_not_permitted` — it never falls back to a default actor.

**What the server will not accept:**

- `role: "system"` in the header. The `system` role exists only for events the engine writes itself (timers, ingests, AI extraction). Any request claiming it is rejected with `403`.
- An `actor_id` whose stored role differs from the `role` in the header. The stored role wins for permission checks; a mismatch is rejected rather than silently trusted.

**What this is not.** This is not security. A prototype user can send any actor they like, and the deck must not claim otherwise. What it *does* guarantee is that no event can be recorded without an actor that exists, that the closure guard cannot be bypassed by omitting a role, and that a demo cannot accidentally attribute a clinician decision to the system. `docs/limitations.md` must say this plainly.

**Permission table** (also enforced in the engine, per `TICKET-05`). Which role may record which stage event is data in `server/pathways/fit-colonoscopy.json` (`events.<type>.roles`); the table below summarises it. Telling the patient the result (`patient_notified`) is outreach work, so it is coordination staff and navigators only.

| Action | coordination staff | navigator | responsible physician | program manager |
|---|---|---|---|---|
| Advance a stage before closure (per event: the template's `roles`) | yes | yes | yes, except `patient_notified` | no |
| Record an incomplete examination (`procedure_incomplete`) | no | no | yes | no |
| Record patient outreach outcome | yes | yes | no | no |
| Assign owner to an unowned case | yes | yes | yes | no |
| Answer a consultation | no | no | yes | no |
| Confirm closure | no | no | yes | no |
| Reopen a case | no | no | yes | no |
| Reject an AI proposal | no | no | yes | no |
| Read the program view | no | no | yes | yes |

## Reads

### `GET /api/cases`

Worklist rows for one role (`TICKET-09`). Query parameters:

- `role` (required) — one of the four roles above.
- `filter` (optional) — `late`, `unowned`, `awaiting_closure_confirmation`. Omitted means all tasks for that role.

Ordered server-side by clinical urgency from the pathway template, then by time remaining to the stage deadline (`TICKET-09`). The client must not re-sort.

```json
{
  "clock": { "now": "2026-11-03T09:00:00+07:00", "is_demo": true, "day": 0 },
  "counts": { "open": 142, "unowned": 14, "past_deadline": 2, "awaiting_clinician": 5, "closed_this_week": 38 },
  "cases": [
    {
      "case_id": "c_018",
      "patient": { "display_name": "Patient 018", "age": 61, "language": "ar" },
      "stage": "referral_accepted",
      "stage_label": "Referral accepted",
      "owner": { "actor_id": "act_002", "display_name": "Nur H.", "role": "navigator" },
      "hours_left_stage": 96,
      "days_left_stage": 4,
      "days_left_referral_limit": 22,
      "flags": ["late"],
      "flags_renderable": ["LATE — 4 days over", "Unowned since 2 Nov"]
    }
  ]
}
```

`days_left_referral_limit` counts down the pathway's 31-day referral-to-colonoscopy limit (the template's one sourced deadline: HAAD standard, cited in BMC Cancer 2021). The count starts when the case first entered `referral_sent` and stops when it first reached `procedure_completed`; before the referral is sent it runs from the result, which is never more lenient than the limit. It can be negative.

`flags_renderable` exists because `TICKET-09` requires status to be readable without colour: the UI prints these strings next to a shape marker, and never relies on a red dot.

**The two deadline fields are related, not alternatives.** `hours_left_stage` is the signed distance to the stage deadline in hours and is the only figure with sub-day precision; it is `null` when the case is closed. `days_left_stage` is that same distance rounded to the nearest whole day, for displays that print days. Both are computed by the server. The client reads whichever one it prints and never multiplies, divides, or counts down: printing hours below 48 and days above is a choice between two server fields, not a calculation.

`flags` is a closed set of lowercase machine strings: `late`, `unowned`, `due` (stage deadline within 48 hours), `closed`. The UI uses them for `data-state` and for choosing a badge, never as the only carrier of meaning — `flags_renderable` carries the words.

`patient.age` is sent separately from `display_name` because screens print the two in different places and with different typography; folding age into the name string would make the presentation of a second value the server's problem. `display_name` is a name only.

`counts` is the register's own summary, scoped to what the calling role may see. It is not the program view: a coordinator receives it on the worklist without holding `GET /api/program/summary`. `closed_this_week` appears in both because both screens print it; neither copies the other's number.

### `GET /api/cases/{case_id}`

Everything the case detail page needs in one call (`TICKET-09`): timeline, stages passed and ahead, documents, open tasks, and the actions valid *for the caller's role*.

```json
{
  "case": {
    "case_id": "c_018",
    "patient": { "display_name": "Patient 018", "age": 61, "language": "ar" },
    "stage": "pathology_received",
    "stage_label": "Pathology received",
    "owner": { },
    "status": "open",
    "stage_due_label": "18 Nov 09:00",
    "final_outcome": null,
    "outcomes": [
      { "key": "returned_to_routine_screening", "label": "Returned to routine screening" },
      { "key": "surveillance_scheduled", "label": "Surveillance scheduled" },
      { "key": "oncology_accepted_therapy_started", "label": "Oncology accepted, therapy started" }
    ]
  },
  "stages": [ { "key": "result_received", "state": "passed", "label": "Result received", "short_label": "Result" }, { "key": "pathology_received", "state": "current", "label": "Pathology received", "short_label": "Received" } ],
  "timeline": [ { "event_id": "e_91", "type": "pathology_recorded", "actor": { }, "occurred_at": "...", "recorded_at": "...", "summary": "Pathology report attached", "payload": { } } ],
  "documents": [ { "document_id": "d_4", "kind": "pathology", "title": "Pathology report" } ],
  "tasks": [ { "task_id": "t_7", "kind": "confirm_closure", "owner": { }, "due_at": "...", "status": "open" } ],
  "outreach_attempts": [
    { "n": 1, "at": "17 Nov 10:05", "channel": "call", "result": "No answer", "minutes": 3 }
  ],
  "available_actions": ["confirm_closure", "reopen_case", "reject_proposal"],
  "verification": { "status": "ready", "proposal": "reopen" }
}
```

`available_actions` is computed by the engine from the caller's role plus the case state. This is what stops the UI and the guards from drifting apart: one function produces both.

`stage_due_label` is the stage deadline written as display text, in the same spirit as `flags_renderable`: the server formats it, the client prints it, and no page derives a date. `final_outcome` is the outcome already recorded on the case, or `null`. `outcomes` is the closed vocabulary a closure decision may choose from, sent with its labels so the screen does not carry a second copy of either.

`outreach_attempts` is the ladder as its own array. It is a projection of the timeline, not a second source of truth: the engine appends the event and derives the ladder from it, so the two cannot disagree. The client reads the ladder instead of parsing event payloads.

`short_label` is the abbreviation the stage strip prints in its narrow column, alongside the full `label` used in the case header. A timeline event whose `actor` is `null` was written by the engine itself; the UI prints `system` for it.

### `GET /api/cases/{case_id}/verification`

The two-pane closure screen (`TICKET-15`): report text plus extraction fields with citations.

```json
{
  "report": { "document_id": "d_4", "text": "..." },
  "extraction": {
    "prompt_version": "v1",
    "model": "deepseek/deepseek-v4.1-flash-1017",
    "fields": [
      { "key": "complete_exam", "value": "no", "quote": "The cecum was not reached.", "quote_offset": [312, 339], "source": "pathology-15-11.pdf", "read_at": "2026-11-17T09:14:00+07:00", "validated": true },
      { "key": "adequate_prep", "value": "no", "quote": "Preparation was inadequate.", "quote_offset": [140, 170], "source": "pathology-15-11.pdf", "read_at": "2026-11-17T09:14:00+07:00", "validated": true },
      { "key": "pathology_available", "value": "unknown", "quote": null, "quote_offset": [0, 0], "source": "pathology-15-11.pdf", "read_at": "2026-11-17T09:14:00+07:00", "validated": false }
    ],
    "proposal": "reopen",
    "proposal_reason": "Incomplete exam and inadequate prep"
  }
}
```

`quote_offset` is what makes citation highlighting land on the right sentence (`TICKET-15` done-when). The server computes the offset by locating the quote in the text; the client never searches for it. A field with `validated: false` renders as "not found in the report".

`source` and `read_at` are provenance, and `docs/frontend-handoff.md` requires all three of source, offset and read time on every extracted value. `read_at` is the real time the report was read, which is why it is not the same clock as `occurred_at`. A field with no quote sends an empty `quote_offset` and keeps `source` and `read_at`.

### `GET /api/unowned`

The dedicated unowned list (`TICKET-08`), one query, no client-side filtering. Each row carries `unowned_since` and the trigger that caused it.

### `GET /api/program/summary`

The program view (`TICKET-16`). Every row shape is fixed here so the page never guesses:

```json
{
  "counts": { "open": 142, "unowned": 14, "due_today": 4, "closed_this_week": 38 },
  "exceptions": [
    { "case_id": "c_018", "reason": "Unowned 26h", "owner": "—", "due_at": "2026-11-18T12:00:00+07:00" }
  ],
  "funnel": [
    { "stage": "Result received", "open": 34, "unowned": 14 }
  ],
  "escalations_per_role_per_day": [
    { "role": "responsible_physician", "per_day": 2 }
  ],
  "delay_reasons": [
    { "delay_reason": "fear", "count": 6 }
  ],
  "synthetic_data_label": "Synthetic data. Drop-off rates are input assumptions, not results."
}
```

`reason` and `owner` are renderable strings, not enums: the page prints them as written. `due_at` is an ISO 8601 timestamp, unlike `dueLabel` in the prototype's fixtures. `delay_reason` uses the same five values as `POST /api/tasks/{task_id}/complete`.

`counts` here is the programme's own summary and is distinct from the register `counts` in `GET /api/cases`: `due_today` and `closed_this_week` belong to the program view, `past_deadline` and `awaiting_clinician` belong to the worklist.

Funnel numbers are computed from the `events` table at request time, never stored, so they cannot drift from the timeline.

### `GET /api/ingest/unstitched`

Events that matched no case (`TICKET-08`), so they are visible instead of silently dropped.

### `GET /api/clock`

`{ "now": "...", "is_demo": true, "day": 3, "referral_limit_days": 31, "label": "20 Nov 2026 · 11:42" }`.

`referral_limit_days` is optional: the `clock` object embedded in a read response carries only `now`, `is_demo` and `day`. A client that needs the limit asks `/api/clock`.

`label` is the header text, formatted by the server for the same reason `stage_due_label` is: the client prints it and never derives a date. The demo clock is stored, so it survives a restart.

## Writes

All writes go through the engine. None of them writes a table directly. Every successful write returns the updated case view plus `{ "recorded": "<event_id>" }`, so the caller can confirm which event it produced.

### `POST /api/cases/{case_id}/events`

The single way a human advances a case.

```json
{ "type": "patient_notified", "payload": { "channel": "patient_page" } }
```

The server validates the transition against the pathway template (`TICKET-05`) and rejects illegal ones with `409 invalid_transition`. It never trusts a client-supplied stage. Response is the updated case view plus `{ "recorded": "e_92" }`.

### `POST /api/cases/{case_id}/closure/confirm`

Clinician closure (`TICKET-05`, `TICKET-15`). Takes no body beyond the actor header. Returns `409 closure_conditions_unmet` with a list of which of the three conditions failed, so the UI can show them without re-deriving the rules:

```json
{ "error": { "code": "closure_conditions_unmet", "message": "Closure requires all three conditions.", "details": { "final_outcome": true, "evidence_attached": false, "physician_confirmation": true } } }
```

`details` is optional and present only where this document shows it; every other error carries `code` and `message` alone. A client that drops `details` is still correct, but must not re-derive the failed conditions itself.

**Optional body.** The closure screen lets the physician pick the outcome, and that choice has to reach the server, so the endpoint accepts one optional field:

```json
{ "final_outcome": "returned_to_routine_screening" }
```

When it is absent the case's own recorded outcome is what the three conditions judge, so a caller that sends nothing still behaves as first described. An unknown key fails with `400 validation_failed` rather than being silently ignored.

**It finalises the case.** The physician's confirmation is the act that closes it, so this endpoint writes one `closure_confirmed` event and moves the case straight to `closed`. The `closure_confirmed` stage exists in the stage strip as the step between proposal and closure; the generic events endpoint can still walk it explicitly with `closure_confirmed` then `case_closed`.

### `POST /api/cases/{case_id}/reopen`

Clinician reopen. Writes a `reopened` event and assigns an owner, never leaves the case unowned (`TICKET-05`, `TICKET-17` case 3).

### `POST /api/cases/{case_id}/outreach`

Records one patient outreach attempt (`TICKET-10`). Body: `{ "outcome": "no_answer", "channel": "call", "delay_reason": "fear" }`.

- `outcome` (required) is free text and becomes the ladder's `result`.
- `channel` is `call`, `sms` or `letter`; omitted means `call`.
- `delay_reason` is the same closed set as `POST /api/tasks/{task_id}/complete`. Free text belongs in `note`.
- `minutes` is optional.

Contacting a patient does not advance a case, so this endpoint appends an `outreach_attempted` event and leaves the stage where it is. The case view's `outreach_attempts[]` is derived from those events, so the ladder and the timeline cannot disagree. Only coordination staff and navigators may call it (`log_outreach` in the permission table), and never on a closed case.

### `POST /api/cases/{case_id}/proposal/reject`

Body: `{ "reason": "..." }`. Records the rejection and the divergence, which `TICKET-16` counts.

### `POST /api/cases/{case_id}/verification`

Runs extraction and stores the result as an event with prompt version and model (`TICKET-13`). Returns the same shape as the `GET`. Idempotent per report: if the text hash is already cached, returns the cached result and does not call the model again. With no key and no cache, returns `proposal: "needs_human_reading"`.

Requires the `X-Nexyra-Actor` header (any human role). Optional body `{ "document_id": "d_4" }`; without it the case's most recently attached `colonoscopy` or `pathology` document is read. One document is read per extraction, because `quote_offset` is an offset into that one document's text.

What it writes: one `extractions` row (keyed by the sha256 of the report text) and one `extraction_completed` event with `actor_role: "system"` and a payload of `{ prompt_version, model, proposal, proposal_reason, document_id, text_hash, extraction_id, requested_by }`. Both are written only when the model actually read the report: a cache hit and an unavailable result write nothing. It never touches the case row, so no extraction result can move, propose or close a case; closure stays `POST /closure/confirm` under `TICKET-05`'s rules.

The `POST` response adds two fields to the `GET` shape: `proposed_outcome` (the outcome key a `propose_closure` asks the physician to confirm, otherwise `null`) and `origin` (`model`, `cache`, `unavailable`, or `no_report`).

**Fields.** Always these six, in this order. A field whose citation fails validation is `unknown` with `validated: false` and `quote: null`.

| key | values |
|---|---|
| `complete_exam` | `yes`, `no`, `unknown` |
| `adequate_prep` | `yes`, `no`, `unknown` |
| `tissue_taken` | `yes`, `no`, `unknown` |
| `pathology_available` | `yes`, `no`, `unknown` |
| `outcome_category` | `normal`, `polyp`, `cancer`, `not_stated`, `unknown` |
| `next_step` | `stated`, `not_stated`, `unknown` |

**Citation validation** is done in code (`server/verify/quotes.ts`): a quote must appear in the report exactly, with only runs of whitespace treated as equal, and be at least 8 characters long. `quote_offset` is computed from the text; offsets sent by the model are ignored.

**Proposal vocabulary.** Decided by rules in `server/verify/proposal.ts`, never by the model, and always shown as an AI proposal, never as a decision. The first rule that matches wins:

| proposal | when |
|---|---|
| `reopen` | `complete_exam` or `adequate_prep` is `no` |
| `wait_for_pathology` | `tissue_taken` is `yes` and `pathology_available` is `no` |
| `needs_human_reading` | any of `complete_exam`, `adequate_prep`, `tissue_taken`, `outcome_category` (and `pathology_available` when tissue was taken) is `unknown` or `not_stated`; or the category is `cancer`; or a polyp is reported without tissue taken; or no reading exists |
| `propose_closure` | otherwise: `normal` proposes `returned_to_routine_screening`, `polyp` proposes `surveillance_scheduled` |

`cancer` never yields `propose_closure`: the outcome `oncology_accepted_therapy_started` needs evidence that oncology accepted the patient and therapy started, which a colonoscopy or pathology report does not contain.

### `POST /api/tasks/{task_id}/complete`

Body: `{ "outcome": "connected", "delay_reason": "fear" }`. `delay_reason` is one of `fear`, `transport`, `cost`, `language`, `other` (`TICKET-10`). Free text is not stored as a reason; it goes in the event payload only.

### `POST /api/patient/{token}/response`

The patient page, unauthenticated by design. Body: `{ "response": "understood" }` or `{ "response": "request_call" }`. The token is opaque and maps to one case; it grants nothing beyond these two actions.

### `POST /api/ingest/fhir`

Batch of FHIR resources (`TICKET-07`, `TICKET-08`). Returns per-resource outcome: `created_case`, `stitched`, `queued_unstitched`, or `rejected` with a reason. Nothing is silently discarded.

### `POST /api/clock/advance`

Body: `{ "days": 1 }` or `{ "until": "next_deadline" }` (`TICKET-06`). Runs `tick(now)` and returns the new clock plus a count of what changed. Repeated calls at the same `now` must produce no additional escalations; the guard lives in the engine, and the test calls this endpoint twice.

```json
{
  "clock": { "now": "2026-11-18T11:42:00+07:00", "is_demo": true, "day": 1, "referral_limit_days": 31, "label": "18 Nov 2026 · 11:42" },
  "escalations": 1,
  "cases_advanced": 0,
  "escalations_per_role": [ { "role": "responsible_physician", "count": 1 } ]
}
```

`escalations_per_role` answers the alert-fatigue question `TICKET-06` asks for: how many alerts one role received from one advance.

`cases_advanced` is always `0` in this prototype: time escalates a case, it never moves it through the pathway. Advancing the clock must not advance a stage, or the demo would show the engine closing work it cannot close.

**The ladder is paced by the clock, not backfilled.** Level 1 fires the first time a case is seen past its deadline; each further level fires at most once per `escalation_spacing_hours` (24) demo-clock hours. Level *n* alerts the *n*-th role in the stage's `escalation` ladder in the pathway template, and the ladder's length is the top level. In the FIT template every open stage escalates responsible physician → program manager → program manager, so it stops at level 3. A case that is already days late does not emit three alerts on the first advance.

**`until: "next_deadline"`** moves the clock to the earliest stage deadline still ahead of `now` (or stays put when none is ahead), then ticks. It is a demo control for showing the next escalation without counting days.

`GET /api/clock` is the read; `POST /api/clock/reset` sets day 0 and is demo-only. `POST /api/clock/tick` runs the timers without moving the clock, which is what makes the idempotency test a direct call rather than a race.

### Escalation as data

Each escalation writes three things in one transaction:

- a `deadline_missed` event, with `actor_role: "system"` and a payload of `{ level, escalated_to, stage, due_at, hours_over }`, so it appears in the audit trail like any other event;
- a `timer` row keyed by `(case_id, stage, due_at, level)`, which is what makes a second tick at the same level impossible;
- an `escalation` task owned by the escalated role, so the work shows up for that role in `GET /api/cases`.

A case that leaves a stage marks that stage's timers `cancelled`. A late case still prints a negative `hours_left_stage` and carries the `late` flag; the worklist prints "escalated" from that flag, never from a colour.

### `POST /api/clock/reset`

Demo only. Sets the demo clock to day 0. `npm run demo:reset` (`TICKET-17`) calls this after reseeding. It is not exposed in the normal UI.

## What the client may not do

- Compute a deadline, a stage, or `days_left_*`. Read them from the server.
- Decide whether closure is allowed. Show the server's `closure_conditions_unmet` details instead.
- Store extraction results or citations. Read them from `/verification`.
- Send a stage along with an event. The event `type` selects the transition; the server knows where the case is.

## Model and provider

`NEXYRA_MODEL` defaults to `deepseek/deepseek-v4.1-flash-1017`, called through an OpenAI-compatible chat completions endpoint (`LLM_BASE_URL`, `LLM_API_KEY`). Not Anthropic. Whatever model string is live is recorded, with the prompt version, in `docs/evaluation-results.md` (`TICKET-14`), so the published numbers name the model that produced them.
