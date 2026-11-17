# TICKET-18 · Second pathway via configuration

- **Priority:** P2 · **Day:** 19 Nov · **Estimate:** 2 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-04, TICKET-05, TICKET-06
- **Status:** not started

## Goal

Proving the scalability claim: Nexyra is not limited to colonoscopy. Other screening pathways are added with a single template file, without changing the engine.

## Scope

- One new template in `src/pathways/`: **abnormal mammography → diagnostic imaging or biopsy → pathology → follow-up**.
- Stages, owners, and escalation ladder filled in. All deadlines marked `source: "unsourced, needs clinical review"`.
- Two or three synthetic cases on this pathway that run on the same engine and appear in the same worklist.
- A note in `docs/architecture.md`: what has to be written to add a pathway (template, patient message templates, closure evidence rules) and what does not need touching.

## Out of scope

Report verification for this pathway. Mammography or biopsy report test sets. Arabic patient message templates.

## Done when

- [ ] `git diff` for this ticket does not touch `src/engine`
- [ ] Second-pathway cases move, escalate, and appear in the worklist like FIT cases
- [ ] Test: both pathways run side by side without affecting each other
- [ ] The documentation states clearly that this pathway is configuration proof only and has not been clinically reviewed

## Notes

Mammography was chosen because DoH has a breast cancer screening and diagnosis standard (version 2, effective August 2025). We have not read the time limits in that standard, and no published local follow-up numbers exist for this pathway.

This is the first ticket to cut if time runs out. If it is cut, the claim "other pathways only need a template" may still be presented as a design, but not as something that has been demonstrated.
