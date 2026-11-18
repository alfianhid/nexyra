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

**Second pathway (TICKET-18).** Each case runs the template named by its `pathway_id`. The second template is `server/pathways/mammography-biopsy.json` (abnormal screening mammogram → diagnostic imaging → biopsy → pathology → follow-up; `npm run pathway:deadlines -- mammography-biopsy`). It is a configuration demonstration only and has not been clinically reviewed. A mammography case has its own stage keys, events, outcomes and limit, and the same response shapes as a FIT case: `stages[]`, `case.outcomes`, `available_actions` and `days_left_referral_limit` are always the case's own template's. The table below is the FIT pathway. What the payloads add:

- worklist rows (`GET /api/cases`) and unowned rows (`GET /api/unowned`) carry `pathway_id`;
- the case view carries `case.pathway`: `{ "id", "version", "label" }`;
- an event from another pathway's template is `400 validation_failed` (`"<type>" is not a case event.`);
- `GET /api/cases/{id}/outreach` on a non-FIT case is `404 not_found`: the outreach ladder and its message templates are FIT-only, and the ladder never fires for another pathway;
- `POST /api/cases/{id}/verification` on a non-FIT case returns `proposal: "needs_human_reading"` with `origin: "pathway_not_verified"` and never calls the model;
- `GET /api/program/summary` stays the FIT programme: its funnel, counts and escalations cover FIT cases only (`pathway.id` says which).

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

Event types outside the template (`outreach_attempted`, `task_completed`, `deadline_missed`, `extraction_completed`, the TICKET-10 outreach events `outreach_message_sent`, `outreach_staff_call_due`, `outreach_navigator_assigned`, `outreach_ladder_stopped`, `patient_acknowledged` and `callback_requested`, and anything a later ticket adds) are history: they appear in the timeline but do not change the stage, owner or outcome.

**Ownership and consultation events (TICKET-08, TICKET-11).** Template events that do not move the stage but change the owner or the provider:

| Event | Effect | Who records it |
|---|---|---|
| `referral_unanswered` | Owner cleared (unowned trigger 2); latest referral `expired` | system only, from `tick` |
| `patient_moved_provider` | Owner cleared (unowned trigger 3); `payload.provider_id` becomes the case's provider | system, coordination staff, navigator |
| `consultation_accepted` | `patient_notified`/`referral_sent` → `referral_accepted`; latest referral `accepted` | responsible physician, through the answer endpoint only |
| `consultation_redirected` | `patient_notified`/`referral_sent` → `referral_sent` with a new referral; old one `redirected` | same |
| `consultation_more_data_requested` | Stage unchanged; a `supply_referral_data` task for the physician who asked | same |

Every event marked `owner: "clear"` (`referral_rejected` is trigger 1) records `previous_owner_actor_id`. The three consultation answers assign an owner if the case has none (`owner_actor_id` in the answer, else the physician who asked). Posting a consultation answer to `POST /events` fails with `409 invalid_transition`. History events added: `consultation_requested`, `consultation_overdue`, `fhir_resource_stitched`.

**Referral payload.** An event that moves the case into `referral_sent` (`referral_sent` itself, and a redirected answer) may carry the referral in the shape the referral (REF) messages use under DoH Circular 144/2026: status, priority, SNOMED-coded specialty.

```json
{ "type": "referral_sent", "payload": { "referral": {
  "referral_id": "REF-4377-1", "to_provider_id": "prov_hospital_b",
  "status": "pending", "priority": "routine",
  "specialty": { "system": "http://snomed.info/sct", "code": "394584008", "display": "Gastroenterology" } } } }
```

`priority` is `routine`, `asap` or `stat` (the HL7 v2 referral priorities); `status` is `pending` (default), `accepted`, `rejected`, `expired` or `redirected`; `specialty.system` must be SNOMED CT and `code` a concept id. `referral_id` is optional (generated as `REF-<case>-<n>`). Any other shape fails with `400 validation_failed`. The referral is what stitching matches on. Status changes come from the events the template marks with `referral_status`; the client never sets them. Nexyra keeps the referral to know who owns the screening result. It does not replace e-Referral's own status tracking.

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

**Permission table** (also enforced in the engine, per `TICKET-05`). Which role may record which stage event is data in `server/pathways/fit-colonoscopy.json` (`events.<type>.roles`); the table below summarises it. Telling the patient the result (`patient_notified`) is outreach work, so it is coordination staff and navigators only; the template also lists `system`, which records it only when the patient confirms on the patient page (TICKET-10). `system` is never accepted in the actor header, so no HTTP caller can use that.

| Action | coordination staff | navigator | responsible physician | program manager |
|---|---|---|---|---|
| Advance a stage before closure (per event: the template's `roles`) | yes | yes | yes, except `patient_notified` | no |
| Record an incomplete examination (`procedure_incomplete`) | no | no | yes | no |
| Record patient outreach outcome | yes | yes | no | no |
| Assign owner to an unowned case | yes | yes | yes | no |
| Record that the patient moved provider (`patient_moved_provider`, action `record_provider_move`) | yes | yes | no | no |
| Ask a consultation (`request_consultation`) | no | no | yes | no |
| Answer a consultation | no | no | yes, only the physician it is addressed to (`to_actor_id`) | no |
| Confirm closure | no | no | yes | no |
| Reopen a case (closed: `reopened`; after the procedure and before closure: `procedure_incomplete`) | no | no | yes | no |
| Reject an AI proposal | no | no | yes | no |
| Read the program view | no | no | yes | yes |

## Reads

### `GET /api/cases`

Worklist rows for one role (`TICKET-09`). Query parameters:

- `role` (required) — one of the four roles above.
- `filter` (optional) — `late`, `unowned`, `awaiting_closure_confirmation`. Omitted means all tasks for that role.
- `cohort` (optional, `TICKET-17`) — `hide` (the default) or `include`. The synthetic cohort (about 1,000 cases with ids starting `SY-`, loaded by `npm run demo:reset`) is left out of `cases` and `counts` unless the caller sends `cohort=include`; any other value is `400 validation_failed`. Any role may send it (the rows are still scoped to that role); the UI offers it to the program manager. See "The synthetic cohort" below.

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
      "pathway_id": "fit-colonoscopy",
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

`cohort` (`TICKET-17`) says whether the synthetic cohort is in this response and how many cohort cases exist in all (not scoped to the role), so the UI can offer to show them: `"cohort": { "included": false, "cases": 1000 }`.

`counts` is the register's own summary, scoped to what the calling role may see (and to the cohort setting), and counted over the role's whole register whatever `filter` says: `filter` narrows `cases`, never `counts` (a coordinator on the empty "Unowned" filter still sees how many open cases the register holds). `register` says what that register is, in words the UI prints: `{ "scope": "cases this role owns or holds a task on, plus every open case with no owner", "total": 5 }` (`"every case"` for the program manager). Each row also carries `pathway_label`, the template's `short_label` (`"FIT → colonoscopy"`, `"Mammogram → biopsy"`). It is not the program view: a coordinator receives it on the worklist without holding `GET /api/program/summary`. `closed_this_week` appears in both because both screens print it; neither copies the other's number.

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
    ],
    "pathway": { "id": "fit-colonoscopy", "version": 3, "label": "Positive FIT to colonoscopy, pathology and follow-up" }
  },
  "stages": [ { "key": "result_received", "state": "passed", "label": "Result received", "short_label": "Result" }, { "key": "pathology_received", "state": "current", "label": "Pathology received", "short_label": "Received" } ],
  "timeline": [ { "event_id": "e_91", "type": "pathology_recorded", "actor": { }, "occurred_at": "...", "recorded_at": "...", "summary": "Pathology report attached", "payload": { } } ],
  "documents": [ { "document_id": "d_4", "kind": "pathology", "title": "Pathology report" } ],
  "tasks": [ { "task_id": "t_7", "kind": "confirm_closure", "owner": { }, "due_at": "...", "status": "open" } ],
  "outreach_attempts": [
    { "n": 1, "at": "17 Nov 10:05", "channel": "call", "result": "No answer", "minutes": 3 }
  ],
  "available_actions": ["confirm_closure", "reopen_case", "reject_proposal"],
  "verification": { "status": "ready", "proposal": "reopen", "proposed_outcome": null },
  "provider": { "provider_id": "prov_clinic_b", "name": "Clinic B" },
  "ownership": { "state": "owned", "unowned_since": null, "gaps": [
    { "trigger": { "event_id": "e_1002_4", "type": "referral_rejected", "label": "Receiving provider rejected the referral", "reason": "Colonoscopy request incomplete (hospital B)" },
      "previous_owner_actor_id": "act_001", "unowned_at": "2026-11-16T15:40:00+07:00",
      "owned_at": "2026-11-18T11:42:00+07:00", "owner_actor_id": "act_005", "owner_event_type": "consultation_accepted", "hours_to_owner": 44 } ] },
  "referrals": [ { "referral_id": "REF-4377-1", "from_provider_id": "prov_clinic_a", "to_provider": { "provider_id": "prov_hospital_b", "name": "Hospital B" }, "status": "accepted", "priority": "routine", "specialty": { "system": "http://snomed.info/sct", "code": "394584008", "display": "Gastroenterology" }, "replaces_referral_id": null, "sent_at": "...", "updated_at": "..." } ],
  "consultations": [ { "consultation_id": "k_1dbeb6be", "question": "...", "requested_by_actor_id": "act_003", "to_provider": { }, "to_actor_id": "act_006", "referral_id": "REF-4377-1", "requested_at": "...", "due_at": "...", "task_id": "t_...", "status": "answered", "outcome": "accepted", "answer_note": "...", "answered_by_actor_id": "act_006", "answered_at": "...", "hours_to_answer": 24 } ]
}
```

`verification.proposed_outcome` is the outcome a `propose_closure` asks the physician to confirm (`proposedOutcomeFor` in `server/verify/`), otherwise `null`; `GET /verification` carries the same field inside `extraction`.

`provider`, `ownership`, `referrals` and `consultations` are TICKET-08/11. `ownership.gaps` is the per-case metric "time from trigger to owned again": one row per unowned spell, `hours_to_owner` stored when an owner returns, `null` while the case is still unowned. `case.patient.identifier` is the identifier incoming FHIR resources are matched on. `available_actions` may include `request_consultation` (a stage the template marks `consultation`, no consultation open) and `answer_consultation` (one is open).

`available_actions` is computed by the engine from the caller's role plus the case state. This is what stops the UI and the guards from drifting apart: one function produces both. `record_provider_move` is in it when the role may record `patient_moved_provider` on the open case (the roles are the template's, `actions.record_provider_move`). `reopen_case` is in it for the physician on a closed case and, since 18 Nov, on an open case past the procedure (the stages whose exits include the template's incomplete-examination event: `procedure_completed` to `closure_proposed` in the FIT template).

**Added 18 Nov (demo walk).**

- `case.pathway.short_label` (`"FIT → colonoscopy"`), `case.has_outreach` (whether the pathway has the patient outreach ladder and its screen; only the FIT pathway does) and `case.awaiting_closure` (a closure decision is waiting on the physician at this stage).
- `next_steps`: every event the caller's role may record now, read from the template by `nextSteps` in `server/engine.ts`. Each item is `{ "event", "label", "to", "to_label", "moves_stage", "needs_outcome", "needs_owner" }`, forward steps first, then steps that leave the stage alone, then steps back. Left out because each has its own control: the closure confirmation, consultation answers, the provider move, system-only events, and an assignment while the case is unowned (the assign-owner form). A step into an `awaiting_closure` stage (the closure proposal) is listed only once a document that could support some outcome is attached; `needs_outcome` asks the client for the outcome, `needs_owner` for the new owner. The case page's "Record next step" posts the chosen one to `POST /events`, which checks it again.
- Server-formatted labels for every timestamp a screen prints, in the `stage_due_label` format ("16 Nov 15:40", demo clock): `timeline[].occurred_label`, `tasks[].due_label`, `ownership.unowned_since_label`, `ownership.unowned_label` (`"Unowned 20h"`, the same words as `GET /api/unowned`; `null` while owned), `ownership.gaps[].unowned_at_label` / `owned_at_label`, `referrals[].sent_label`, `consultations[].requested_label` / `due_label` / `answered_label`. The ISO fields stay for machines.
- A timeline event recorded without a `summary` prints the template's label for its type.

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

`source` and `read_at` are provenance, and `docs/frontend-handoff.md` requires all three of source, offset and read time on every extracted value. `read_at` is the real time the report was read, which is why it is not the same clock as `occurred_at`. A field with no quote sends an empty `quote_offset` and keeps `source` and `read_at`. Each field also carries `read_label` ("17 Nov 09:14"), which the screens print.

**The latest report, not the latest reading (18 Nov).** The `GET` returns the stored reading of the case's *latest report*, never an older one. The latest report is the most recent `colonoscopy` document together with every `pathology` document attached after it, read as one text (a physician signs off on both; the prompt already says the outcome follows the pathology). Several documents are joined under the headings `COLONOSCOPY REPORT` and `PATHOLOGY REPORT`; one document is its own text, unchanged. `report` is `{ "document_id", "document_ids", "title", "text" }`: `document_id` is the latest document (the reading is attached to it), `text` is the text the offsets point into. `extraction` adds `extraction_id`, `read_label` and `origin`: `stored`, or `not_read` when the latest report has no reading yet (fields empty, `proposal: "needs_human_reading"`, a reason that says to read it), `no_report`, or `pathway_not_verified`. After case 3's repeat colonoscopy and pathology, the closure review therefore shows "not read yet" until someone reads them, not the first report's `reopen`.

### `GET /api/unowned`

The dedicated unowned list (`TICKET-08`), one query, no client-side filtering. Every open case without an owner, longest unowned first. Like `GET /api/cases`, it leaves out the synthetic cohort unless called with `?cohort=include` (`TICKET-17`); with the cohort loaded that adds about 36 rows. Each row carries `unowned_since` (the start of the open spell, so a later move does not reset it) and the trigger that caused it. No role is required; a present `X-Nexyra-Actor` header is still validated.

```json
{
  "clock": { "now": "2026-11-17T11:42:00+07:00", "is_demo": true, "day": 0 },
  "count": 1,
  "cases": [ {
    "case_id": "CX-1002",
    "patient": { "display_name": "R. Kumar", "age": 47, "language": "en" },
    "stage": "patient_notified", "stage_label": "Patient notified",
    "provider": { "provider_id": "prov_clinic_a", "name": "Clinic A" },
    "unowned_since": "2026-11-16T15:40:00+07:00", "hours_unowned": 20, "unowned_label": "Unowned 20h",
    "trigger": { "event_id": "e_1002_4", "type": "referral_rejected", "label": "Receiving provider rejected the referral", "reason": "Colonoscopy request incomplete (hospital B)" },
    "previous_owner": { "actor_id": "act_001", "display_name": "R. Haddad" },
    "assign_owner_task": { "task_id": "t_1002_owner", "owner": { "actor_id": "act_001", "role": "coordination_staff", "display_name": "R. Haddad" }, "due_at": "2026-11-17T15:40:00+07:00" }
  } ]
}
```

**The three triggers.** (1) `referral_rejected`. (2) `referral_unanswered`, written by `tick` when a case is still owned and still at `referral_sent` past that stage's deadline (the acceptance deadline); a timer row keyed `referral_sent#unanswered` makes it fire once per deadline. (3) `patient_moved_provider` on an open case. Each trigger opens an ownership gap and an `assign_owner` task for coordination staff at the case's current provider (the referring provider for 1 and 2, the provider the patient moved to for 3), due `unowned.assign_owner_hours` (24) later. A move on a case that is already unowned keeps the spell open and hands the task to the new provider's coordination staff. Any event that gives the case an owner again (`owner_assigned`, a consultation answer, `reopened`, `procedure_incomplete`) closes the gap with `hours_to_owner` and completes the task. `owner_assigned` and the other assigning events record `handed_over_by` (the owner before, or the last owner before the case went unowned), `received_by` and `assigned_by` in their payload.

### `GET /api/providers`

`{ "providers": [ { "provider_id": "prov_clinic_a", "name": "Clinic A", "kind": "clinic" } ] }`. For pickers (move, redirect).

### `GET /api/actors`

The people the prototype knows (all fictional), for names printed against ids and for the owner and addressee pickers. No role required. The system actor is left out.

`{ "actors": [ { "actor_id": "act_006", "role": "responsible_physician", "display_name": "Dr. Fulana", "provider": { "provider_id": "prov_hospital_b", "name": "Hospital B" } } ] }`

The role picker's three seats (R. Haddad, Dr. Fulan, A. Al Suwaidi) stay a client mapping in `src/api/actors.ts`; everything else the screens name comes from this list.

**Unowned list labels (18 Nov).** `GET /api/unowned` rows add `unowned_since_label`, `pathway_label` and `assign_owner_task.due_label`. A move while the case is already unowned hands the open assign-owner task to coordination staff at the new provider **with a fresh due time** (`unowned.assign_owner_hours` from the move). `GET /api/ingest/unstitched` items add `received_label`.

### `GET /api/program/summary`

The program view (`TICKET-16`), built in `server/programme.ts`. One call returns every section on the screen. The caller is resolved like every other read (`X-Nexyra-Actor` header, or `?role=` without one; a present-but-invalid header is refused). Only `responsible_physician` and `program_manager` may read it (permission table above); any other role gets `403 role_not_permitted`.

Everything is computed at request time, at the demo clock's `now`, from `cases`, `events` and `extractions` (plus `unstitched` once it exists). Nothing is stored and nothing comes from a fixture. Stage history comes from replaying each case's events with the engine's own `nextState`, so the funnel cannot disagree with the case timeline. The read is a fixed number of queries whatever the cohort size, with no per-case query: about 0.2 s for 1,000 cases and 6,000 events on a local file.

```json
{
  "clock": { "now": "2026-11-17T11:42:00+07:00", "is_demo": true, "day": 0 },
  "synthetic_data_label": "Synthetic data. Drop-off rates are input assumptions, not results.",
  "counts": {
    "total": 3, "open": 3, "unowned": 1, "due_today": 0, "due_today_unowned": 0,
    "closed_this_week": 0, "past_referral_limit": 0, "closures_held": 1
  },
  "exceptions": [
    { "case_id": "CX-1002", "kind": "unowned", "reason": "Unowned 20h", "owner": "—",
      "stage_label": "Patient notified", "due_at": "2026-11-19T15:40:00+07:00", "due_label": "19 Nov 15:40" },
    { "case_id": "CX-1003", "kind": "closure_held", "reason": "Closure held: the latest reading proposes \"reopen\"",
      "owner": "Dr. Fulan", "stage_label": "Closure proposed", "due_at": "2026-11-14T09:00:00+07:00", "due_label": "14 Nov 09:00" }
  ],
  "unstitched": { "available": false, "count": 0, "rows": [] },
  "funnel": [
    { "key": "result_received", "stage": "Result received", "reached": 3, "open": 1, "unowned": 0, "median_days_from_previous": null, "terminal": false },
    { "key": "patient_notified", "stage": "Patient notified", "reached": 2, "open": 1, "unowned": 1, "median_days_from_previous": 1.1, "terminal": false }
  ],
  "referral_to_colonoscopy": {
    "limit_days": 31, "label": "Referral to colonoscopy", "source": "HAAD standard, cited in BMC Cancer 2021",
    "completed": 1, "completed_within_limit": 1, "completed_over_limit": 0,
    "waiting": 1, "waiting_over_limit": 0, "median_days_completed": 20,
    "buckets": [ { "label": "0–7 days", "min_days": 0, "max_days": 7, "over_limit": false, "completed": 0, "waiting": 1 } ]
  },
  "delay_reasons": [ { "delay_reason": "fear", "label": "Fear", "count": 0 } ],
  "escalations_per_role_per_day": [
    { "role": "responsible_physician", "role_label": "Responsible physician", "total": 1, "per_day": 0.3 }
  ],
  "escalations_by_day": [
    { "day": 2, "label": "Day 2 · 19 Nov", "per_role": [ { "role": "responsible_physician", "count": 1 }, { "role": "program_manager", "count": 0 } ] }
  ],
  "scenario": {
    "title": "Scenario based on assumptions", "cohort_cases": 3, "baseline_rate": 0.229, "outreach_rate": 0.31,
    "additional_completed": 0,
    "source": "Atlas et al., JAMA 2023: follow-up completed 22.9% with usual care, 31.0% with reminder, letter and phone outreach",
    "caveat": "One trial in one US health system. It does not say what would happen in Abu Dhabi, and it is not a result of Nexyra."
  },
  "pathway": { "id": "fit-colonoscopy", "label": "Positive FIT to colonoscopy, pathology and follow-up" }
}
```

Arrays are shortened above: `funnel` carries every stage of the template in order, `buckets` has six rows, and `delay_reasons` always lists all five reasons.

`delay_reasons` counts each barrier once: an `outreach_attempted` event with a `delay_reason`, or a `task_completed` with one that staff recorded through `POST /api/tasks/{id}/complete`. The `task_completed` the outreach ladder writes when a logged call closes the caller's ladder task copies the call's reason and names the call in `outreach_event_id`; it is not counted again.

`ai_divergence` (TICKET-15, added 18 Nov): `{ "count": 1, "proposals_rejected": 1, "closed_against_reading": 0 }`. `proposals_rejected` counts `proposal_rejected` events by a physician; `closed_against_reading` counts closures a physician confirmed while the case's last `extraction_completed` reading proposed something other than `propose_closure`. A count to review, not an error rate.

`reason`, `owner`, `stage_label`, `due_label`, `label` and `role_label` are renderable strings: the page prints them as written and never derives a date. `due_at` is ISO 8601, or `null` for a stage with no deadline.

**Exceptions** (the actionable part, first on the screen). One row per case and reason, so a case can appear twice. Every row carries `case_id` and opens that case. Rows are ordered by kind, then by severity.

| `kind` | when | `due_at` |
|---|---|---|
| `unowned` | an open case with no owner; `reason` says for how long, counted from the event that cleared the owner | the stage deadline |
| `past_referral_limit` | an open case with no colonoscopy yet whose referral limit has run out, measured exactly as the worklist's `days_left_referral_limit` (from first entering `referral_sent`, or from the result before any referral) | when the 31 days ran out |
| `closure_held` | a case waiting on closure (an `awaiting_closure` stage) whose latest reading proposes anything other than `propose_closure`. The reading is the case's latest `extractions` row (one query for all cases); the case detail's `verification` reads the reading of the latest report, which differs only while a newer report is unread. A case never read is not listed | the stage deadline |

**Unstitched** events have no case, so they are not exception rows. The section checks `sqlite_master` for an `unstitched` table (`TICKET-08`). Without the table it returns `{ "available": false, "count": 0, "rows": [] }` and no error. With it, each row not yet matched to a case (no `stitched_case_id`, `case_id`, `stitched_at` or `resolved_at`) becomes `{ id, received_at, received_label, reason, summary }`, read from the likely column names: `id`/`event_id`, `received_at`/`recorded_at`/`occurred_at`/`created_at`, `reason`/`status`, `summary`/`resource_type`/`kind`/`type`/`source`.

**Funnel.** `reached` is the number of cases whose timeline ever entered the stage, a direct count over `events` (the test compares it with `SELECT count(DISTINCT case_id)` per entering event). A confirmation from the closure endpoint finalises to `closed` in one event and counts as reaching both `closure_confirmed` and `closed`. `open` and `unowned` are the cases at that stage now. `median_days_from_previous` is the median number of days from the latest earlier stage the case reached to its first entry here, to one decimal; `null` for the first stage or when no case has both.

**Referral to colonoscopy.** Only cases that have been referred. `completed` cases have reached `procedure_completed`; `waiting` cases are open and have not, counted to `now`. Bucket edges fall on the limit, so each bucket is either within it or over it (`over_limit`).

**Delay reasons.** One count per staff record that carries `delay_reason`: outreach events (`outreach_*`) and `task_completed`. All five values are always present.

**Escalations** come from `deadline_missed` events. `payload.escalated_to` is the role; the demo day is the number of whole days since day 0 of the demo clock. `escalations_by_day` has a row for every demo day from 0 to the current one, and `per_day` is `total` divided by that number of days, to one decimal.

**Counts.** `due_today` counts open cases whose stage deadline falls on the demo clock's calendar date. `closed_this_week` counts cases that entered `closed` in the seven demo days before `now`. These belong to the program view; the register's `counts` in `GET /api/cases` are a separate summary.

**Scenario.** The only figure on the screen about a possible effect, and it is labelled as an assumption. `additional_completed` is `cohort_cases × (31.0% − 22.9%)`, rounded: the gap between usual care and the outreach arm in Atlas et al., JAMA 2023 (`docs/evidence.md`). It is not measured from the cohort and it is not a result of Nexyra.

`synthetic_data_label` is always present and is printed at the top of the screen.

### `GET /api/ingest/unstitched`

Events that matched no case (`TICKET-08`), so they are visible instead of silently dropped. Oldest first. `?status=queued` (default), `stitched` or `all`: a queued resource that is re-sent once its case exists is stitched and its row marked `stitched`.

```json
{ "count": 1, "items": [ {
  "unstitched_id": "u_3c1f0a2e", "resource_type": "Procedure", "resource_id": "proc-x",
  "source_provider": { "provider_id": "prov_hospital_b", "name": "Hospital B" },
  "patient_identifier": "NX-P-9999", "referral_id": "REF-UNKNOWN",
  "reason_code": "unknown_referral", "reason": "No case carries the referral REF-UNKNOWN.",
  "received_at": "2026-11-18T11:42:00+07:00", "recorded_at": "...", "status": "queued", "stitched_case_id": null } ] }
```

`reason_code` is one of `no_patient_identifier`, `no_referral_reference`, `unknown_referral`, `patient_mismatch`, `case_closed`.

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

Clinician reopen, never leaving the case unowned (`TICKET-05`, `TICKET-17` case 3). Optional body `{ "reason": "Repeat colonoscopy needed", "owner_actor_id": "act_005" }`. Which event it writes is the engine's answer (`reopenEventFor` in `server/engine.ts`), and the write goes through `applyEvent` like every event:

- On a closed case: the template's reopen event (`reopened`, back to `result_received`).
- On an open case past the procedure, the closure review's **Reopen case**: the exit from the current stage that goes back and clears the outcome. In the FIT template that is `procedure_incomplete` (back to `referral_sent`) from `procedure_completed`, `pathology_ordered`, `pathology_received` and `closure_proposed`; in the mammography template `assessment_incomplete`. The payload records the reading on the table: `{ "reopened_at_stage", "reason", "summary": "Reopened at closure review: Incomplete exam and inadequate prep; Repeat colonoscopy needed", "verification": { "extraction_id", "proposal", "proposal_reason", "findings": [ { "key", "value", "quote" } ] } }`.

`403 role_not_permitted` when another role could reopen the case here (a coordinator at `closure_proposed`); `409 invalid_transition` when no role can (a case at `result_received`).

### `POST /api/cases/{case_id}/outreach`

Records one patient outreach attempt (`TICKET-10`). Body: `{ "outcome": "no_answer", "channel": "call", "delay_reason": "fear" }`.

- `outcome` (required) is free text and becomes the ladder's `result`.
- `channel` is `call`, `sms` or `letter`; omitted means `call`.
- `delay_reason` is the same closed set as `POST /api/tasks/{task_id}/complete`. Free text belongs in `note`.
- `minutes` is optional.
- `connected` (optional, `true` or `false`) records whether the call reached the patient; anything else is `400 validation_failed` (TICKET-10).

**Outreach ladder side effects (TICKET-10).** While the case is on the ladder (open, at `result_received`), logging an attempt also completes the caller's own open ladder task (`outreach_call` or `patient_callback` for coordination staff, `outreach_navigator` for a navigator) with a `task_completed` event, and a `delay_reason` logged by coordination staff escalates the case to the navigator at once (see "Patient outreach ladder" below). `recorded` is still the `outreach_attempted` event; the timeline may end with the ladder's events after it.

Contacting a patient does not advance a case, so this endpoint appends an `outreach_attempted` event and leaves the stage where it is. The case view's `outreach_attempts[]` is derived from those events, so the ladder and the timeline cannot disagree. Only coordination staff and navigators may call it (`log_outreach` in the permission table), and never on a closed case.

### `POST /api/cases/{case_id}/proposal/reject`

Body: `{ "reason": "..." }` (5 to 500 characters, else `400 validation_failed`). The responsible physician says the AI proposal on the table does not hold. Allowed where `available_actions` has `reject_proposal` (a physician, an `awaiting_closure` stage); another role gets `403`, a case with no closure waiting `409`. Writes one `proposal_rejected` event in the physician's name with `{ "proposal", "proposal_reason", "extraction_id", "reason", "summary" }` (the reading of the latest report). It never moves, closes or reopens the case: the physician then confirms another outcome, reopens, or leaves it. Returns the case view plus `recorded`. The program view counts it in `ai_divergence`.

### `POST /api/cases/{case_id}/verification`

Runs extraction and stores the result as an event with prompt version and model (`TICKET-13`). Returns the same shape as the `GET`. Idempotent per report: if the text hash is already cached, returns the cached result and does not call the model again. With no key and no cache, returns `proposal: "needs_human_reading"`.

Requires the `X-Nexyra-Actor` header (any human role). Optional body `{ "document_id": "d_4" }` reads that one document; without it the case's latest report is read (the latest colonoscopy report with the pathology reports after it, see the `GET`). `quote_offset` is an offset into the text that was read, which the response returns as `report.text`.

What it writes. The model's reading goes into `extraction_cache` (keyed by the sha256 of the text; the same text is never sent to the model twice). The case's reading is an `extractions` row attached to the latest document (unique per document and text hash; `report_text` keeps the text the offsets point into), with one `extraction_completed` event, `actor_role: "system"`, payload `{ prompt_version, model, proposal, proposal_reason, document_id, document_ids, text_hash, extraction_id, origin, requested_by }`. A cache hit for a document that has no reading yet (the same text arriving for a new document, or the seeded reading of case 3's repeat reports) attaches the cached reading to that document with its own event (`origin: "cache"`); a second hit on the same document writes nothing, and so does an unavailable result. It never touches the case row, so no extraction result can move, propose or close a case; closure stays `POST /closure/confirm` under `TICKET-05`'s rules.

**Offline demo.** The seed caches two readings: the first colonoscopy report of CX-1003 (`reopen`) and the repeat colonoscopy report plus its pathology as the demo sends them (steps 3.7 and 3.9; texts in `server/demoReports.ts`): complete exam, adequate prep, polyp removed, pathology back, so `POST /verification` answers `propose_closure` → `surveillance_scheduled` with no key. That second reading was written by hand for the demo, not by a model, and its `model` says so ("hand-written demo reading (no model call)"); its proposal comes from the same rules.

The `POST` response adds `origin` (`model`, `cache`, `unavailable`, `no_report`, or `pathway_not_verified` for a case on a pathway without report verification, TICKET-18) to the `GET` shape, plus `proposed_outcome` (the outcome key a `propose_closure` asks the physician to confirm, otherwise `null`). Since TICKET-15's follow-up the `GET` carries `extraction.proposed_outcome` too, computed by the same `proposedOutcomeFor`.

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

A `delay_reason` on a completed task counts as a barrier for the outreach ladder in the same way as one logged through `/outreach`.

### Patient outreach ladder (TICKET-10)

Templates and step deadlines are data in `server/outreach/templates/` (see `docs/architecture.md`). The ladder runs inside `tick()`, so `POST /api/clock/advance` and `POST /api/clock/tick` climb it; their responses carry an extra `outreach` object, reported apart from `escalations`:

```json
"outreach": { "messages_sent": 0, "staff_calls": 1, "navigator_escalations": 0, "stopped": 0,
              "per_case": [ { "case_id": "CX-1001", "step": "staff_call", "reason": "no_response" } ] }
```

| Step | When | Event (actor `system`) | Task |
|---|---|---|---|
| 1. Automated message | case open at `result_received`, once per visit | `outreach_message_sent` `{ run_id, channel: "sms", delivery: "simulated", template_id, language, requested_language, language_fallback, review_status, dir, text, link, reply_by }` | none |
| 2. Staff call | 48 h after the message, no answer, no call already arranged | `outreach_staff_call_due` `{ run_id, task_id, task_owner_actor_id, due_at, reason: "no_response" }` | `outreach_call`, owner: the coordinator who owns the case (else the first coordinator), due +24 h |
| 3. Navigator | 48 h after the first call step with the case still at `result_received`, or at once when coordination staff record a `delay_reason` | `outreach_navigator_assigned` `{ run_id, task_id, task_owner_actor_id, due_at, reason: "no_movement" \| "barrier", delay_reason? }` | `outreach_navigator`, owner: the navigator, due +48 h |

The ladder never moves a stage except as described under the patient response. It stops when the patient confirms, the case leaves `result_received`, or the case closes; open ladder tasks are then set to `cancelled` and an `outreach_ladder_stopped` event `{ reason, stage, cancelled_task_ids }` is written. Each fired step is unique per `(case_id, run_id, step)`, so ticking twice at one instant changes nothing.

### `GET /api/cases/{case_id}/outreach`

The staff view of the ladder, read by `/cases/:ref/outreach`. Same role rules as `GET /api/cases/{case_id}` (header or `?role=`).

```json
{
  "case_id": "CX-1001",
  "patient_language": "ar",
  "active": true,
  "status": "staff_call",
  "status_label": "Staff call",
  "stopped_reason": null,
  "link": { "token": "hq7m3kx9va", "path": "/p/hq7m3kx9va" },
  "message": { "sent": true, "sent_at": "...", "sent_label": "16 Nov 10:20", "channel": "sms", "delivery": "simulated",
               "language": "ar", "dir": "rtl", "text": "...", "language_fallback": false,
               "review_status": "written_not_reviewed", "review_note": "..." },
  "ladder": [
    { "key": "message", "n": 1, "label": "Automated message", "role": "system", "state": "done",
      "at_label": "16 Nov 10:20", "due_label": null, "detail": "...", "task": null },
    { "key": "staff_call", "n": 2, "label": "Staff call", "role": "coordination_staff", "state": "done",
      "at_label": "18 Nov 11:42", "due_label": null, "detail": "...",
      "task": { "task_id": "t_...", "kind": "outreach_call", "owner": { }, "due_at": "...", "due_label": "19 Nov 11:42", "status": "open" } },
    { "key": "navigator", "n": 3, "label": "Navigator", "role": "navigator", "state": "scheduled",
      "at_label": null, "due_label": "20 Nov 11:42", "detail": "...", "task": null }
  ],
  "patient_response": null,
  "delay_reasons": [ { "key": "fear", "label": "Fear (of the test, the preparation or the result)" } ],
  "parameters": [ { "key": "staff_call_after_hours", "hours": 48, "label": "...", "source": "unsourced, needs clinical review" } ],
  "template_note": "Atlas et al. (JAMA 2023) sent letters in week 2 ...",
  "navigator_task_kind": "outreach_navigator"
}
```

`state` is `done`, `scheduled`, `not_needed` (a callback or a barrier made the step unnecessary) or `stopped`. A `callback` row appears between steps 2 and 3 when the patient asked for a call. `status` is `not_started`, `waiting_for_patient`, `staff_call`, `navigator`, `acknowledged` or `stopped`. When no message has been sent yet, `message.sent` is `false` and `text` is the preview step 1 would send.

### `GET /api/patient/{token}`

The patient page, no actor header (the patient has no login). Optional `?lang=` picks one of `en`, `ar`, `ur`, `hi`, `tl`; without it the case's language is used. An unknown token is `404 not_found` with the same message for every token.

```json
{
  "patient_name": "Y. Al Hammadi",
  "language": "ar", "language_name": "العربية",
  "content_language": "ar", "dir": "rtl",
  "fallback": false, "fallback_notice": null,
  "review_status": "written_not_reviewed", "review_note": "...",
  "languages": [ { "code": "ur", "name": "اردو", "dir": "rtl", "review_status": "draft_slot", "label": "draft, not reviewed by a native speaker" } ],
  "content": { "page_title": "...", "greeting": "...", "result_heading": "...", "result": "...", "next_step_heading": "...", "next_step": "...",
               "urgency_heading": "...", "urgency": "...", "contact_heading": "...", "contact": "...", "acknowledge": "...", "callback": "...",
               "acknowledged": "...", "callback_requested": "...", "language_label": "...", "draft_notice": "...", "sms": "..." },
  "response": null, "response_text": null,
  "phone": "+971 2 000 0000"
}
```

`content` is the template with its variables filled in, nothing else. A draft slot (`ur`, `hi`, `tl`) has no text: `content_language` is then `en`, `dir` is `ltr`, `fallback` is `true` and `fallback_notice` says why. The page sets `dir` and `lang` from `dir` and `content_language`, never from the choice.

### `POST /api/patient/{token}/response`

Unauthenticated by design. Body: `{ "response": "understood" }` or `{ "response": "request_call" }`, optional `"language"`. The token is opaque and maps to one case; it grants nothing beyond these two actions. Anything else is `400 validation_failed`. Returns the `GET` shape plus `recorded` (the event id, or `null` when the same answer was already recorded).

- `understood` records `patient_acknowledged` (actor `act_patient`, role `patient`). If the case is still at `result_received` the engine then records `patient_notified` as `system` with `{ channel: "patient_page", acknowledged_event_id }`, which moves the case on, and the ladder stops. A second tap records nothing.
- `request_call` records `callback_requested` and opens a `patient_callback` task owned by coordination staff (the case owner if a coordinator), due 24 h later; the payload carries `task_id`, `task_owner_actor_id` and `due_at`. It counts as the ladder's call step, so no second call task is opened at the message deadline. One per run.

### `POST /api/ingest/fhir`

Batch of FHIR resources (`TICKET-07`, `TICKET-08`). Returns per-resource outcome: `created_case`, `stitched`, `queued_unstitched`, or `rejected` with a reason. Nothing is silently discarded.

Requires the `X-Nexyra-Actor` header (any human role; recorded as `ingested_by`). The body is one resource or a `Bundle` (its `entry[].resource`, in order). Optional top-level `source_provider_id` names the sender when a resource does not.

**What this ingest stitches (TICKET-08):** `Appointment`, `Procedure` and `DiagnosticReport`, FHIR R4-shaped JSON. A resource is matched to a case by **both** keys, exactly:

- the patient identifier: `subject.identifier.value` (Procedure, DiagnosticReport) or the Patient participant's `actor.identifier.value` (Appointment), falling back to a `Patient/<id>` reference; compared with `case.patient.identifier`;
- the originating referral: `basedOn[]` → `ServiceRequest/<referral_id>` (or `basedOn[].identifier.value`), a referral recorded on the case.

The sender is read from `meta.source` (`urn:nexyra:provider:<id>`) or a `performer` Organization reference. It is informational and not a matching key.

A matched resource is stitched. When the template's `stitching.rules` map it to an event that is a legal next step, the system role records that event and the case moves: `Appointment` `booked` → `colonoscopy_booked`, `Procedure` `completed` → `colonoscopy_performed`, pathology `DiagnosticReport` (`category` SP, or a code that says pathology) `final`/`amended` → `pathology_received`. Otherwise (the case is not at that step yet, a colonoscopy report, a cancelled appointment) it is stitched as a `fhir_resource_stitched` history event with `not_moved_reason`. A `DiagnosticReport` with text (`presentedForm[].data` base64, else `conclusion`) is attached as a document of its kind. A resource already stitched is answered `stitched` with `duplicate: true` and writes nothing. Unmatched resources go to the unstitched queue. A malformed resource or an unsupported type is `rejected`. `created_case` is reserved for the positive-FIT ingest (TICKET-07) and is always `0` here.

```json
{ "results": [
    { "resource_type": "Appointment", "resource_id": "appt-4377-1", "outcome": "stitched", "case_id": "CX-1002", "event_id": "e_...", "stage": "colonoscopy_booked", "stage_moved": true, "document_id": null },
    { "resource_type": "Procedure", "resource_id": "proc-x", "outcome": "queued_unstitched", "unstitched_id": "u_...", "reason_code": "unknown_referral", "reason": "No case carries the referral REF-UNKNOWN." } ],
  "counts": { "created_case": 0, "stitched": 1, "queued_unstitched": 1, "rejected": 0 } }
```

Matching is exact. Probabilistic identity matching is out of scope (`docs/architecture.md`).

### `POST /api/cases/{case_id}/consultations`

`TICKET-11`. The referring physician asks the receiving provider one short question. Body: `{ "question": "...", "to_provider_id": "prov_hospital_b", "to_actor_id": "act_006" }`. `to_provider_id` defaults to the case's latest referral's receiving provider, and `to_actor_id` to the first physician there. Allowed where `available_actions` has `request_consultation`: responsible physician, a stage the template marks `consultation` (`patient_notified`, `referral_sent`, `pathology_received`, `closure_proposed`), and no other consultation open. Otherwise the call fails with `403 role_not_permitted` (role) or `409 invalid_transition` (stage, or one already open). An empty question gets `400`, and so does one over 500 characters.

Writes, in one batch, a `consultation_requested` event, a `consultations` row and an `answer_consultation` task owned by the receiving physician, due `consultation.answer_hours` (48) later. Returns the case view plus `recorded` and `consultation_id`.

### `POST /api/consultations/{consultation_id}/answer`

Body: `{ "outcome": "accepted" | "redirected" | "more_data_requested", "note": "...", "owner_actor_id": "act_005", "redirect_to_provider_id": "prov_endo_e" }`. Responsible physician only (`answer_consultation`). The outcome selects the template event:

- `accepted` → `consultation_accepted`: the case moves to `referral_accepted`; the latest referral is `accepted`.
- `redirected` → `consultation_redirected`: needs `redirect_to_provider_id`. The case moves to `referral_sent` with a new referral to that provider (same priority and specialty unless `referral` overrides them), so the acceptance deadline restarts. The old referral is `redirected`.
- `more_data_requested` → `consultation_more_data_requested`: the stage stays; a `supply_referral_data` task goes to the physician who asked, due `consultation.more_data_hours` (72) later.

Only the physician the consultation is addressed to (`to_actor_id`) may answer it: any other physician gets `403 role_not_permitted` (since 18 Nov; the screen already sent the addressee's header). An answer that is not a legal step from the case's stage (for example `accepted` at `closure_proposed`) fails with `409` and the consultation stays open. On an unowned case the answer assigns `owner_actor_id`, or else the physician who asked. The consultation row records `outcome` and `hours_to_answer` (the TICKET-11 metric). The task completes and the consultation's timers are cancelled. A second answer fails with `409`. `POST /api/tasks/{id}/complete` refuses an `answer_consultation` task.

**Unanswered consultations escalate** through `tick` like stage deadlines: a `consultation_overdue` event, an `escalation` task and a timer row keyed `consultation:<id>`. Level *n* goes to the *n*-th role of the template's `consultation.escalation` (responsible physician, then program manager). Level 1 goes to the physician who owes the answer. The same spacing and idempotency apply, and these alerts count in `escalations` and `escalations_per_role`.

**In production the messages travel over Malaffi e-Referral.** DoH Circular 144/2026 makes e-Referral the channel between referrer and receiver. This endpoint pair stands in for that exchange in the prototype; deployed, Nexyra would only read the consultation status from e-Referral and keep the owner, the deadline and the escalation. It is not a new messaging channel.

### Demo case 2 through the API (CX-1002)

The seed starts CX-1002 unowned after its rejected referral. The walk below is tested in `server/consultation.test.ts`:

1. `GET /api/unowned`: CX-1002, trigger `referral_rejected`, task with R. Haddad (clinic A).
2. `POST /api/cases/CX-1002/events` as S. Al Ali: `{ "type": "patient_moved_provider", "payload": { "provider_id": "prov_clinic_b" } }`. Still unowned, provider clinic B, task now with S. Al Ali.
3. `POST /api/cases/CX-1002/consultations` as Dr. Fulan: `{ "question": "Missing FIT date and history now attached. Can you accept the referral?" }`. Task for Dr. Fulana at hospital B, due in 48 h.
4. `POST /api/clock/advance` `{ "days": 1 }`.
5. `POST /api/consultations/{id}/answer` as Dr. Fulana: `{ "outcome": "accepted", "owner_actor_id": "act_005" }`. Stage `referral_accepted`, owner S. Al Ali, `hours_to_answer` 24, `hours_to_owner` 44, and the case leaves `GET /api/unowned`.
6. `POST /api/ingest/fhir` with hospital B's `Appointment` (`basedOn` `ServiceRequest/REF-4377-1`, patient `NX-P-1002`): stitched, stage `colonoscopy_booked`.

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

`unowned_triggered` (TICKET-08) counts the cases this tick made unowned because their referral went unanswered past the acceptance deadline. `POST /api/clock/tick` returns it too.

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

**The synthetic cohort is not ticked (`TICKET-17`).** `tick` (and so `advance`, `tick` and `until: "next_deadline"`) acts on live cases only, never on cases whose id starts `SY-`. See "The synthetic cohort" below.

### `POST /api/clock/reset`

Demo only. Sets the demo clock to day 0 and nothing else: the data stays. The full reset is `npm run demo:reset` or `POST /api/demo/reset`. It is not exposed in the normal UI.

### `POST /api/demo/reset`

`TICKET-21`. Runs the same reset as `npm run demo:reset` against the database the server uses (Turso when deployed): the three demo cases, the three mammography cases of the second pathway (`TICKET-18`), the synthetic cohort, the demo clock on day 0. `GET` does the same, because Vercel Cron calls a route with `GET`; `vercel.json` schedules it once a day at 21:00 UTC (01:00 in Abu Dhabi).

- With neither `DEMO_RESET_SECRET` nor `CRON_SECRET` set, the route does not exist: `404 not_found`, as for any unknown path.
- Otherwise the request needs `Authorization: Bearer <secret>`, where the secret is either variable. Vercel Cron sends `Bearer $CRON_SECRET` on its own; `DEMO_RESET_SECRET` is for a reset by hand. A missing or wrong token is `401 unauthorized`.
- Response: `{ "reset": true, "clock": { ... day 0 ... }, "cases": 1006, "cohort_cases": 1000, "events": 5276, "took_ms": 5200 }`.

It takes about 5 s locally and about 7 s against a database 30 ms away, because the state is built in memory and copied in about 19 round trips. Any request that arrives during those seconds may see a partly loaded database; the cron runs at night for that reason.

### The synthetic cohort

`npm run demo:reset` loads, beside the three demo cases and the three mammography cases, the 1,000-case synthetic cohort from `scripts/generate/` (ids `SY-0001` to `SY-1000`, fictional, drop-off rates from `data/generator-assumptions.json`). Decided 18 Nov (`TICKET-17`):

| Where | Cohort |
|---|---|
| `GET /api/program/summary` | included: it is what the programme view is for |
| `GET /api/cases`, `GET /api/unowned` | hidden by default, shown with `?cohort=include` |
| `GET /api/cases/{case_id}` and every write | as any other case |
| `tick` / `POST /api/clock/advance` | never ticked |

Why the clock leaves it alone: the cohort is generated as finished history, without the timers a running system would have written along the way. A tick over it does not show day-to-day behaviour; it replays the whole backlog at once. Measured on the first "+1 day" with the cohort ticked: 753 escalations, 120 referrals expired to unowned and 128 automated messages, against 0 to 2 escalations a day for the demo cases. The demo clock therefore drives the demo cases (and any case created through the API), and the cohort stays as it was generated, aging only in the sense that its deadlines are measured against the moving clock.

### Round trips per request

Deployed, every query is a round trip to Turso (about 20 to 50 ms), so the cost of a request is its number of round trips. With the cohort loaded (`npm run perf` prints these; `server/queryBudget.test.ts` keeps them):

| Request | Round trips before | after | at 30 ms per trip, after |
|---|---|---|---|
| `GET /api/cases` | 7 | 6 | about 0.2 s |
| `GET /api/cases/{case_id}` | 12 | 12 | about 0.4 s |
| `GET /api/program/summary` | 9 | 7 | about 0.5 s |
| `GET /api/unowned` | 5 | 3 | about 0.1 s |
| `POST /api/clock/advance` (day 1) | 2,252 | 16 | about 0.6 s (before: about 68 s) |
| `POST /api/clock/tick`, nothing due | 1,282 | 13 | about 0.5 s |
| one tick over all 1,003 cases (measured before the three mammography cases were seeded), cohort included (test only), day 1 / day 2 | 2,252 / 1,302 | 613 / 27 | about 21 s / 1.2 s |

The "before" column is the code before 18 Nov, which ticked the cohort too; the last row runs today's code with the cohort included on purpose, to compare like with like. Its day 1 is 120 cases made unowned at once, about five round trips each; that cost is per case made unowned, not per case open.

No read or tick runs a query per case any more: tick loads each table once for all cases (timers, actors, the outreach ladder's steps, events, tasks and links) and writes one batch. The one cost that still grows is a case that the tick makes unowned (one engine write with its own reads), which happens once per case.

## What the client may not do

- Compute a deadline, a stage, or `days_left_*`. Read them from the server.
- Decide whether closure is allowed. Show the server's `closure_conditions_unmet` details instead.
- Store extraction results or citations. Read them from `/verification`.
- Send a stage along with an event. The event `type` selects the transition; the server knows where the case is.

## Model and provider

`NEXYRA_MODEL` defaults to `deepseek/deepseek-v4.1-flash-1017`, called through an OpenAI-compatible chat completions endpoint (`LLM_BASE_URL`, `LLM_API_KEY`). Not Anthropic. Whatever model string is live is recorded, with the prompt version, in `docs/evaluation-results.md` (`TICKET-14`), so the published numbers name the model that produced them.

### `POST /api/ingest/hl7v2`

HL7 v2 `REF` and `ORU` messages (TICKET-25). Requires the `X-Nexyra-Actor` header like the FHIR ingest. The body is the message as `text/plain` (segments separated by `\r` or newlines) or JSON `{ "message": "MSH|..." }`. **Structure is generic HL7 v2.5; the Malaffi message specification has not been seen** (see `docs/architecture.md`, "HL7 v2 ingest"). MLLP and ADT/SIU are out of scope. The same function runs from the command line: `npm run ingest:hl7 -- data/hl7` (a file or a folder, in file-name order, written as the system actor; add `--json` for the full results).

One message answers the result object below; a body with several messages (each starting `MSH|`) answers `{ "results": [...], "counts": { "<outcome>": n } }`. The result is the "raw message next to the events it produced" view: `raw`, `segments`, `parsed` and `events`.

```json
{
  "raw": "MSH|^~\&|EREF_B|prov_hospital_b|...\rRF1|R^Rejected|...",
  "segments": [{ "segment": "MSH", "text": "MSH|..." }, { "segment": "RF1", "text": "RF1|R^Rejected|..." }],
  "message_type": "REF^I12^REF_I12",
  "control_id": "REF-4377-R2-REJ",
  "outcome": "applied",
  "parsed": { "kind": "REF", "referral_id": "REF-4377-R2", "status": "rejected", "patient_identifier": "NX-P-2002", "priority": "routine", "specialty": { "system": "http://snomed.info/sct", "code": "394584008", "display": "Gastroenterology" }, "referring_provider_id": "prov_clinic_a", "receiving_provider_id": "prov_hospital_b", "reason": "Colonoscopy request incomplete (hospital B)" },
  "case_id": "CX-H7-FIT-4377-26",
  "events": [{ "event_id": "ev_...", "type": "referral_rejected", "case_id": "CX-H7-FIT-4377-26", "stage": "patient_notified" }]
}
```

`outcome` is `created_case` (positive FIT), `applied` (a REF event recorded), `no_action` (negative FIT, or the referral is already in that state; `reason_code` says which) or `queued_unstitched` (`unstitched_id`, `reason_code`, `reason`; also listed by `GET /api/ingest/unstitched`, resource type `HL7v2`). A message answered before is `duplicate: true`. A bad message is still `200` with its reason; only a request with no message at all is `400`.

**Demo case 2 by HL7** (messages in `data/hl7`; the seeded CX-1002 is the same story already played, so the replay uses patient `NX-P-2002`): `02-oru-...` creates the case; a coordinator tells the patient (`POST /events` `patient_notified`); `06-ref-new-...` sends the referral (sent before that step it is held with `invalid_transition` and applies on replay); `09-ref-rejected-...` rejects it, and the case appears in `GET /api/unowned` with trigger `referral_rejected`. The consultation steps then continue as in "Demo case 2 through the API". `10-ref-rejected-seeded-CX-1002` answers `no_action` (`already_in_state`) because the seed already holds that rejection.
