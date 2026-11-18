# TICKET-07 · Synthetic data generator

- **Priority:** P0 · **Day:** 16 Nov · **Estimate:** 3 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-03, TICKET-04
- **Status:** done (the command is `npm run seed:cohort`; since 18 Nov `npm run demo:reset` loads the cohort itself, see TICKET-17; `npm run seed` is still the three-case demo seed). Clinical sources for the pathology mix and screening age band are still team guesses, awaiting TICKET-19.

## Goal

The organizers provide no data at all. We need a synthetic cohort shaped like clinical data, with all assumptions written down.

## Scope

- A `npm run seed` script that creates around 1,000 positive FIT cases along with their event histories, with a fixed random seed so results are reproducible.
- Incoming data as FHIR resources in JSON: `Patient`, `Observation` (FIT result), `ServiceRequest` (referral), `Appointment`, `Procedure` (colonoscopy), `DiagnosticReport` (report). Cases are created by feeding these resources into the engine, not by writing straight to tables.
- A `data/generator-assumptions.json` file holding every parameter with its name, value, and source: the proportions that drop out at each stage, the time distribution between stages, the proportion of rejected referrals, the proportion of patients changing provider, the distribution of patient languages, the proportions of pathology outcomes.
- Parameters that come from the literature carry a citation (see the sources section in the brief). Guessed parameters are tagged `team guess`.
- Patient, provider, and doctor names are all fictional and clearly look fictional.

## Out of scope

Synthea, because it does not model patients who drop out midway through the FIT pathway. Complex patient behavior models. Real patient data of any kind.

## Done when

- [x] `npm run seed:cohort` twice (after a reset) produces exactly the same data
- [x] Every seeded case passes `rebuildCase` (TICKET-03) without errors
- [x] `data/generator-assumptions.json` is complete and every parameter has a `source`
- [x] Changing one drop-off parameter changes the funnel in the expected direction
- [x] No name, identity number, or address resembles a real person

## Notes

The drop-off rates here are inputs, not findings. Never present them as Nexyra results. This sentence must also go into `docs/limitations.md` (TICKET-20).
