# TICKET-25 · HL7 v2 message ingest for referrals and lab results

- **Priority:** P1 · **Day:** 18 Nov · **Estimate:** 3–4 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-05, TICKET-08
- **Status:** not started

## Goal

DoH Circular 144/2026 requires all facilities to send referral transactions to Malaffi as HL7 REF messages, with priority and SNOMED-coded specialty. If Nexyra can receive the same message types, judges from DoH and M42 see immediately that Nexyra attaches to data they already mandate, with no new data entry. This answers the word "low-friction" in the challenge's key question.

## Scope

- A `src/ingest/hl7v2` module that takes HL7 v2 message text and turns it into events in the case engine. Use an existing parser library, do not write your own parser.
- Two message types:
  - **Referral (REF):** new, accepted, rejected referrals. Capture patient identity, referring and receiving provider, priority, and SNOMED-coded specialty.
  - **Lab results (ORU):** positive FIT results that create a case.
- Ten to fifteen synthetic messages in `data/hl7/`, including a message for demo case 2 (rejected referral).
- Broken or unrecognized messages go to the "not yet stitched" queue (TICKET-08) with a reason, without crashing the application.
- One endpoint or command to ingest messages, and one simple view showing the raw message alongside the events it produced.

## Out of scope

Connection to Malaffi. MLLP transport protocol. Other message types (ADT, SIU). Full compliance with the Malaffi implementation guide.

## Done when

- [ ] Test: an ORU message with a positive FIT creates one case with an initial owner
- [ ] Test: a REF "rejected" message triggers the `unowned` status via TICKET-08
- [ ] Test: a broken message does not crash the application and is recorded with its reason
- [ ] Demo case 2 can be run by ingesting an HL7 message, not by pressing a simulation button
- [ ] The documentation states clearly that the message structure follows generic HL7 v2, because we have never seen the Malaffi message specification

## Notes

The only thing read first-hand is the content of Circular 144/2026 about REF messages. The statement that lab results and schedules must also be sent as HL7 messages comes from search-result summaries about another circular, so do not cite it as fact before the document itself is read.
