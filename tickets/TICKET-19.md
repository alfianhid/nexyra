# TICKET-19 · Clinical review

- **Priority:** P0 · **Day:** 18 Nov · **Estimate:** 1–2 hours session, 1–2 hours fixes · **Assignee:** Fulan (hospital colleague, not a team member)
- **Depends on:** TICKET-04, TICKET-12
- **Status:** not started

## Goal

No one on the team is a clinician. The flow after a positive FIT, especially the branches after pathology, was assembled from published guidelines and general logic. Someone who has worked in a clinic must check it before a judge finds the mistakes. That person is **Fulan**, a hospital colleague and the same reviewer who checks the TICKET-12 labels.

## Scope

- **Today (17 Nov):** confirm the session time with Fulan for 18 Nov. Do not delay, because other people's schedules cannot be rushed. If 18 Nov cannot work, the review still has to happen before TICKET-26's deck skeleton is finalised.
- Materials to bring: the flow diagram from the brief, the printed stage and deadline list from TICKET-04, and four to six sample reports from TICKET-12.
- Questions:
  1. Do the steps from positive FIT to colonoscopy match practice? Is anything missing?
  2. Who informs the patient, and what deadlines are reasonable at each stage?
  3. At which point do patients most often drop out, and what are their reasons for delaying?
  4. When is a colonoscopy considered incomplete and needing to be repeated?
  5. After pathology comes out, what is the right step for normal, polyp, and cancer results? Who sets the surveillance schedule?
  6. When may a case be declared finished, and who is authorized to do so?
  7. If a referral is rejected, who usually follows up?
  8. Do the sample reports look like real reports? What is off about them?
  9. Is any part of the product clinically dangerous or misleading?
- Write the results in `docs/clinical-review.md`: reviewer name and background (with their permission), date, what was reviewed, what changed, and what did **not** get reviewed.
- Apply corrections to the template (TICKET-04) and the labels (TICKET-12).

## Done when

- [ ] The session happened and the notes are in `docs/clinical-review.md`
- [ ] Every correction has been applied or recorded as a limitation
- [ ] Deadlines confirmed by the reviewer carry `source: "clinical review, <date>"`
- [ ] The reviewer agrees to have their name and role mentioned in the documentation, or is credited without a name

## Notes

**Flagged: the session time must be confirmed in writing on 17 Nov.** Materials, prompts, and reminders are in [`docs/review-slots.md`](../docs/review-slots.md). If the full session cannot happen, do the partial review of the closure rule and the post-pathology branches, and record exactly what was not reviewed.

Fulan is not a team member, so the checkpoint attendance rules do not apply to him. Do not ask for or use patient data from his workplace. His experience is in Indonesia, not in Abu Dhabi, and that is written down as it is.
