# TICKET-09 · Worklist and case detail page

- **Priority:** P0 · **Day:** 16 Nov · **Estimate:** 4 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-05, TICKET-06
- **Status:** done (checked 18 Nov against the code). Worklist and case detail are `src/pages/Worklist.tsx` and `src/pages/CaseDetail.tsx`; boxes not re-audited line by line here.

## Goal

The working screen for coordination staff, navigators, and the responsible physician. This is the screen that is on display the longest during the demo.

## Scope

- A role picker at the top (no real login) to switch between coordination staff, navigator, physician, and program manager.
- **Worklist:** tasks belonging to the selected role, ordered by (1) clinical urgency from the template, then (2) time remaining to deadline. No predictive scoring.
- Each row: patient, current stage, owner, days left to the stage deadline, days left to the 31-day limit, and flags (late, unowned, awaiting closure confirmation).
- Status is conveyed through text and shape, not color alone.
- **Case detail:** a timeline from the audit trail (who, when, what), stages passed and still ahead, attached documents, open tasks, and the action buttons valid for that role.
- The demo date indicator and clock controls (TICKET-06) are always visible.
- Interface language: English, because the judges and users are in Abu Dhabi.

## Out of scope

Authentication, real per-user access control, a polished mobile layout.

## Done when

- [ ] The worklist reorders correctly after the clock advances
- [ ] Late and unowned cases can be recognized without relying on color
- [ ] The timeline in the case detail matches the contents of the `events` table
- [ ] Action buttons invalid for a role do not appear, and the server still rejects them if called directly
- [ ] Pages read clearly on a projector: text large enough, no tables cut off at 1280 px width

## Notes

Endpoints, response shapes, and the actor header are fixed in [`docs/api.md`](../docs/api.md). `GET /api/cases` and `GET /api/cases/{case_id}` already return `flags_renderable` and `available_actions`, so the UI does not compute either.

Avoid a full dashboard of numbers. A judge must be able to follow one case from left to right in a few seconds.
