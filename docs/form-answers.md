# Form answers (draft)

Draft of the Hack2skill submission form, rewritten 18 Nov 2026 to match the build. Not submitted. Fields and limits are from [`submission.md`](submission.md). A team member submits from their own account (TICKET-27). After submitting, replace this draft with the text exactly as sent.

Character counts below were measured with `node` (`[...text].length`, newlines counted as one character). If the form counts a line break as two characters, add one per line break: the summary then reaches 1977 and the build text 934. Both stay under their limits. Re-measure after any edit.

## Solution summary (limit 2,000 characters)

```text
After a positive screening result, a patient crosses laboratories, clinics and hospitals, and ownership is lost at the handoffs. In Abu Dhabi, colonoscopy follow-up after a positive FIT was 30.5% in 2015 to 2016 data. Malaffi e-Referral tracks referral documents (DoH Circular 144/2026). It does not say who owns the screening result, or what happens if nobody acts.

Nexyra is a case engine that sits above that data. A positive result creates a case. Every stage has one owner and a deadline, and when a deadline passes the case escalates by role. Cases that lose their owner (referral rejected, unanswered, patient moved) go to an unowned queue; incoming FHIR and HL7 v2 messages are stitched to a case or queued, never dropped. An outreach ladder (message in English or Arabic, staff call, navigator) works on the patient. Consultation monitoring sits on top of e-Referral; it is not a messaging channel. A case closes only with a valid outcome, evidence and a responsible physician's confirmation. AI reads the colonoscopy or pathology report, quotes the sentence behind every answer, and code checks each quote is in the report. Rules, not the model, turn the answers into a proposal. AI never closes a case. A programme view shows exceptions, the funnel and the 31-day referral limit. FIT is built; mammography is a configuration demonstration only.

Why: in Atlas et al. (JAMA 2023) follow-up was 22.9% with usual care, 22.7% with an EHR reminder, 31.0% with outreach and 31.4% with a navigator added, so outreach drove the effect. Kaiser Northwest (2021) found no evidence the navigation effect differed by risk group; PRECISE (2025), that risk prediction did not change it. Nexyra builds no risk model.

Not proven: this is a prototype on synthetic data only. We claim no effect on patient outcomes. The model evaluation has not been run, no clinician is on the team, and clinical review is pending.

Stack: React, Express, Turso, any OpenAI-compatible model.
```

Character count: **1969** of 2,000.

## What has been built during the challenge? (limit 1,500 characters)

```text
Built during the challenge, all on synthetic data:
- Case engine with one rule file for who may move a case and when; closure needs outcome, evidence and a physician. The system role cannot close a case.
- Append-only audit trail, demo clock, escalation by role.
- Two pathways as configuration: FIT (demoed) and mammography (demonstration only).
- Unowned queue, FHIR stitching with an unstitched queue, consultation monitoring.
- HL7 v2 REF and ORU ingest (generic v2.5, Malaffi spec not seen).
- Outreach ladder with a patient page in English and Arabic (Arabic unreviewed).
- Report extraction: quotes checked in code, rule-based proposals; evaluation harness over 24 labelled reports.
- Programme view over a 1,000-case synthetic cohort, with a daily demo reset.
- React screens, REST API, libSQL storage, 300 tests.

Not done: evaluation run (no model key), clinical review, real messaging, Malaffi connection, login.
```

Character count: **923** of 1,500.

**Re-check both texts after the final build.** They describe the code as of 18 Nov 2026. Before submitting:

- Run `npm test` and update "300 tests" if it changed.
- If the evaluation has run, move it out of "Not done" and add the numbers only as fractions with denominators: `[EVAL RESULTS PENDING — TICKET-14]`.
- Clinical review only as done if it is done: `[CLINICAL REVIEW PENDING — TICKET-19]`.
- Check the deployed app is up and the video link opens: `[PENDING — TICKET-21]`.

## Dropdowns and checkboxes

| Field | Choice | Note |
|---|---|---|
| Challenges | Challenge 05, Closing the Screening-to-Care Loop | |
| Solution stage | The option that most honestly describes a prototype | Options not yet recorded in `submission.md`. Pick the earliest "prototype" or "proof of concept" style option, not a pilot or deployed one. |
| Technology type | Software application, and AI agent | Software application is justified: a working case engine and screens. AI agent is justified: a live extraction path exists (`POST /api/cases/{id}/verification`, `npm run verify:file`) that calls a model, validates its quotes and proposes. **Tick AI agent only if the final build calls the model or serves its cached readings**: that is, only if the deployed demo shows an extraction (the stored reading for CX-1003 counts as a cached reading) or `LLM_API_KEY` is set there. Machine learning: do not tick, we train no model. Do not check Analytics, Wearable, Sensor, Connected device or Other hardware. |
| Software-based, hardware-based, or both? | Software | |
| Prototype / Deployment Link | Deployed URL from TICKET-21: `[PENDING — TICKET-21]` | Required. Open it in an incognito window right before submitting. |
| Link to a short demo video | From TICKET-21: `[PENDING — TICKET-21]` | Under 3 minutes, viewable by anyone with the link |
| Upload your solution deck | PDF from TICKET-26, text in [`deck-content.md`](deck-content.md) | Under 5 MB |

## Conflict of interest (not filled)

Do not tick anything until every member has answered each question directly. Record the answers here, then tick the form to match. The deck's conflict of interest slide must say the same.

The form options:

1. Employed or contracted by the Department of Health – Abu Dhabi
2. Employed or contracted by Future Health or one of the challenge collaborators (Microsoft, Inception42, MBZUAI, or Hack2skill)
3. Has a family member or close personal relationship with a judge, organizer, or collaborator staff
4. Has a financial interest in the organization running or judging the challenge
5. Has had access to non-public information about the challenge or its judging
6. None of the above

Team members to ask. The member list is not in the repository, so fill in the names: every person listed on slide 2 of the deck (team size is on slide 1), with no exceptions. The clinical reviewer, Fulan, is not a team member and is not asked, but if he has any of these relationships with the organizers, tell the team.

| Member | 1 | 2 | 3 | 4 | 5 | None | Asked on (date) |
|---|---|---|---|---|---|---|---|
| `[NAME]` | | | | | | | |
| `[NAME]` | | | | | | | |
| `[NAME]` | | | | | | | |
| `[NAME]` | | | | | | | |
| `[NAME]` | | | | | | | |

Answers to tick on the form: `[NOT DECIDED]`
