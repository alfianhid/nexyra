# TICKET-18 · Second pathway via configuration

- **Priority:** P2 · **Day:** 19 Nov · **Estimate:** 2 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-04, TICKET-05, TICKET-06
- **Status:** done 18 Nov (server side; no new frontend screen. See "What was built" below.)

## Goal

Proving the scalability claim: Nexyra is not limited to colonoscopy. Other screening pathways are added with a single template file, without changing the engine.

## Scope

- One new template in `src/pathways/`: **abnormal mammography → diagnostic imaging or biopsy → pathology → follow-up**.
- Stages, owners, and escalation ladder filled in. All deadlines marked `source: "unsourced, needs clinical review"`.
- Two or three synthetic cases on this pathway that run on the same engine and appear in the same worklist.
- A note in `docs/architecture.md`: what has to be written to add a pathway (template, patient message templates, closure evidence rules) and what does not need touching.

## Out of scope

Report verification for this pathway. Mammography or biopsy report test sets. Arabic patient message templates.

## Done when

- [ ] `git diff` for this ticket does not touch `src/engine`. **Not met as written.** The engine ran one pathway for every case, so this ticket had to add routing by `cases.pathway_id` to `server/engine.ts`, once. It adds no stage, event or deadline there. The replacement criterion is the next box.
- [x] After this ticket, a further pathway needs only a JSON file: `server/secondPathway.test.ts` runs a third template from a JSON file alone, and fails if any mammography stage, event, deadline or pathway id appears in `server/engine.ts`. File list in `docs/architecture.md`, "Adding a pathway".
- [x] Second-pathway cases move, escalate, and appear in the worklist like FIT cases (`server/secondPathway.test.ts`: "...appear in the worklist like FIT cases", "...escalate like FIT cases", "...move like FIT cases")
- [x] Test: both pathways run side by side without affecting each other (`server/secondPathway.test.ts`, same name)
- [x] The documentation states clearly that this pathway is configuration proof only and has not been clinically reviewed (`docs/limitations.md`, `docs/architecture.md`, `docs/api.md`, and the template's own `description`)

## What was built

- `server/pathways/mammography-biopsy.json`: 11 stages, owners (breast care navigator, then the responsible physician), an escalation ladder per stage, `unowned` and `consultation` blocks, one limit (referral to diagnostic imaging, 21 days), three outcomes with their evidence. Every deadline is `"unsourced, needs clinical review"`.
- The registry loads every `*.json` in `server/pathways/`. The engine, write path, `tick`, case view, ingest and seed route by the case's `pathway_id`. An unknown id is a clear error.
- Seed: MM-2001 (recalled, due 24 Nov 09:00, escalates on demo day 7), MM-2002 (biopsy done on day 0, due 24 Nov 10:00, escalates on day 7); both fall after the scripted FIT demo's last clock jump (day 6), after the merge with TICKET-17 (the recall deadline was raised from 72 to 168 hours, still unsourced), MM-2003 (closed with imaging evidence). New fictional actors `act_007` (navigator) and `act_008` (physician), and provider `prov_breast_c`.
- FIT-only parts skip other pathways: the outreach ladder never runs on them, report verification answers `pathway_not_verified`, and the programme view counts FIT only.
- Not done: no frontend change. The worklist and case screens render the new rows from the payload, but nothing shows which pathway a row is on (`pathway_id` is in the payload). The UI's role picker has no navigator, so MM-2001 is advanced through the API or seen from the program manager's register. Not deployed to Vercel: `vercel.json` `includeFiles` for the templates is untested there.

## Notes

Mammography was chosen because DoH has a breast cancer screening and diagnosis standard (version 2, effective August 2025). We have not read the time limits in that standard, and no published local follow-up numbers exist for this pathway.

This is the first ticket to cut if time runs out. If it is cut, the claim "other pathways only need a template" may still be presented as a design, but not as something that has been demonstrated.
