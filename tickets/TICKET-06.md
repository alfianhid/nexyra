# TICKET-06 · Timers, demo clock, and escalation

- **Priority:** P0 · **Day:** 16 Nov · **Estimate:** 3–4 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-05
- **Status:** not started

## Goal

Cases move on their own as time passes: a stage that goes past its deadline escalates to the next person without anyone pressing a button. This is what sets Nexyra apart from a status table.

## Scope

- A `Clock` abstraction with two implementations: real clock and demo clock. The demo clock is stored in the database so it survives application restarts.
- `timers` table: `case_id`, stage, `due_at`, escalation level, status. A timer is created when a case enters a stage and cancelled when the case leaves that stage.
- A `tick(now)` function that processes all due timers: records a `deadline_missed` event, creates a task for the next role on the escalation ladder (coordination staff → responsible physician → program manager), and sets the next-level timer.
- `tick` must be idempotent: running it twice at the same time does not double escalations.
- Demo clock controls in the UI and via API: "advance 1 day", "advance to next deadline", and an always-visible demo date indicator.
- Special counter: days remaining until the 31-day limit from `referral_sent`.

## Out of scope

External workflow engines like Temporal. Real notifications (email, SMS).

## Done when

- [ ] Test: advancing the clock past a deadline causes exactly one escalation per level
- [ ] Test: a repeated `tick` does not double anything
- [ ] Test: the application is shut down and started again, and the timers and demo clock are unchanged
- [ ] Test: a case that leaves a stage before the deadline is never escalated
- [ ] In the UI, pressing "advance 1 day" changes the worklist without manually reloading data

## Notes

The clock endpoints (`GET /api/clock`, `POST /api/clock/advance`, `POST /api/clock/reset`) are fixed in [`docs/api.md`](../docs/api.md); `advance` returns counts of what changed so the UI can show the effect.

Measure and display the number of escalations per role per demo day. That number is used to answer judges' questions about alert fatigue.
