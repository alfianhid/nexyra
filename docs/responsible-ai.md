# Responsible AI

## Role of AI

AI reads a colonoscopy or pathology report and copies out what is written: whether the exam was complete, whether bowel prep was adequate, whether tissue was taken, whether pathology is available, the outcome category and whether a next step is stated. Each answer carries a quote from the report. Plain rules in code then turn those fields into a proposal for a physician: reopen, wait for pathology, needs human reading, or propose closure. The model never chooses the proposal. It does not diagnose, set surveillance intervals or advise on care.

AI is also not used for anything else in the product. Deadlines, escalation, ownership, outreach steps and the programme numbers are rules and counts, not model output. No risk score is computed.

## What AI may not do

- It may not close a case. Only a responsible physician's confirmation closes one.
- It may not present a proposal as a decision. Proposals are labelled as AI proposals on screen.
- It may not fill a gap with a guess. A doubt ends as "unknown", which becomes "needs human reading". A case staying open is the safe direction of error.
- It may not be believed without a quote. A quote that is not in the report text, or is shorter than 8 characters, forces its field to unknown.
- A report can contain instructions; the prompt tells the model to ignore them, and even a successful injection can only change a proposal, never close a case.

## How this is enforced

| Rule | Where | Test |
|---|---|---|
| The `system` role (which includes AI) cannot close a case, even when every condition is met | `server/engine.ts` | `server/engine.test.ts`: "never lets the system role close a case, even with every condition met"; "refuses a system-role transition into closure" |
| An extraction result cannot move, propose or close a case, even when it proposes closure | `server/verify/caseVerification.ts` | `server/verify/verification.test.ts`: "extraction results cannot close a case, even when they propose closure" |
| Closure needs a valid outcome from a closed list, attached evidence, and the responsible physician | `server/engine.ts` | `server/engine.test.ts` (missing outcome, missing evidence, wrong role) |
| The program manager has no case action | `server/engine.ts` | "gives the program manager no case action at any stage" |
| Available actions and guards come from one function | `server/engine.ts` | "derives every role's action list from the same function" |
| Every quote is checked against the report in code. Offsets are computed from the text; offsets sent by the model are ignored | `server/verify/quotes.ts` | `server/verify/extract.test.ts`: "a citation absent from the text forces the field to unknown", "a positive value with no quote is forced to unknown", "ignores offsets the model sends" |
| A value outside the allowed list becomes unknown | `server/verify/quotes.ts` | "a value outside the vocabulary is forced to unknown" |
| Proposal rules cover every branch, and cancer never produces a closure proposal | `server/verify/proposal.ts` | `server/verify/extract.test.ts`, "proposal rules (every branch)" |
| No key and no cache gives "needs human reading" and no model call | `server/verify/index.ts` | "no key, no cache" |
| An invented quote cannot reach a closure proposal through the endpoint | `server/verify/caseVerification.ts` | `server/verify/verification.test.ts` |
| The model's key is never echoed in an error | `server/verify/llm.ts` | "does not retry a rejected key, and never echoes it" |
| A confirmation or rejection is an event with the actor | `server/events.ts` | `server/writes.test.ts` |
| A cached reading is reused for the same report text, so the same report always gives the same answer | `server/verify/index.ts` | "re-running on the same report hits the cache" |

## Physician and AI: reject, reopen, divergence

- The closure review reads the case's latest report: the latest colonoscopy report read together with any later pathology report.
- The physician can **Reopen case** (records `procedure_incomplete` with the AI reading's reasons) or **Reject proposal** with a reason (`proposal_rejected`; it never moves the case). Both are events with the actor.
- The programme view counts physician-AI divergence (`ai_divergence`): proposals rejected, plus closures confirmed against the last reading. This is a count on synthetic demo data, not a measure of AI quality.
- Consultation answers are enforced to the addressed physician (server 403 otherwise).

## Demo readings are not model output

The two readings stored for demo case 3 are demo data. The first carries a `deepseek/...` model label but was not produced by a verified live model call. The second was written by hand and is labelled `hand-written demo reading (no model call)`. Do not describe either as a model result. They are not output of the 18 Nov evaluation calls either: the live model path is verified end to end by those real calls (`muse-spark-1.3`), while the offline demo uses these stored readings.

## Planned, not in the code

- Recording and counting divergence between the physician's decision and the AI proposal. The endpoint `POST /api/cases/{id}/proposal/reject` is in the contract (`docs/api.md`) but is not implemented.
- A confidence measure. None is shown, on purpose: the quote is the evidence.

## Data policy

- Only synthetic data is sent to any model.
- Models are reached through an OpenAI-compatible endpoint set by environment variables. DeepSeek is the default; Meta Muse Spark through the Meta Model API is possible. While using free credits, a provider's terms say content may be used for product improvement, which is a reason to send nothing real.
- Every extraction records the model, the prompt version and the hash of the report text, so a published number names what produced it.
- For a pilot, a policy for AI on clinical data is needed first. See [`dependencies.md`](dependencies.md).

## Known risks

- A model can misread a report. The design aims for a misread to keep a case open longer, not close one that should stay open. In the 18 Nov evaluation, 0 of 14 reports that must not be closed were proposed for closure; that is a measurement on 24 synthetic reports, not a guarantee.
- The test reports are written with AI help and read by AI, so the evaluation is likely easier than real reports. They are English only and 24 in number.
- A model can quote correctly and still choose the wrong value, for example read "no polyps" as normal when the report also describes a mass. The quote check proves the words exist; the physician has to read them.
- Bias: the prototype has no patient features beyond age and language in invented cases, and no risk score. Bias in real data, including in Arabic reports, has not been tested.
- Human oversight depends on the physician reading the report text and the quote, not on trusting a label.
- Misuse: a user can still confirm closure wrongly. The audit trail records who did.
- Patient messages are written by the team and not reviewed by a clinician; the Arabic text has not been reviewed by a native speaker.

## Evaluation results

The harness (`npm run eval`) reads 24 labelled synthetic reports with no cache, compares every field and the closure decision with `data/test-reports/labels.json`, and writes `docs/evaluation-results.md`, with fractions and denominators, wrong closures first, every error listed, with date, model and prompt version. On 18 Nov 2026 the harness was run for real (`muse-spark-1.3` through the Meta Model API, prompt `extract-v1`, 24 labelled synthetic reports, each read fresh, none unavailable). Reports that must not be closed: 14 of 14 held back, 0 of 14 proposed for closure (no dangerous error). Reports that may be closed: 4 of 10 proposed for closure, 6 of 10 held back for human reading (false alarms). Field agreement: complete_exam 24 of 24, pathology_available 24 of 24, next_step 23 of 24, tissue_taken 20 of 24, outcome_category 16 of 24, adequate_prep 15 of 24. 1 citation was rejected by the quote check. The main cause of false alarms is bowel preparation written as a score (for example BBPS) without a word such as "adequate": the prompt treats a score alone as unknown, so these go to a human. Most outcome-category disagreements are reports labelled "not stated" where the model named an outcome. The prompt was not changed after seeing the results (0 prompt changes). Full table and every disagreement: `docs/evaluation-results.md`. This measures the mechanism on synthetic reports written by the team with AI help; 24 is a small set; the labels have not been checked by a clinician. It is not clinical accuracy. Only the 24 synthetic reports were sent to the model.

## Clinical review

No clinician is on the team, and no clinician has reviewed the pathway, the deadlines, the closure rules, the proposal rules, the test labels or the patient messages. No reviewer is confirmed. This review comes before any pilot.
