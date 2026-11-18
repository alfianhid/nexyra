# Evidence

What the literature says about the screening-to-care gap, with the numbers and caveats as they are in the sources. Nexyra is not proven to improve patient outcomes, and nothing here says it is. This evidence explains why the design leans on ownership, deadlines and outreach, not on risk prediction.

## Follow-up after an abnormal screening result

### Atlas et al., JAMA 2023

Follow-up completion in the four trial arms:

| Arm | Follow-up completed |
|---|---|
| Usual care | 22.9% |
| EHR reminder | 22.7% |
| Reminder, letter and phone outreach | 31.0% |
| Outreach plus a patient navigator | 31.4% |

Reading: the outreach arm moved the number. Adding a navigator on top moved it by 0.4 points. Outreach drove the effect, not navigation. An EHR reminder alone did nothing measurable (22.7% against 22.9%).

How Nexyra uses it: outreach is built as a ladder that starts early and escalates to people. The reminder is only the first rung. Timing in that trial (letters in week 2, phone calls in week 4) is from the team's reading of the study and is not a figure we rely on in any calculation.

Caveat: one trial, one health system, one set of screening tests. It does not say what would happen in Abu Dhabi.

### Kaiser Permanente Northwest, 2021

Navigation arm 76% completion against 65% in usual care.

The prediction model used in that study had weak discrimination (C-statistic 0.65). The study reported no evidence that the effect of navigation differed by risk group.

How Nexyra uses it: this is one of the two reasons no risk model is built. Navigation helped, and the prediction used to target it was weak.

### PRECISE, 2025

55.1% completion with navigation against 42.1% without.

Risk prediction did not change the size of the navigation effect. These figures are from published summaries. The team has not read the full text.

How Nexyra uses it: the second reason no risk model is built.

What these three sources do not show: that targeting navigation by predicted risk works. The team does not claim it, and Nexyra does not do it.

## Abu Dhabi

- Colonoscopy follow-up after a positive FIT was 30.5% in the 2015 to 2016 data. This is old data from one analysis. The current rate is not known to the team. `[FULL CITATION FOR THE 30.5% FIGURE TO BE ADDED BY A TEAM MEMBER BEFORE SUBMISSION. The figure is verified; the paper reference is not in the repository.]`
- Referral to colonoscopy within 31 days is the HAAD standard, cited in BMC Cancer 2021. It is the only pathway deadline in Nexyra that has a published basis.

## Policy context

DoH Circular 144/2026 (number and gist only): all referral transactions go to Malaffi as HL7 REF messages by 31 August 2026, and Malaffi e-Referral is for referral management, status tracking and communication between referrer and receiver. Nexyra is positioned above that layer, at the level of the screening result and who owns the case. Consultation monitoring records who owes an answer and by when; the message itself belongs to e-Referral. The circular is not reproduced or attached here.

## Nexyra's own evaluation

`[EVAL RESULTS PENDING — TICKET-14]`

The harness is ready (`npm run eval`, 24 labelled synthetic reports) and has not been run, because no model key was available. When it runs, it reports closure verification as fractions with denominators, with every error listed, wrong closures first. It measures the mechanism on synthetic reports. It does not measure clinical accuracy or patient outcomes.

What does exist is prior testing of the mechanism: 317 automated tests in 26 files, including one that replays all three demo cases through the API after a reset, and tests that every proposal rule and every quote check behaves as documented. These show the code does what it says, not that it is clinically right.

## Clinical review

`[CLINICAL REVIEW PENDING — TICKET-19]`

No clinician is on the team. Nothing in this folder has been clinically reviewed yet.

## Not claimed

- That Nexyra improves follow-up completion or any patient outcome.
- That navigation targeted by risk prediction improves outcomes.
- That the synthetic cohort behaves like real patients. Its drop-off rates are inputs, not findings.
- That the scenario panel on the programme view predicts anything. It applies one US trial's effect size to a synthetic case count and is labelled an assumption.
