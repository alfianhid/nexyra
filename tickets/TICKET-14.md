# TICKET-14 · Closure verification evaluation

- **Priority:** P0 · **Day:** 17 Nov · **Estimate:** 2 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-12, TICKET-13
- **Status:** done (18 Nov 2026). Run with `muse-spark-1.3` (Meta Model API), prompt `extract-v1`, 24 synthetic reports, each read fresh. Must-not-close: 14 of 14 held back, 0 of 14 proposed for closure (no dangerous error). May-be-closed: 4 of 10 proposed, 6 of 10 held back (false alarms). Fields: complete_exam 24 of 24, pathology_available 24 of 24, next_step 23 of 24, tissue_taken 20 of 24, outcome_category 16 of 24, adequate_prep 15 of 24. 1 citation rejected. 0 prompt changes after seeing results. Results: `docs/evaluation-results.md`. Labels not yet checked by a clinician.

## Goal

Challenge requirement 6 asks for evidence of improvement on a relevant metric. This is the only number we can measure ourselves without inventing patient behavior, so it must be reproducible by anyone.

## Scope

- An `npm run eval` script that runs TICKET-13 over the entire TICKET-12 test set and compares against `label.json`.
- Output to the screen and to `docs/evaluation-results.md`:
  - Of the reports that must **not** be closed: how many were correctly held back, and how many slipped through as `propose_closure` (this is the dangerous error).
  - Of the reports that **may** be closed: how many were correctly proposed for closure, and how many were held back (false alarms).
  - Accuracy per field.
  - Number of citations that failed validation.
  - A list of every wrong report, with the expected and the actual values.
- Record the date, model name, and prompt version in the evaluation results.
- All numbers are written as fractions with their denominators (e.g. "11 out of 12"), not percentages alone. With 24 reports, percentages look more certain than they really are.

## Out of scope

Tuning the prompt over and over until the numbers are perfect on the same set.

## Done when

- [x] `npm run eval` runs from start to finish and writes `docs/evaluation-results.md`
- [x] The results reported are the real results, errors included
- [x] (none slipped: 0 of 14) If any report that must not be closed slips through as `propose_closure`, that is written at the very top of the results and brought to the team
- [x] A limitations sentence is present in the results file: synthetic test reports, team-written, small in number

## Notes

If the prompt is changed after seeing results, record how many times it was changed. Final numbers on a set that was also used to tune the prompt are not a clean measure, and that must be stated plainly in the demo.
