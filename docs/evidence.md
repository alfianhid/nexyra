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

- Source: Almansoori A, Alzaabi M, Alketbi L. Colorectal Cancer screening in ambulatory healthcare service clinics in Abu Dhabi, United Arab Emirates in 2015–2016. BMC Cancer. 2021;21:897. doi:10.1186/s12885-021-08623-9. Verified from the article text on 18 Nov 2026.
- Colonoscopy follow-up after a positive FIT was 30.5% in the 2015 to 2016 data. Of the people screened with FIT or gFOBT, 13.5% were positive. Of those, 30.5% (436) had the follow-up colonoscopy and 933 did not. 12% were never told their positive result. This is old data from one analysis. The current rate is not known to the team.
- The same paper reports a different 30.5%: the share of polyps among those who had a colonoscopy. We do not use that one. We use the follow-up figure.
- The paper cites the HAAD Standard for Colorectal Cancer Screening (2014): colonoscopy within 31 days of referral after a positive FIT, for over 90% of people. That is the only pathway deadline in Nexyra that has a published basis.

## Policy context

DoH Circular 144/2026 (number and gist only): all referral transactions go to Malaffi as HL7 REF messages by 31 August 2026, and Malaffi e-Referral is for referral management, status tracking and communication between referrer and receiver. Nexyra is positioned above that layer, at the level of the screening result and who owns the case. Consultation monitoring records who owes an answer and by when; the message itself belongs to e-Referral. The circular is not reproduced or attached here.

## Nexyra's own evaluation

On 18 Nov 2026 the harness was run for real (`muse-spark-1.3` through the Meta Model API, prompt `extract-v1`, 24 labelled synthetic reports, each read fresh, none unavailable). Reports that must not be closed: 14 of 14 held back, 0 of 14 proposed for closure (no dangerous error). Reports that may be closed: 4 of 10 proposed for closure, 6 of 10 held back for human reading (false alarms). Field agreement: complete_exam 24 of 24, pathology_available 24 of 24, next_step 23 of 24, tissue_taken 20 of 24, outcome_category 16 of 24, adequate_prep 15 of 24. 1 citation was rejected by the quote check. The main cause of false alarms is bowel preparation written as a score (for example BBPS) without a word such as "adequate": the prompt treats a score alone as unknown, so these go to a human. Most outcome-category disagreements are reports labelled "not stated" where the model named an outcome. The prompt was not changed after seeing the results (0 prompt changes). Full table and every disagreement: `docs/evaluation-results.md`. This measures the mechanism on synthetic reports written by the team with AI help; 24 is a small set; the labels have not been checked by a clinician. It is not clinical accuracy.

What does exist is prior testing of the mechanism: 317 automated tests in 26 files, including one that replays all three demo cases through the API after a reset, and tests that every proposal rule and every quote check behaves as documented. These show the code does what it says, not that it is clinically right.

## Clinical review

No clinician is on the team. The pathway, deadlines, closure rules, test labels and patient wording have not been reviewed by a clinician. No reviewer is confirmed. This review comes before any pilot.

## Not claimed

- That Nexyra improves follow-up completion or any patient outcome.
- That navigation targeted by risk prediction improves outcomes.
- That the synthetic cohort behaves like real patients. Its drop-off rates are inputs, not findings.
- That the scenario panel on the programme view predicts anything. It applies one US trial's effect size to a synthetic case count and is labelled an assumption.
