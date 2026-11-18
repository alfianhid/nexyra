# TICKET-26 · Solution deck from the mandatory template

- **Priority:** P0 · **Day:** skeleton 17 Nov, full content 19 Nov · **Estimate:** 5 hours · **Assignee:** Claude Code drafts, human reviews
- **Depends on:** TICKET-01 (template), TICKET-14, TICKET-19
- **Status:** in progress

## Goal

The submission page states that the organizers' PPT template is mandatory for conveying everything requested. This deck is likely the document judges read most, and there is nowhere else to upload documentation.

## Scope

- Read the template first. Record every slide and every requested item in `docs/template-map.md`, then match it against the material already in the brief and in `docs/`.
- Fill in the template without changing the slide order, section titles, or layout. Do not delete slides the template asks for. If a section is irrelevant, fill it with a short explanation of why.
- English.
- Content that must appear, on whichever slide the template places it:
  - The problem, with numbers and their sources
  - What Nexyra does and for whom
  - Mapping to the six Challenge 05 requirements
  - Architecture and the role of AI
  - What was built during the challenge and what is only designed
  - Closure verification evaluation results as they are, with denominators
  - Assumptions, dependencies, and limitations
  - AI and data governance
  - Pilot path and positioning relative to Malaffi's e-Referral
  - The team, and the role of the external clinical reviewer
- Screenshots from the real prototype, not mockups.
- Export to PDF, **at most 5 MB**. Compress images if needed.

## Out of scope

Redesigning the template. Extra slides beyond what the template allows.

## Done when

- [ ] Every item the template requests is filled in, checked one by one against `docs/template-map.md`
- [ ] PDF size under 5 MB
- [ ] The PDF opens on another device with no cut-off text or changed fonts
- [ ] Every number has a source or an assumption label
- [ ] No claim that Nexyra is proven to improve patient outcomes
- [ ] DoH Circular 144/2026 is referenced by number and gist only
- [ ] One team member reads the deck from start to finish

## Notes

The submission page shows an "AI Evaluation Score", so the deck may be scored automatically before or alongside human judges. Write every slide so its answer is clearly readable from the text itself, and use the same terms as the scoring criteria and the challenge requirements. Do not put key information only inside images.

This ticket cannot start before the template is in the project folder.
