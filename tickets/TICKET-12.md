# TICKET-12 · Labeled report test set

- **Priority:** P0 · **Day:** 16 Nov · **Estimate:** 3 hours · **Assignee:** Claude Code writes, Fulan checks the labels
- **Depends on:** TICKET-02
- **Status:** not started

## Goal

Closure verification needs test material with answers fixed in advance. Without it, the claim "AI catches wrong closures" has no numbers behind it.

## Scope

- About 24 synthetic English reports in `data/test-reports/`, one text file each, written following the common structure of colonoscopy and pathology reports (indication, bowel prep quality, extent of the exam, findings, actions, recommendations).
- Case distribution:
  - 6 complete exams, no findings
  - 4 complete with polyps removed, pathology available
  - 2 complete with cancer findings on pathology
  - 4 incomplete exams (cecum not reached)
  - 3 inadequate bowel prep
  - 3 tissue taken but pathology not yet out
  - 2 ambiguous: key information missing or contradictory
- Style variation: some neat with section headings, some one-paragraph narratives, some full of abbreviations.
- A `data/test-reports/label.json` file, written **before** extraction has ever been run. Per report: complete exam (yes/no/not stated), adequate prep, tissue taken, pathology available, outcome category, documented next steps, and `may_be_proposed_for_closure` (yes/no).
- One team member reads all reports and checks the labels by hand. Record who and when. The label checker is **Fulan**, a hospital colleague who is not a team member; schedule the slot before TICKET-13 is run.

## Out of scope

Real reports from any hospital. Arabic reports.

## Done when

- [ ] 24 reports and `label.json` exist, and the distribution matches the list above
- [ ] Labels are checked by Fulan before TICKET-13 is run on this set
- [ ] Labels are not changed after seeing extraction results, unless a label was genuinely wrong, and every change is recorded with its reason
- [ ] Four to six reports are flagged to show the clinical reviewer (TICKET-19)

## Notes

**Flagged: this ticket is the critical path.** Fulan must finish the label check by the end of 17 Nov and before TICKET-13 is run; see [`docs/review-slots.md`](../docs/review-slots.md). If only part of the set can be reviewed, ask for the reports that decide `may_be_proposed_for_closure` first.

These reports were written with AI help and are then read by AI. That is a real weakness: the results prove the mechanism, not accuracy on real hospital reports. Write that plainly in `docs/limitations.md`. The report-writing prompt and the extraction prompt must be separate, and the report writer must not see the extraction prompt.
