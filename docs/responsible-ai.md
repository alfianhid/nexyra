# Responsible AI

## Role of AI

AI reads a colonoscopy or pathology report and copies out what is written: whether the exam was complete, prep quality, whether a biopsy was taken, whether pathology is available, the outcome category and the next steps. It then proposes whether the case may go to closure. It does not diagnose, set surveillance intervals or advise on care.

## What AI may not do

- It may not close a case. Only a responsible physician's confirmation closes one.
- It may not present a proposal as a decision. Proposals are labelled as AI proposals on screen.
- It may not fill a gap with a guess. A doubt ends as "needs human reading", and a case staying open is the safe direction of error.

## How this is enforced today

| Rule | Where | Test |
|---|---|---|
| The `system` role (which includes AI) cannot close a case, even when every condition is met | `server/engine.ts` | `server/engine.test.ts`: "never lets the system role close a case, even with every condition met"; "refuses a system-role transition into closure" |
| Closure needs a valid outcome from a closed list | `server/engine.ts` | "rejects closure when the final outcome is missing"; "treats an outcome outside the closed vocabulary as not recorded" |
| Closure needs attached evidence | `server/engine.ts` | "rejects closure when no evidence is attached" |
| Only the responsible physician confirms | `server/engine.ts` | "rejects closure when the acting role is not the responsible physician" |
| The program manager has no case action | `server/engine.ts` | "gives the program manager no case action at any stage" |
| Available actions and guards come from one function | `server/engine.ts` | "derives every role's action list from the same function" |
| A confirmation or rejection is recorded as an event with the actor | `server/events.ts` | `server/writes.test.ts` |

## Planned, not yet in the code

- Every extracted field carries a quotation from the report. A quotation that is not verbatim in the text forces the field to unknown. `[PLANNED — TICKET-13]`
- Divergence between the clinician's decision and the AI proposal is recorded and counted. `[PLANNED]`
- Extraction results are cached by a hash of the report text. The table exists; the extraction step does not call a model yet.

## What the data policy is

- Only synthetic data is sent to any model.
- Models are reached through an OpenAI-compatible endpoint, set by environment variables. DeepSeek is the default. Meta Muse Spark through the Meta Model API is an option. Under Meta's free credits, content may be used for product improvement, which is a reason to send nothing real.
- For a pilot, a policy for AI on clinical data is needed first. See [`dependencies.md`](dependencies.md).

## Known risks

- A model can misread a report. The design aims for a misread to keep a case open longer, not close one that should stay open. This is a design aim until the evaluation exists.
- The test reports are written with AI help and read by AI, so the evaluation will be easier than real reports.
- Bias: the prototype has no patient features beyond age and language in invented cases, and no risk score. Bias in real data has not been tested.
- Human oversight depends on the physician reading the report text and quotation, not on trusting a label.
- Misuse: a user can still confirm closure wrongly. The audit trail records who did.

## Evaluation results

`[EVAL RESULTS PENDING — TICKET-14]`

To be reported as fractions with denominators, wrong closures first, every error listed, with date, model and prompt version.

## Clinical review

`[CLINICAL REVIEW PENDING — TICKET-19]`

No clinician is on the team, and no clinician has reviewed the pathway or the closure rules at the time of writing.
