# Form answers (draft)

Draft of the Hack2skill submission form, rewritten 18 Nov 2026 to match the latest build (317 tests, prototype deployed). Not submitted. Fields and limits are from [`submission.md`](submission.md). A team member submits from their own account (TICKET-27). After submitting, replace this draft with the text exactly as sent.

Character counts below were measured with `node` (`[...text].length`, newlines counted as one character). If the form counts a line break as two characters, add one per line break: the summary then reaches 1995 and the build text 1059. Both stay under their limits. Re-measure after any edit.

## Solution summary (limit 2,000 characters)

```text
After a positive screening result, a patient crosses laboratories, clinics and hospitals, and ownership is lost at the handoffs. In Abu Dhabi, only 30.5% with a positive FIT had the follow-up colonoscopy (2015 to 2016). Malaffi e-Referral tracks referral documents (DoH Circular 144/2026), not who owns the screening result or what happens if nobody acts.

Nexyra is a case engine that sits above that data. A positive result creates a case. Every stage has one owner and a deadline; a missed deadline escalates the case by role. Cases that lose their owner (referral rejected, unanswered, patient moved) go to an unowned queue; incoming FHIR and HL7 v2 messages are stitched to a case or queued. An outreach ladder (message, staff call, navigator) works on the patient. Consultation monitoring sits on top of e-Referral; it is not a messaging channel. A case closes only with a valid outcome, evidence and a responsible physician's confirmation. AI reads the colonoscopy or pathology report, quotes the sentence behind every answer, and code checks each quote is in the report. Rules, not the model, make the proposal. AI never closes a case. A physician can reopen a case or reject a proposal. A programme view shows exceptions, the funnel, the 31-day limit and physician-AI divergence. FIT is built; mammography is a demo only.

Why: in Atlas et al. (JAMA 2023) follow-up was 22.9% with usual care, 22.7% with an EHR reminder, 31.0% with outreach and 31.4% with a navigator added, so outreach drove the effect. Kaiser Northwest (2021) found no evidence navigation differed by risk group; PRECISE (2025), that risk prediction did not change it. Nexyra builds no risk model.

Not proven: a prototype on synthetic data only, no claimed effect on outcomes. The model evaluation has not been run, demo readings are stored, and no clinician is on the team, so nothing is clinically reviewed.

Stack: React, Express, Turso, any OpenAI-compatible model. Live: https://nexyra-health.vercel.app
```

Character count: **1987** of 2,000.

## What has been built during the challenge? (limit 1,500 characters)

```text
Built during the challenge, all on synthetic data:
- Case engine with one rule file for who may move a case and when; closure needs outcome, evidence and a physician. The system role cannot close a case.
- Append-only audit trail, demo clock, escalation by role.
- Two pathways as configuration: FIT (demoed) and mammography (demonstration only).
- Unowned queue, FHIR stitching with an unstitched queue, consultation monitoring.
- HL7 v2 REF and ORU ingest (generic v2.5, Malaffi spec not seen).
- Outreach ladder with a patient page in English and Arabic (Arabic unreviewed).
- Report extraction: quotes checked in code, rule-based proposals; physician reopens or rejects with a reason, divergence counted; evaluation harness over 24 labelled reports.
- Programme view over a 1,000-case synthetic cohort, with a daily demo reset.
- React screens, REST API, libSQL storage, 317 tests. Live: https://nexyra-health.vercel.app

Not done: evaluation run (no model key; demo readings stored), clinical review, real messaging, Malaffi connection, login.
```

Character count: **1048** of 1,500.

**Re-check both texts after the final build.** They describe the code as of 18 Nov 2026. Before submitting:

- Run `npm test` and update "317 tests" if it changed.
- If the evaluation has run, move it out of "Not done" and add the numbers only as fractions with denominators (results go in `docs/evaluation-results.md`). Until then no accuracy figure is claimed.
- Show clinical review as done only if it is done. No clinician is on the team and no reviewer is confirmed.
- Check the deployed app is up (https://nexyra-health.vercel.app) and the video link opens: `[PENDING — TICKET-21]` (video only).

## Dropdowns and checkboxes

| Field | Choice | Note |
|---|---|---|
| Challenges | Challenge 05, Closing the Screening-to-Care Loop | |
| Solution stage | The option that most honestly describes a prototype | Options not yet recorded in `submission.md`. Pick the earliest "prototype" or "proof of concept" style option, not a pilot or deployed one. |
| Technology type | Software application, and AI agent | Software application is justified: a working case engine and screens. AI agent is justified: a live extraction path exists (`POST /api/cases/{id}/verification`, `npm run verify:file`) that calls a model, validates its quotes and proposes. **Tick AI agent only if the final build calls the model or serves its cached readings**: that is, only if the deployed demo shows an extraction (the stored demo readings for CX-1003 count as cached readings, not as model output) or `LLM_API_KEY` is set there. Machine learning: do not tick, we train no model. Do not check Analytics, Wearable, Sensor, Connected device or Other hardware. |
| Software-based, hardware-based, or both? | Software | |
| Prototype / Deployment Link | `https://nexyra-health.vercel.app` | Required. Public, no login. Open it in an incognito window right before submitting. |
| Link to a short demo video | From TICKET-21: `[PENDING — TICKET-21]` | Under 3 minutes, viewable by anyone with the link |
| Upload your solution deck | PDF from TICKET-26, text in [`deck-content.md`](deck-content.md) | Under 5 MB |

## Conflict of interest

Both members answered no to all five questions. Tick "None of the above" on the form. The deck's conflict of interest slide says the same.

The form options:

1. Employed or contracted by the Department of Health – Abu Dhabi
2. Employed or contracted by Future Health or one of the challenge collaborators (Microsoft, Inception42, MBZUAI, or Hack2skill)
3. Has a family member or close personal relationship with a judge, organizer, or collaborator staff
4. Has a financial interest in the organization running or judging the challenge
5. Has had access to non-public information about the challenge or its judging
6. None of the above

Members asked: the two team members, as listed on slide 2 of the deck (team size 2). No clinician is on the team.

| Member | 1 | 2 | 3 | 4 | 5 | None | Asked on (date) |
|---|---|---|---|---|---|---|---|
| Alfian Hidayatullah | No | No | No | No | No | Yes | 18 Nov 2026 |
| Fajar Aji Pamungkas | No | No | No | No | No | Yes | 18 Nov 2026 |

Answer to tick on the form: 6, None of the above.
