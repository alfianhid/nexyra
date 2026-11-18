# Limitations

What this prototype does not do, does not prove, or has not had checked. Written to be read by judges.

## What is not proven

- **Patient impact is not proven.** Nexyra has not been used with real patients. No claim is made that it improves follow-up, diagnosis, or any outcome. That is for a pilot to establish.
- **Navigation targeted by risk prediction is not claimed to work.** The cited studies do not show it (see [`evidence.md`](evidence.md)). Nexyra builds no risk model.
- **Closure verification accuracy is not clinical accuracy.** The evaluation harness exists (`npm run eval`, 24 labelled synthetic reports) but has not been run, because no model key was available. `[EVAL RESULTS PENDING — TICKET-14]` When results exist, they measure the mechanism on synthetic reports only.

## Data

- All data is synthetic. No real patient, no personal data.
- The cohort of 1,000 synthetic cases is generated from `data/generator-assumptions.json`. Its drop-off rates are inputs, not findings. Any funnel or limit-breach count on the programme view reflects those inputs, not the real programme.
- The 24 test reports are written by the team with AI help, and the same kind of tool reads them. Their number is small and they are English only. Results on them say little about real hospital reports.
- The labels in `data/test-reports/labels.json` have not been checked by a clinician or any second person (`checked_by` is null). They were frozen on 18 Nov before any extraction ran.

## Clinical review

- No clinician is on the team.
- `[CLINICAL REVIEW PENDING — TICKET-19]` The pathway, deadlines, closure rules and message wording have not been reviewed by a clinician at the time of writing. Review will be one hospital colleague outside Abu Dhabi, who is not a team member. State which parts he did and did not review.
- Only the 31-day referral to colonoscopy limit has a published source. Every other deadline, in both pathways and in the outreach ladder, is a team assumption (see [`assumptions.md`](assumptions.md)).
- **The mammography pathway is a configuration demonstration only.** It shows that a second pathway is a JSON file, not a code change. It has not been clinically reviewed, none of its deadlines has a source, we have not read the DoH breast cancer screening and diagnosis standard (version 2, effective August 2025), and it has no report verification, no report test set and no patient message templates.

## What the code does and does not contain

Exists: a case engine with ten stages plus closed on the FIT pathway, role-guarded actions, an append-only event trail, a closure rule that needs a valid outcome, evidence and a responsible physician, a demo clock with escalation by role, unowned triggers with FHIR stitching and an unstitched queue, consultation monitoring, an outreach ladder with a patient page, HL7 v2 REF and ORU ingest, report extraction with code-checked quotes and rule-based proposals, an evaluation harness, a programme view, a reset that rebuilds the demo state, and 317 automated tests in 26 files.

Not in the code, or not proven:

- **No evaluation numbers.** The model has not been run over the test set.
- **The live extraction path has not been exercised against a real model in this build.** It is tested with a fake model that returns scripted answers. The two readings for demo case 3 are stored demo readings, not model output: the first carries a model label (`deepseek/...`) but was not produced by a verified live model call, and the second (repeat colonoscopy plus pathology) was written by hand and is labelled `model: "hand-written demo reading (no model call)"`. A provider's output format may need prompt changes.
- **No real patient messaging.** The automated message is recorded as sent but not delivered: there is no SMS or WhatsApp gateway, and the patient page is reached through a simulated link with no login.
- **No Malaffi or e-Referral connection.** HL7 v2 messages are read from files or posted to an endpoint. The structure is generic HL7 v2.5; the Malaffi message specification has not been seen. MLLP transport, ADT and SIU messages are out of scope. Consultation questions and answers are recorded through two endpoints that stand in for the e-Referral feed.
- **Identity matching is exact only.** A resource is stitched when the patient identifier and the originating referral both match. Probabilistic matching is designed in `docs/architecture.md`, not built, and would always need a coordinator's confirmation.
- **No login.** The role is picked from a menu (three seats), so the audit trail is only as honest as that menu. Dr. Fulana (receiving physician) and Nur H. (navigator) have no seat; they act through their own forms on the case page. The server refuses (403) a consultation answer from anyone but the addressed physician, but who is acting is still self-declared.
- **The programme view is only as good as the synthetic data behind it.** Its scenario panel applies one trial's effect size (Atlas et al., JAMA 2023) to the synthetic case count. That is an assumption, not a measurement.
- **Performance at scale is not tested.** Request times were measured against a local file and with an added delay per round trip, not under load. The daily reset takes about 6 s and a request that arrives during it may see a partly loaded database.
- **The hosted prototype runs on Vercel with Turso** (https://nexyra-health.vercel.app, API and database in Mumbai). The hosted reset was checked by hand (1,006 cases, 6 to 9 s). The scheduled daily run has not been checked in the logs yet. A database call is retried once when Turso has closed an idle connection; SQL errors are not retried. No load test.

## Patient-facing language

- **The Arabic template text is not reviewed by a native speaker.** It was written by the team in `server/outreach/templates/fit-positive-result.ar.json` and is marked `written_not_reviewed` there. It must not be called reviewed until a native speaker has checked it.
- Urdu, Hindi and Tagalog exist only as slots marked "draft, not reviewed by a native speaker". They carry no text: a patient whose language is one of them receives the English message, and the patient page says why.
- The English and Arabic wording about the result and the colonoscopy has not been reviewed by a clinician. `[CLINICAL REVIEW PENDING — TICKET-19]`
- The ladder's step deadlines are unsourced (see [`assumptions.md`](assumptions.md)).

## Product boundaries

- Nexyra is not a referral tracker. Referral status tracking belongs to Malaffi e-Referral.
- Nexyra is not a messaging channel. It does not replace e-Referral communication; consultation monitoring records who owes an answer and by when.
- Nexyra does not diagnose, give surveillance intervals, or advise on treatment. The AI never closes a case.

## Other

- Security review, privacy impact assessment and data protection review have not been done.
- While the team uses a model provider's free credits, content may be used for product improvement. For that reason only synthetic data is ever sent to a model. A pilot needs a policy for AI on clinical data first.
