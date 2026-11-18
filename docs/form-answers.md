# Form answers (draft)

Draft of the Hack2skill submission form, 18 Nov 2026. Not submitted. Fields and limits are from [`submission.md`](submission.md). A team member submits from their own account (TICKET-27). After submitting, replace this draft with the text exactly as sent.

Character counts below were measured with `node` (`[...text].length`, newlines counted as one character). If the form counts a line break as two characters, add one per line break: the summary then reaches 1984 and the build text 1069. Both stay under their limits. Re-measure after any edit.

## Solution summary (limit 2,000 characters)

```text
After a positive screening result, a patient crosses laboratories, clinics and hospitals. Ownership is often lost at these handoffs. In Abu Dhabi, colonoscopy follow-up after a positive FIT was 30.5% in 2015 to 2016 data. Malaffi e-Referral tracks referral documents. It does not say who is responsible for the screening result right now, or what happens if nobody acts.

Nexyra is a case engine that sits above Malaffi e-Referral data (DoH Circular 144/2026). A positive FIT creates a case. Each stage has one owner and a deadline. When a deadline passes, the case escalates by role: coordination staff, responsible physician, program manager. A case with no owner is shown as unowned. Every change is an event in an append-only audit trail. A case closes only when a valid outcome and evidence are recorded and a responsible physician confirms. AI may extract facts from a report and propose a next step. It cannot close a case; the system role is blocked in code and in tests.

What sets it apart: it is not a referral tracker and not a messaging channel, so it does not compete with e-Referral. It builds no drop-off risk model. The evidence we found does not show that targeting by risk helps. In Atlas et al. (JAMA 2023), outreach raised follow-up completion from 22.9% to 31.0%, and adding a navigator gave 31.4%. In Kaiser Northwest (2021) and PRECISE (2025), the navigation effect showed no dependence on risk. Nexyra uses rules, timers, escalation and outreach logging instead.

What is and is not proven: this is a prototype on synthetic data only. No real patient data is used. We do not claim any effect on patient outcomes. No clinician is on the team, and clinical review is pending. Closure verification will be reported on a small labelled synthetic set, as fractions. It measures the mechanism, not clinical accuracy.

Stack: React, Express, libSQL (Turso when deployed), and any OpenAI-compatible model endpoint. Only synthetic data is ever sent to a model.
```

Character count: **1976** of 2,000.

## What has been built during the challenge? (limit 1,500 characters)

```text
Built from scratch during the challenge, all on synthetic data:
- A case engine with seven stages from result received to closed, and one rule file for who may move a case and when.
- Closure rule: a valid outcome, attached evidence and a responsible physician's confirmation. The system role cannot close a case. Tests cover each condition.
- Append-only event trail for every change, with the acting role.
- A demo clock and role escalation: coordination staff, then physician, then program manager. Each level fires once per stage.
- An unowned state that shows in the worklist.
- Three scripted demo cases with a one-command reset.
- Screens for worklist, case detail with timeline, closure confirmation, and outreach logging, with a role picker.
- REST API, libSQL storage (local file or Turso), and a stored extraction result with quoted citations for one demo case.
- Server tests with Vitest.

Not built yet: live model extraction, evaluation run, patient messaging, Malaffi or HL7 integration, a second pathway. The programme view uses fixture data.
```

Character count: **1058** of 1,500.

**Re-check this list after the final build.** It describes the code as of 18 Nov 2026 and lists only things that exist in the repository today: the engine in `server/engine.ts`, the event trail in `server/events.ts`, the clock and escalation in `server/clock.ts` and `server/escalation.ts`, the seed in `server/seed.ts`, the screens in `src/pages/`, and the tests in `server/*.test.ts`. Before submitting:

- Move "live model extraction", "evaluation run" and anything else from "not built yet" into the built list only if it then exists and TICKET-23 confirms it.
- Check the programme view still uses fixture data, and say so if it does.
- Run `npm test` and `npm run build` and update any counts or claims that changed.
- Add the evaluation numbers only after TICKET-14 produces them: `[EVAL RESULTS PENDING — TICKET-14]`.
- State clinical review only as done if it is done: `[CLINICAL REVIEW PENDING — TICKET-19]`.

## Dropdowns and checkboxes

| Field | Choice | Note |
|---|---|---|
| Challenges | Challenge 05, Closing the Screening-to-Care Loop | |
| Solution stage | The option that most honestly describes a brand-new prototype | Options not yet recorded in `submission.md`. Pick the earliest "prototype" or "proof of concept" style option, not a pilot or deployed one. |
| Technology type | Software application; AI agent or Machine learning | Check AI agent or Machine learning only if live model extraction exists in the final build. Today it does not, so without it, check Software application only. Do not check Analytics, Wearable, Sensor, Connected device or Other hardware. |
| Software-based, hardware-based, or both? | Software | |
| Prototype / Deployment Link | Deployed URL from TICKET-21 | Required. Open it in an incognito window right before submitting. |
| Link to a short demo video | From TICKET-21 | Under 3 minutes, viewable by anyone with the link |
| Upload your solution deck | PDF from TICKET-26 | Under 5 MB |

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
