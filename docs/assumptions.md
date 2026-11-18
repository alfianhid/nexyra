# Assumptions

Every assumption behind the prototype, with a source or an explicit label. Labels used:

- **Sourced**: a published source backs it.
- **Assumption**: chosen by the team, no source. Needs clinical review.
- **Demo setting**: chosen so the demo is readable. Not a claim about reality.

Nothing here is a finding of the product. The authoritative values are in `server/pathways/*.json`; `npm run pathway:deadlines` prints them.

## FIT pathway and deadlines

`server/pathways/fit-colonoscopy.json`. Deadlines are hours allowed from entering the stage.

| Stage | Owner role | Allowed time | Label |
|---|---|---|---|
| Result received | Coordination staff | 168 h (7 days) | Assumption |
| Patient notified | Coordination staff | 72 h | Assumption |
| Referral sent | Coordination staff | 72 h (also the acceptance deadline) | Assumption |
| Referral accepted | Coordination staff | 72 h | Assumption |
| Colonoscopy booked | Coordination staff | 576 h (24 days) | Assumption |
| Procedure completed | Responsible physician | 48 h | Assumption |
| Pathology ordered | Responsible physician | 336 h (14 days) | Assumption |
| Pathology received | Responsible physician | 168 h (7 days) | Assumption |
| Closure proposed | Responsible physician | 48 h | Assumption |
| Closure confirmed | Responsible physician | 24 h | Assumption |

- Referral to colonoscopy within 31 days: **Sourced**. HAAD standard, cited in BMC Cancer 2021. The programme view shows it as the 31-day limit, measured from first entering Referral sent.
- Whether the other deadlines are clinically sensible: `[CLINICAL REVIEW PENDING — TICKET-19]`.
- The three closure outcomes (`returned_to_routine_screening`, `surveillance_scheduled`, `oncology_accepted_therapy_started`) and the evidence each needs: **Assumption**.

## Mammography pathway

`server/pathways/mammography-biopsy.json`. A configuration demonstration. Every deadline is a placeholder marked "unsourced, needs clinical review": abnormal mammogram 120 h, recalled 168 h, referred for assessment 72 h, accepted 72 h, imaging booked 240 h, imaging done 72 h, biopsy done 168 h, pathology received 120 h, closure proposed 48 h, closure confirmed 24 h. We have not read the DoH breast cancer screening and diagnosis standard (version 2, August 2025). **Assumption**.

## Escalation and ownership

- Order: coordination staff, then responsible physician, then program manager. **Assumption**, based on the brief's role model.
- A level fires once per case per stage, and levels are spaced at least 24 demo-clock hours apart. **Demo setting**.
- A case becomes unowned on three triggers only: the receiving provider rejects the referral, the referral is unanswered past its deadline, or the patient moves provider. An assign-owner task goes to coordination staff within 24 h. **Assumption**.
- Consultation: the receiving physician has 48 h to answer, 72 h after a request for more data. **Assumption**.
- Stitching accepts a FHIR resource only when the patient identifier and the originating referral both match exactly. Everything else is queued. **Assumption**, chosen so a wrong merge needs a person.

## Patient outreach ladder

Parameters in `server/outreach/templates/fit-positive.ladder.json`, each marked "unsourced, needs clinical review".

| Step | Value | Label |
|---|---|---|
| Automated message | when the case is at Result received | Assumption |
| No answer to the message, then a staff call task | 48 h after the message | Assumption |
| Staff call task deadline | 24 h | Assumption |
| Deadline of a call the patient asked for | 24 h | Assumption |
| Still no movement, then the navigator | 48 h after the first call step | Assumption |
| Navigator task deadline | 48 h | Assumption |
| A delay reason recorded by coordination staff sends the case to the navigator at once | rule | Assumption |

- Atlas et al. (JAMA 2023) sent letters in week 2 and phone calls in week 4. That is too slow for the 31-day referral-to-colonoscopy limit, so these values are deliberately shorter (message on day 0, staff call on day 2, navigator on day 4). They are not taken from Atlas and are not findings. `[CLINICAL REVIEW PENDING — TICKET-19]`
- Delay reasons are a closed list: fear, transport, cost, language, other. **Assumption**.
- The clinic name and phone number in the message are fictional. **Demo setting**.
- English wording written by the team. Arabic wording written by the team and not reviewed by a native speaker. Urdu, Hindi and Tagalog have no text. `[NATIVE-SPEAKER REVIEW PENDING]`

## Report extraction and closure proposals

- The six extracted fields and the rules that turn them into a proposal (`reopen`, `wait_for_pathology`, `needs_human_reading`, `propose_closure`) are in `server/verify/`. The rules are the team's reading of what a closure needs. **Assumption**, to be checked in clinical review.
- A cancer finding never produces a closure proposal, because the outcome "oncology accepted, therapy started" needs evidence a report cannot contain. **Assumption**.
- Cancer reports are labelled "may not propose closure" in the test set, and r07, r15, r16, r18, r20 and r23 are the reports we want a clinician to look at (`data/test-reports/README.md`).
- Labels were written by the team before any extraction ran and have not been checked by a second person.

## Synthetic cohort

`data/generator-assumptions.json`, seed 20261117. 1,000 cases over the 365 days before demo day 0, ages 45 to 75, with a drop-off probability and a time distribution per stage. Nearly every value is labelled "team guess". The only literature anchor is the 30.5% Abu Dhabi colonoscopy follow-up (2015 to 2016), used to calibrate the product of the stage drop-offs. Language mix and pathology mix have no source. **Drop-off rates are inputs, not findings.** `[CLINICAL REVIEW PENDING — TICKET-19]` for age band and pathology mix.

## Demo data

- Three FIT cases (CX-1001 to CX-1003) and three mammography cases (MM-2001 to MM-2003), fictional people. **Demo setting**.
- Demo start time: 17 Nov 2026 11:42 UTC+7. The clock moves only when a user advances it. **Demo setting**.
- The stored readings for CX-1003 (the first report, and the repeat colonoscopy read with its pathology) are demo readings stored for offline use, not output of a verified live model call; the reports were written by the team. **Demo setting**.
- The hosted demo is reset every day at 21:00 UTC. **Demo setting**.
- Navigator, receiving-provider and coordinator-at-clinic-B actors are invented for the demo.

## Effect sizes

The scenario panel may only use effect sizes from [`evidence.md`](evidence.md). It uses Atlas only: usual care (22.9%) against the reminder, letter and phone outreach arm (31.0%), applied to the number of synthetic cases. It is titled "Scenario based on assumptions" and cites its source. Applying a US trial's effect to Abu Dhabi is an **Assumption**.

## Other

- Role names `coordinator`, `physician` and `program_manager` are picked from a menu in the demo. There is no login. **Demo setting**.
- All timestamps in the demo carry a +07:00 offset. **Demo setting**.
