# TICKET-08 · Unowned cases and event stitching

- **Priority:** P0 · **Day:** 16 Nov · **Estimate:** 3 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-05, TICKET-06
- **Status:** done-when met 18 Nov (server and API; no screen yet). Tests in `server/unowned.test.ts`, the CX-1002 walk in `server/consultation.test.ts`. Rules are template data (`unowned`, `stitching` blocks in `server/pathways/fit-colonoscopy.json`); writes in `server/events.ts`, matching in `server/ingest.ts`, tick trigger in `server/escalation.ts`. Probabilistic matching is designed in `docs/architecture.md`, not built.

## Goal

Nexyra's first differentiator. The challenge states the biggest gap is in handoffs between organizations, where case ownership is lost. Nexyra must capture that moment and stitch events from other providers onto the right case.

## Scope

- Three triggers for the `unowned` status:
  1. The referral is rejected by the receiving provider.
  2. The referral goes unanswered until the acceptance deadline passes.
  3. The patient is recorded as changing provider while the case is still open.
- When triggered: an event is recorded with its reason, an "assign owner" task is created for the referring provider's coordination staff, and the case appears in a dedicated list.
- Assigning a new owner is an event that records who handed over and who took over.
- Event stitching: `Appointment`, `Procedure`, and `DiagnosticReport` resources arriving from other providers are matched to open cases via patient identity and the originating referral. Events that match no case go into a "not yet stitched" queue instead of being discarded.
- The referral input shape follows the attributes named in DoH Circular 144/2026: referral status, priority, and SNOMED-coded specialty.
- Metric: time from trigger until the case has an owner again.

## Out of scope

Probabilistic identity matching (designed only, written up in the documentation). HL7 v2 message ingest (done in TICKET-25). Connection to Malaffi.

## Done when

- [x] A test for each of the three triggers (`trigger 1: a rejected referral…`, `fires from tick once the acceptance deadline passes, and only once`, `trigger 3: the patient moving provider…`)
- [x] Test: a colonoscopy performed at another hospital is stitched to the right case (`stitches a colonoscopy performed at another hospital to the right case`)
- [x] Test: an event with no matching case goes into the "not yet stitched" queue (`puts an event with no matching case in the not-yet-stitched queue, with its reason`)
- [x] The list of unowned cases can be fetched with a single query or endpoint (`GET /api/unowned`, one SQL query; test `is one endpoint, ordered server-side…`)
- [x] Time until the case has an owner again is recorded per case (`ownership_gaps.hours_to_owner`; test `records who handed over and who received, and stores the hours to owned again per case`)

## Notes

The unowned list and the not-yet-stitched queue have endpoints in [`docs/api.md`](../docs/api.md) (`GET /api/unowned`, `GET /api/ingest/unstitched`); rows are filtered and ordered server-side.

Do not call this feature a "referral tracker". Referral status tracking is already a function of Malaffi's e-Referral. What Nexyra adds is ownership at the screening-result level.
