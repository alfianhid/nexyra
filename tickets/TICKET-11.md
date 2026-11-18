# TICKET-11 · Inter-clinician consultation monitoring

- **Priority:** P1 · **Day:** 18 Nov · **Estimate:** 2 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-08, TICKET-09
- **Status:** done-when met 18 Nov through the API (no screen yet). Tests in `server/consultation.test.ts`. Endpoints `POST /api/cases/{id}/consultations` and `POST /api/consultations/{id}/answer`; rules in the template's `consultation` block; the e-Referral note is in `docs/api.md` and `docs/architecture.md`.

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

- [x] Test: a consultation request creates a task with an owner and a deadline (`creates a task with an owner and a deadline for the receiving physician`)
- [x] Test: each answer type moves the case to the correct state (`accepted: …`, `redirected: …`, `more data requested: …`, `on an unowned case, every answer gives the case an owner`)
- [x] Test: an unanswered consultation escalates (`escalates past its deadline through tick, once per level, and stops when answered`)
- [x] Demo case 2 (TICKET-17) uses this feature: through the API (`CX-1002 through the API`, steps in `docs/api.md`). The case page buttons and `docs/demo-script.md` are TICKET-17's.

## Notes

If time runs out, cut this ticket and finish demo case 2 with just the new-owner assignment (TICKET-08). Consultation can then be described in `docs/architecture.md` as a design.
