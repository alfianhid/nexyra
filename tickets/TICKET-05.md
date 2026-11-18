# TICKET-05 · Case state machine and closure rules

- **Priority:** P0 · **Day:** 15 Nov · **Estimate:** 3 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-03, TICKET-04
- **Status:** done-when met 18 Nov. Named tests in `server/caseEngine.test.ts` (prefixed `TICKET-05:`), plus `server/engine.test.ts` and the endpoint tests in `server/writes.test.ts`. A rejected referral leaves the case explicitly unowned (TICKET-08 trigger 1) rather than handing it back automatically; assigning the new owner is its own `owner_assigned` event. Creating the assign-owner task on that trigger belongs to TICKET-08.

## Goal

The core of Nexyra: a case can only move through valid transitions, always has an owner, and cannot be closed without evidence and human confirmation.

## Scope

- An `applyEvent(case, event)` function that validates transitions against the pathway template, then records the event via `appendEvent()`.
- Case creation from a positive FIT result, with the initial owner per the template.
- Every stage has exactly one owner. Ownership changes are events in their own right.
- Backward paths: `procedure_completed` returns to `referral_sent` if the examination is incomplete; a rejected referral returns the case to its previous owner.
- Closure rules, enforced in the engine and not in the UI:
  1. One of the valid final outcomes from the template exists.
  2. The required evidence for that outcome is attached to the case.
  3. A `closure_confirmed` event exists from an actor with the responsible physician role.
- Events from the `system` role (including AI) can never close a case.

## Out of scope

Timers and escalation (TICKET-06), report extraction (TICKET-13), UI.

## Done when

- [x] Test: a case runs from `result_received` to `closed` through a valid sequence of events
- [x] Test: transitions that skip stages are rejected
- [x] Test: closure is rejected if any one of the three conditions is unmet
- [x] Test: closure by the `system` role or coordination staff is rejected
- [x] Test: an incomplete colonoscopy reopens the case and assigns an owner
- [x] Test: there is no state where an open case has no owner, except the explicit `unowned` status (TICKET-08)

## Notes

The server-side guards and the role permission table are in [`docs/api.md`](../docs/api.md). `available_actions` is computed by the engine, and a test calls each guarded endpoint directly to prove the UI is not the only defence.

The tests in this ticket are evidence for the "Responsible AI, safety and data governance" criterion. Name them so they can be cited in the documentation.
