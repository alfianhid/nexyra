# TICKET-11 · Inter-clinician consultation monitoring

- **Priority:** P1 · **Day:** 18 Nov · **Estimate:** 2 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-08, TICKET-09
- **Status:** not started

## Goal

Challenge requirement 4 asks for support for timely inter-clinician consultation. DoH Circular 144/2026 states Malaffi's e-Referral is already meant for communication between referrer and receiver. So Nexyra does not create a new messaging channel. Nexyra makes sure that the questions asked have an owner, a response deadline, and are recorded on the case.

## Scope

- When a referral is rejected or needs clarification, the referring physician can open a "consultation request" on the case: one short question, addressed to the receiving provider.
- The request becomes a task for the receiving physician, with a response deadline from the template.
- The answer is recorded as an event. The outcome is one of: referral accepted, referral redirected to another provider, or additional data requested.
- A missed response deadline escalates through the TICKET-06 mechanism.
- Metric: time until the consultation is answered.
- In the documentation, state that in production the message exchange runs through e-Referral and Nexyra only monitors its status.

## Out of scope

Real-time chat, file attachments, video calls.

## Done when

- [ ] Test: a consultation request creates a task with an owner and a deadline
- [ ] Test: each answer type moves the case to the correct state
- [ ] Test: an unanswered consultation escalates
- [ ] Demo case 2 (TICKET-17) uses this feature

## Notes

If time runs out, cut this ticket and finish demo case 2 with just the new-owner assignment (TICKET-08). Consultation can then be described in `docs/architecture.md` as a design.
