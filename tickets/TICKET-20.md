# TICKET-20 · Submission documentation

- **Priority:** P0 · **Day:** 19 Nov · **Estimate:** 4 hours · **Assignee:** Claude Code drafts, human proofreads
- **Depends on:** TICKET-14, TICKET-19
- **Status:** not started

## Goal

The competition page asks for a prototype accompanied by technical documentation and a clear statement of assumptions, dependencies, and limitations. This document is judged, not a supplement.

## Scope

The submission form has no field for uploading documentation. Judges read it through the deck (TICKET-26) and through the prototype or repository link. So the documents in this ticket are source material for the deck and must be reachable from the prototype link.

All in English, in the `docs/` folder.

- `README.md`: what Nexyra is in three sentences, how to install and run, how to repeat the demo, how to run the evaluation.
- `docs/architecture.md`: component diagram, event model, timer engine, pathway templates, closure verification, and where Nexyra attaches to Malaffi data (lab results, referrals, appointments).
- `docs/assumptions.md`: every assumption with its source. Including all generator parameters, every deadline without a source, and the effect sizes from the literature used in the scenario panel.
- `docs/dependencies.md`: what a pilot needs and does not have yet. Access to Malaffi data, DoH approval, local clinical review, language review by native speakers, policies on using AI models with clinical data.
- `docs/limitations.md`, written candidly:
  - All data synthetic, drop-off rates are inputs
  - Test reports written by the team with AI help, small in number
  - Impact on patients not yet proven
  - Flow reviewed by one clinician outside Abu Dhabi, mention the parts that were not reviewed
  - No real integrations yet
  - No clinician on the team; the external reviewer is Fulan, a hospital colleague who checked the pathway and the labels
- `docs/data-sources.md`: a statement that no personal data was used, and a list of all sources.
- `docs/evidence.md`: summary of evidence from the brief, with numbers and caveats exactly as in the source.
- `docs/responsible-ai.md`: the role of AI, what it is not allowed to do, the tests that enforce this (from TICKET-05 and TICKET-13), and the evaluation results as they are.

## Out of scope

Long business plans. Financial projections.

## Done when

- [ ] Someone outside the team can run the demo following only the README
- [ ] Every number in the documentation has a source or an assumption label
- [ ] No sentence claims Nexyra is "proven" to improve patient outcomes
- [ ] No sentence claims risk-prediction-based navigation is "proven"
- [ ] DoH Circular 144/2026 is referenced by number and gist only, without copying the document
- [ ] One team member reads everything from start to finish

## Notes

The clinical reviewer (TICKET-19) is Fulan, a hospital colleague who is not a team member; he is credited as he permitted.
