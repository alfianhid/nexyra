# TICKET-17 · Three demo cases with one-command reset

- **Priority:** P0 · **Day:** 18 Nov · **Estimate:** 3 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-08, TICKET-10, TICKET-15
- **Status:** in progress. 18 Nov: case 2 (CX-1002) runs step by step through the API from the seed's unowned start (moved clinic, consultation, new owner, stitched booking); the steps are in `docs/api.md` and tested in `server/consultation.test.ts`. Cases 1 and 3, the UI walk and `docs/demo-script.md` are open.

## Goal

The 7-minute demo must be repeatable exactly, again and again, including minutes before the presentation.

## Scope

- `npm run demo:reset` returns the database to the demo's starting state: the synthetic cohort is populated, the demo clock is on day 0, and the three demo cases are ready in the worklist.
- Three cases, all fictional characters:
  1. **The silent patient.** 58-year-old man, Arabic-speaking. Messages unanswered, escalates to a staff call, then a navigator who records that the patient fears the colonoscopy prep. Colonoscopy on day 19.
  2. **Referral rejected, patient moves.** 47-year-old expatriate worker. Referral rejected for insufficient data, the patient changes clinic, the case becomes unowned, then gets a new owner (with a consultation if TICKET-11 is finished).
  3. **"Done" that is not done.** Colonoscopy performed and staff mark it finished. Verification finds inadequate prep and cecum not reached. The case is reopened. A repeat colonoscopy finds a polyp, pathology comes out, a surveillance schedule is recorded, the clinician confirms closure.
- A step-by-step script in `docs/demo-script.md`: which screen, which button, how many days the clock advances, and what is said. Order on stage: case 3 first, then 2, then 1, then the program view.
- This script is the long version (7 minutes) for a live presentation if the team is called. The submission video must be under 3 minutes and has its own script in TICKET-21, so case 3 and case 2 must each be showable in under one minute.
- Extraction results for case 3's report are already cached, so the demo does not depend on a network.

## Out of scope

Automated tours or animations. A fourth demo case.

## Done when

- [ ] `npm run demo:reset` finishes in under a minute and always produces the same result
- [ ] All three cases run from start to finish following the script, without touching the database
- [ ] The demo runs with the network turned off
- [ ] A first-time reader can complete the script in 7 minutes
- [ ] Case 3 and case 2 can each be shown in under one minute
- [ ] Automated tests run all three scenarios through the API and check the final state

## Notes

Do not change demo case data after TICKET-22 (rehearsal) starts, except to fix bugs.
