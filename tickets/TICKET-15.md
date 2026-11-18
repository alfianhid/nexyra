# TICKET-15 · Closure confirmation screen

- **Priority:** P0 · **Day:** 17 Nov · **Estimate:** 3 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-09, TICKET-13
- **Status:** done (18 Nov). `POST /api/cases/{id}/proposal/reject` records `proposal_rejected` with a reason and never moves the case; **Reopen case** records `procedure_incomplete` with the AI reading's reasons; the closure review reads the case's latest report; the programme view counts `ai_divergence` (rejections plus closures confirmed against the last reading). Earlier note: 18 Nov: `GET /api/cases/{id}/verification` (`extraction.proposed_outcome`) and the case payload's `verification.proposed_outcome` now name the outcome a `propose_closure` asks for, via `proposedOutcomeFor` (tests `TICKET-15: the verification carries proposed_outcome` in `server/consultation.test.ts`).

## Goal

The demo's key moment: a case is marked finished, Nexyra shows from its own report that it is not finished, and the clinician decides. A judge must understand this screen within ten seconds.

## Scope

- A two-pane view on the case page for the responsible physician role:
  - Left pane: the full report text.
  - Right pane: the list of extraction fields, each with its value and citation.
- Selecting a field highlights its source sentence in the report text.
- Fields valued `unknown` stand out with the note "not found in the report".
- The system's proposal is shown as a proposal, with a clear label that it comes from AI: reopen, wait for pathology, needs human reading, or propose closure.
- Clinician actions: "Confirm closure" (only active when TICKET-05's rules are met), "Reopen case", and "Reject proposal" with a short reason. Every action is recorded as an event in that clinician's name.
- The clinician may decide differently from the AI proposal. The divergence is recorded and counted in the program view (TICKET-16).

## Out of scope

Editing extraction results. Free-form annotation on the report text.

## Done when

- [ ] Citation highlighting lands exactly on the right sentence for every report in the test set
- [ ] The confirm button is inactive when the conditions are unmet, and the server rejects it if called directly
- [ ] Clinician decisions appear in the case timeline with their name and role
- [ ] AI proposals never appear as decisions
- [ ] The screen reads well on a projector at 1280 px width

## Notes

`GET /api/cases/{case_id}/verification` returns the report, the fields, and a `quote_offset` per citation, so highlighting never depends on a client-side text search ([`docs/api.md`](../docs/api.md)). Confirmation failures come back as `409 closure_conditions_unmet` with per-condition details.

Demo case 3 (TICKET-17) opens on this screen. Test with the "inadequate prep" and "cecum not reached" reports first.
