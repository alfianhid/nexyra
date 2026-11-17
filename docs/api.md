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

**Permission table** (also enforced in the engine, per `TICKET-05`):

| Action | coordination staff | navigator | responsible physician | program manager |
|---|---|---|---|---|
| Advance stages up to `referral_sent` | yes | yes | yes | no |
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
      "stage": "referral_received",
      "stage_label": "Referral received",
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
    "stage": "pathology_ready",
    "stage_label": "Pathology ready",
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
  "stages": [ { "key": "result_received", "state": "passed", "label": "Result received", "short_label": "Result" }, { "key": "pathology_ready", "state": "current", "label": "Pathology ready", "short_label": "Ready" } ],
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

`{ "now": "...", "is_demo": true, "day": 3, "referral_limit_days": 31 }`.

`referral_limit_days` is optional: the `clock` object embedded in a read response carries only `now`, `is_demo` and `day`. A client that needs the limit asks `/api/clock`.

## Writes

All writes go through the engine. None of them writes a table directly. Every successful write returns the updated case view plus `{ "recorded": "<event_id>" }`, so the caller can confirm which event it produced.

### `POST /api/cases/{case_id}/events`

The single way a human advances a case.

```json
{ "type": "patient_confirmed", "payload": { "channel": "patient_page" } }
```

The server validates the transition against the pathway template (`TICKET-05`) and rejects illegal ones with `409 invalid_transition`. It never trusts a client-supplied stage. Response is the updated case view plus `{ "recorded": "e_92" }`.

### `POST /api/cases/{case_id}/closure/confirm`

Clinician closure (`TICKET-05`, `TICKET-15`). Takes no body beyond the actor header. Returns `409 closure_conditions_unmet` with a list of which of the three conditions failed, so the UI can show them without re-deriving the rules:

```json
{ "error": { "code": "closure_conditions_unmet", "message": "Closure requires all three conditions.", "details": { "final_outcome": true, "evidence_attached": false, "physician_confirmation": true } } }
```

`details` is optional and present only where this document shows it; every other error carries `code` and `message` alone. A client that drops `details` is still correct, but must not re-derive the failed conditions itself.

### `POST /api/cases/{case_id}/reopen`

Clinician reopen. Writes a `reopened` event and assigns an owner, never leaves the case unowned (`TICKET-05`, `TICKET-17` case 3).

### `POST /api/cases/{case_id}/proposal/reject`

Body: `{ "reason": "..." }`. Records the rejection and the divergence, which `TICKET-16` counts.

### `POST /api/cases/{case_id}/verification`

Runs extraction and stores the result as an event with prompt version and model (`TICKET-13`). Returns the same shape as the `GET`. Idempotent per report: if the text hash is already cached, returns the cached result and does not call the model again. With no key and no cache, returns `proposal: "needs_human_reading"`.

### `POST /api/tasks/{task_id}/complete`

Body: `{ "outcome": "connected", "delay_reason": "fear" }`. `delay_reason` is one of `fear`, `transport`, `cost`, `language`, `other` (`TICKET-10`). Free text is not stored as a reason; it goes in the event payload only.

### `POST /api/patient/{token}/response`

The patient page, unauthenticated by design. Body: `{ "response": "understood" }` or `{ "response": "request_call" }`. The token is opaque and maps to one case; it grants nothing beyond these two actions.

### `POST /api/ingest/fhir`

Batch of FHIR resources (`TICKET-07`, `TICKET-08`). Returns per-resource outcome: `created_case`, `stitched`, `queued_unstitched`, or `rejected` with a reason. Nothing is silently discarded.

### `POST /api/clock/advance`

Body: `{ "days": 1 }` or `{ "until": "next_deadline" }` (`TICKET-06`). Runs `tick(now)` and returns the new clock plus a count of what changed (`{ "escalations": 2, "cases_advanced": 0 }`). Repeated calls at the same `now` must produce no additional escalations; the guard lives in the engine, and the test calls this endpoint twice.

### `POST /api/clock/reset`

Demo only. Sets the demo clock to day 0. `npm run demo:reset` (`TICKET-17`) calls this after reseeding. It is not exposed in the normal UI.

## What the client may not do

- Compute a deadline, a stage, or `days_left_*`. Read them from the server.
- Decide whether closure is allowed. Show the server's `closure_conditions_unmet` details instead.
- Store extraction results or citations. Read them from `/verification`.
- Send a stage along with an event. The event `type` selects the transition; the server knows where the case is.

## Model and provider

`NEXYRA_MODEL` defaults to `deepseek/deepseek-v4.1-flash-1017`, called through an OpenAI-compatible chat completions endpoint (`LLM_BASE_URL`, `LLM_API_KEY`). Not Anthropic. Whatever model string is live is recorded, with the prompt version, in `docs/evaluation-results.md` (`TICKET-14`), so the published numbers name the model that produced them.
