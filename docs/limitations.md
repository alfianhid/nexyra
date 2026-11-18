# Limitations

What this prototype does not do, does not prove, or has not had checked. Written to be read by judges.

## What is not proven

- **Patient impact is not proven.** Nexyra has not been used with real patients. No claim is made that it improves follow-up, diagnosis, or any outcome. That is for a pilot to establish.
- **Navigation targeted by risk prediction is not claimed to work.** The cited studies do not show it (see [`evidence.md`](evidence.md)). Nexyra builds no risk model.
- **Closure verification accuracy is not clinical accuracy.** `[EVAL RESULTS PENDING — TICKET-14]` When results exist, they measure the mechanism on synthetic reports only.

## Data

- All data is synthetic. No real patient, no personal data.
- Drop-off rates, where used, are inputs. They are not findings.
- Test reports are written by the team with AI help, and the same kind of tool reads them. Their number is small. Results on them say little about real hospital reports.
- The synthetic cohort of about 1,000 cases in the brief is not in the code today. The three scripted demo cases are.

## Clinical review

- No clinician is on the team.
- `[CLINICAL REVIEW PENDING — TICKET-19]` The pathway, deadlines and closure rules have not been reviewed by a clinician at the time of writing. When review happens, it will be one hospital colleague outside Abu Dhabi, who is not a team member. State which parts he did and did not review.
- Six of the seven stage deadlines have no published source (see [`assumptions.md`](assumptions.md)). Only referral to colonoscopy within 31 days has one.

## What the code does and does not contain today

Exists: a case engine with seven stages, role-guarded actions, an append-only event trail, a closure rule that needs a valid outcome, evidence and a responsible physician, a demo clock with escalation by role, three scripted demo cases, a React worklist, case detail, closure and outreach-logging screens, and tests for the engine, writes, clock and database.

Not in the code:

- No live model call. The extraction shown for the demo case is a stored row.
- No labelled test set and no evaluation run.
- No patient messaging. Outreach attempts are entered by staff by hand. There are no Arabic templates.
- The programme view reads the live case records through `GET /api/program/summary`, but its numbers are only as good as the synthetic data behind them. Its scenario panel applies one trial's effect size (Atlas et al., JAMA 2023) to the synthetic case count. That is an assumption, not a measurement.
- No HL7 ingest, no Malaffi or e-Referral connection, no consultation monitoring, no second pathway.
- No identity matching across providers.
- No login. The role is picked from a menu, so the audit trail is only as honest as that menu.
- The deployed version has not been run on Vercel at the time of writing.

## Product boundaries

- Nexyra is not a referral tracker. Referral status tracking belongs to Malaffi e-Referral.
- Nexyra is not a messaging channel. It does not replace e-Referral communication.
- Nexyra does not diagnose, give surveillance intervals, or advise on treatment.

## Other

- Malaffi message formats beyond the circular's description of HL7 REF messages have not been seen first-hand.
- The demo works because the clock is controlled from the screen. Real timing behaviour at scale has not been tested.
- Security, privacy impact assessment, and data protection review have not been done.
