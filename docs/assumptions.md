# Assumptions

Every assumption behind the prototype, with a source or an explicit label. Labels used:

- **Sourced**: a published source backs it.
- **Assumption**: chosen by the team, no source. Needs clinical review.
- **Demo setting**: chosen so the demo is readable. Not a claim about reality.

Nothing here is a finding of the product.

## Pathway and deadlines

The pathway in code (`server/engine.ts`) has seven stages. Deadlines are hours allowed from entering the stage.

| Stage | Allowed time | Label |
|---|---|---|
| Result received | 168 h (7 days) | Assumption |
| Colonoscopy booked | 336 h (14 days) | Assumption |
| Pathology ordered | 336 h (14 days) | Assumption |
| Pathology received | 168 h (7 days) | Assumption |
| Closure proposed | 48 h | Assumption |
| Closure confirmed | 24 h | Assumption |

- Referral to colonoscopy within 31 days: **Sourced**. HAAD standard, cited in BMC Cancer 2021. The demo clock shows this limit as `referral_limit_days = 31`.
- Whether the six stage deadlines above are clinically sensible: `[CLINICAL REVIEW PENDING — TICKET-19]`.
- The pathway in code is shorter than the one in the brief (ten stages from result to follow-up). The brief's longer version is design intent. Do not describe it as built.

## Escalation

- Order: coordination staff, then responsible physician, then program manager. **Assumption**, based on the brief's role model.
- A level fires once per case per stage, and levels are spaced at least 24 demo-clock hours apart. **Demo setting**.
- Level 1 goes to the responsible physician. Levels 2 and 3 go to the program manager. **Assumption**.

## Patient outreach ladder (TICKET-10)

Parameters in `server/outreach/templates/fit-positive.ladder.json`, each marked `"source": "unsourced, needs clinical review"`.

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
- The clinic name and phone number in the message (`Demo Screening Clinic, Abu Dhabi`, `+971 2 000 0000`) are fictional. **Demo setting**.
- CX-1001's message is seeded on 16 Nov 10:20 so the first `+1 day` crosses the 48-hour mark. **Demo setting**.

## Closure

- Three conditions must all hold: a valid outcome from a closed list, evidence attached (a colonoscopy or pathology document), and confirmation by the responsible physician. **Assumption**, to be checked in clinical review.
- The three outcomes are `returned_to_routine_screening`, `surveillance_scheduled` and `oncology_accepted_therapy_started`. **Assumption**.

## Demo data

- Three scripted cases, fictional people. **Demo setting**.
- Demo start time: 17 Nov 2026 11:42 UTC+7. **Demo setting**.
- The demo clock moves only when a user advances it. **Demo setting**.
- The stored report text and extraction result for the third demo case were written by the team. **Demo setting**.

## Not built, so no parameter exists yet

The brief plans a synthetic cohort of about 1,000 cases with drop-off rates. It is not in the code today. When it is built, every generator parameter needs a literature source or the label **Assumption**, and drop-off rates are inputs, never findings. `[GENERATOR PARAMETERS NOT YET WRITTEN]`

## Effect sizes

The scenario panel, if built, may only use effect sizes from [`evidence.md`](evidence.md): 22.9%, 22.7%, 31.0% and 31.4% (Atlas et al., JAMA 2023), 76% against 65% (Kaiser Permanente Northwest, 2021), and 55.1% against 42.1% (PRECISE, 2025, from summaries). The panel that exists uses only Atlas: usual care (22.9%) against the reminder, letter and phone outreach arm (31.0%), applied to the number of synthetic cases. It is titled "Scenario based on assumptions" and cites its source.

## Other assumptions

- Role names `coordinator`, `physician` and `program_manager` are picked from a menu in the demo. There is no login. **Demo setting**.
- All timestamps in the demo carry a +07:00 offset. **Demo setting**.
