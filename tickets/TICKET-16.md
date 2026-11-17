# TICKET-16 · Program view

- **Priority:** P0 · **Day:** 18 Nov · **Estimate:** 3 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-07, TICKET-08
- **Status:** not started

## Goal

The screen for the screening program manager: where cases stall, which ones need action now, and how often closures are held back by verification.

## Scope

- **Exception list** at the top, because this is what is actionable:
  - Unowned cases, with how long
  - Cases past the 31-day limit
  - Closures held back by verification
  - Events not yet stitched to a case
- **Funnel** from result intake to closure for the synthetic cohort, with the number of cases at each stage and median days between stages.
- Time from referral to colonoscopy compared against the 31-day limit.
- Delay reasons recorded by staff (TICKET-10), as counts.
- Number of escalations per role per day.
- A label fixed on screen: "Synthetic data. Drop-off rates are input assumptions, not results."
- If time allows: a "scenario" panel computing how many additional cases would complete if outreach raised follow-up by about 8 points as in the Atlas 2023 trial. This panel is titled "Scenario based on assumptions" and cites its source.

## Out of scope

Comparisons by nationality, gender, or age. Time-trend charts. Export.

## Done when

- [ ] Funnel numbers match direct counts from the `events` table
- [ ] Every row in the exception list opens its case
- [ ] The synthetic-data label is visible without scrolling
- [ ] No number on this screen can be read as Nexyra's impact on patients, except the labeled scenario panel
- [ ] Charts read well in light mode on a projector

## Notes

`GET /api/program/summary` returns every section on this screen in one call, and its funnel is computed from the `events` table at request time ([`docs/api.md`](../docs/api.md)).

If time runs out, keep the exception list and drop the funnel.
