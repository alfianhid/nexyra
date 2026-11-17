# TICKET-03 · Data model and audit trail

- **Priority:** P0 · **Day:** 15 Nov · **Estimate:** 2–3 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-02
- **Status:** not started

## Goal

Everything that happens to a case is recorded as immutable events, and the case status is computed from that record. This is what answers the "documented closure" requirement in the challenge.

## Scope

- `events` table: `id`, `case_id`, `type`, `actor_id`, `actor_role`, `occurred_at`, `recorded_at`, `payload` (JSON). Append-only. No `UPDATE` or `DELETE` in code.
- `cases` table: case identity, patient, pathway (`pathway_id`), current provider. The status columns here are computed from `events` and can be rebuilt at any time.
- `patients`, `providers`, `actors` tables (roles: coordination staff, navigator, responsible physician, program manager, patient, system).
- `tasks` table: work for humans (phone the patient, answer a consultation, confirm closure), with an owner, a deadline, and a status.
- `documents` table: colonoscopy and pathology report text attached to the case.
- `appendEvent()` and `rebuildCase(caseId)` functions that recompute the status from events.

## Out of scope

Transition rules (TICKET-05), timers (TICKET-06).

## Done when

- [ ] Test: after deleting the computed status columns, `rebuildCase` produces exactly the same status
- [ ] Test: no code path modifies or deletes `events` rows
- [ ] Every event records who did it and their role
- [ ] The schema is documented briefly in `docs/architecture.md`

## Notes

`occurred_at` uses the clock from TICKET-06 (the demo clock), `recorded_at` uses real time. Do not call `Date.now()` directly in the case engine.
