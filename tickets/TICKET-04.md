# TICKET-04 · FIT pathway template as configuration

- **Priority:** P0 · **Day:** 15 Nov · **Estimate:** 2 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-02
- **Status:** done 18 Nov. Template at `server/pathways/fit-colonoscopy.json` (the server lives in `server/`, not `src/engine`), loader and validation in `server/pathways/index.ts`, printout `npm run pathway:deadlines`. Stage keys follow `docs/api.md` (`result_received`, `patient_notified`, `referral_sent`, `referral_accepted`, `colonoscopy_booked`, `procedure_completed`, `pathology_ordered`, `pathology_received`, `closure_proposed`, `closure_confirmed`, `closed`) rather than the list in Scope, because the frontend, seed and tests already use them. Deadline values await TICKET-19.

## Goal

The pathway "positive FIT → colonoscopy → pathology → follow-up" is written as data, not as code. The case engine reads this template. That way other screening pathways (mammography, cervical, HbA1c) can be added without changing the engine, and colonoscopy is just the first pathway.

## Scope

- One file `src/pathways/fit-colonoscopy.json` (or `.ts`) with a schema validated when the application starts.
- Template contents:
  - Trigger: the lab result that creates a case (positive FIT).
  - Sequential stages: `result_received`, `patient_informed`, `patient_confirmed`, `referral_sent`, `referral_received`, `scheduled`, `procedure_completed`, `pathology_ready`, `follow_up_recorded`, `closed`.
  - Per stage: owning role, deadline in days, escalation ladder, and the event that moves the case to the next stage.
  - Valid final outcomes for closure: `returned_to_routine_screening`, `surveillance_scheduled`, `oncology_accepted_therapy_started`.
  - Evidence that must be present before a case may be proposed for closure.
- Every deadline carries a `source` field. Only "referral to colonoscopy ≤ 31 days" has a source (HAAD standard, cited in BMC Cancer 2021). Other deadlines are filled with reasonable initial values and marked `source: "unsourced, needs clinical review"`.

## Out of scope

A second pathway (TICKET-18). Clinical logic beyond what is written in the brief.

## Done when

- [x] The template passes schema validation, and a broken template makes the application fail to start with a clear message (`server/pathway.test.ts`)
- [x] No FIT pathway stage names or deadline numbers are written directly in `src/engine` (`server/engine.ts`; a test reads its source)
- [x] The deadline list with its sources can be printed with a single command, to bring to clinical review (TICKET-19): `npm run pathway:deadlines`

## Notes

There is no clinician on the team; the clinical reviewer is Fulan, a hospital colleague who is not a team member (TICKET-19). Do not add new clinical branches. Deadline values without sources will be corrected after TICKET-19.
