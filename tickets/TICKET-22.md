# TICKET-22 · Recording rehearsal and Q&A preparation

- **Priority:** P0 for recording rehearsal, P1 for Q&A · **Day:** 19 Nov · **Estimate:** 2 hours · **Assignee:** human
- **Depends on:** TICKET-17
- **Status:** not started

## Goal

At the submission stage, judges watch a video under 3 minutes, not a live presentation. The 7-minute presentation with 3 minutes of Q&A mentioned in the competition rules only applies if the team is called to the next stage. So rehearsal now is aimed at the video, and Q&A preparation is done afterwards.

## Scope

### Recording rehearsal (P0)

- Three timed rehearsals following `docs/video-script.md` before recording for TICKET-21.
- One person speaks, one person operates the screen. Reset the demo before each attempt.
- Watch the recording once without sound, then once with sound. Without sound, viewers must still understand what is happening.
- Ask someone outside the team to watch and retell what Nexyra does. If the retelling is off, fix the script.

### Q&A preparation (P1, continues after submission)

- Answers to the six questions in the "Jury Q&A" section of the brief:
  1. How is this different from Malaffi's e-Referral?
  2. Why not use a predictive model?
  3. Aren't automatic reminders enough?
  4. The data is synthetic; what is actually proven?
  5. What if AI misreads a report?
  6. Who on the team understands the clinical side?
- Add: "Why colonoscopy?" and "What are your evaluation numbers?". The latter uses the figures from `docs/evaluation-results.md` with their denominators.
- The 7-minute demo script from TICKET-17 is kept for this stage.

## Done when

- [ ] A recording completes under 3 minutes in two consecutive rehearsals
- [ ] Someone outside the team can retell the video's content correctly
- [ ] Every number spoken matches the documentation
- [ ] Nobody states impact on patients as a result, or precision navigation as proven

## Notes

If bugs are found during rehearsal, record them as fixes for TICKET-23. Do not add features.
