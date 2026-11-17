# Human review slots — flagged

Written 17 Nov 2026. **This is the one dependency the team cannot shorten by writing more code.** Fulan is a hospital colleague, not a team member, and his time is not ours to schedule. Everything downstream of these two slots is at risk if they slip.

## The two slots

| # | What | Ticket | Needed by | Blocks | Status |
|---|---|---|---|---|---|
| 1 | Label check on the 24 synthetic reports | TICKET-12 | **end of 17 Nov** | TICKET-13, 14, 15, deck evaluation section (26) | **not booked** |
| 2 | Clinical review session | TICKET-19 | **18 Nov** | Deck final (26), brief update (24), documentation (20) | **not booked** |

Both slots are with the same person. Slot 1 can be done asynchronously (he reads 24 reports and confirms or corrects `label.json`); slot 2 needs 1–2 hours of live or video time.

## Why slot 1 cannot move

`TICKET-14`'s evaluation numbers only mean something if the labels were fixed **before** extraction ran. If Fulan reviews after `TICKET-13` has produced results, the set has been tuned on, and `TICKET-14`'s own note says that must then be stated plainly — which weakens the strongest claim in the deck. Labelling after extraction does not just delay the work, it downgrades the evidence.

## Why slot 2 cannot move

The deck skeleton (`TICKET-26`) is dated 17 Nov and its content 19 Nov. `TICKET-24` applies the reviewer's corrections to the brief. `TICKET-20` cites the review in `docs/clinical-review.md`. A review on 19 Nov leaves no room to apply corrections, and an unapplied correction is worse than none — the deck would quote a flow the reviewer already said was wrong.

## What to send before each slot

**Slot 1 (labels):**
- The 24 report text files, numbered, no answers attached.
- The empty `label.json` schema, so he knows the eight fields and the allowed values (`yes` / `no` / `not stated`).
- One sentence on what he is judging: *does this report show a complete exam with adequate prep, and may this case be proposed for closure?*
- A clear statement that this is synthetic data, not his patients, and that nothing from his workplace is used.

**Slot 2 (clinical review):** the materials list is already in `TICKET-19` — flow diagram, printed stage/deadline list from `TICKET-04`, four to six sample reports flagged in `TICKET-12`.

## Prompts to send

**Slot 1:**
> Fulan, I need about an hour of your judgment on 24 synthetic colonoscopy and pathology reports. No patient data — these are written by us, deliberately imperfect, some with inadequate prep and some incomplete. For each one I need you to tell me: was the exam complete, was the prep adequate, was tissue taken, is pathology available, what is the outcome category, and — the one that matters — may this case be proposed for closure? Answers go in a fixed-format file I'll send alongside. Deadline is today if at all possible, because the numbers we publish have to be measured against labels you fixed first.

**Slot 2:**
> Fulan, 1–2 hours on 18 Nov to check the clinical logic of the pathway: the steps after a positive FIT, who informs the patient, whether the deadlines are sane, when a colonoscopy counts as incomplete, and what the right next step is for normal, polyp, and cancer pathology. I'll bring the printed flow and deadline list. I want you to tell me where it would be clinically dangerous or misleading, not just where it is imperfect.

## Reminders to keep

- [ ] 17 Nov, morning — send slot 1 materials and confirm he has them
- [ ] 17 Nov, afternoon — if no answer, ask for a partial pass (the 12 reports that decide `may_be_proposed_for_closure`), rather than waiting for all 24
- [ ] 17 Nov, evening — confirm the slot 2 time in writing
- [ ] 18 Nov — hold the session; record it in `docs/clinical-review.md` the same day, while it is fresh
- [ ] 18 Nov — apply corrections to `TICKET-04`'s template and `TICKET-12`'s labels immediately, not during deck writing

## If a slot cannot happen

Do not silently drop the review. Two honest fallbacks, in order of preference:

1. **Partial review.** Fulan checks only the closure rule and the post-pathology branches — the part where being wrong is clinically dangerous. Record exactly what was *not* reviewed in `docs/clinical-review.md`; `TICKET-19` already requires that section.
2. **No review, declared.** Every unsourced deadline stays marked `source: "unsourced, needs clinical review"`, and the deck states that no clinician reviewed the flow. The brief already carries this limitation; keep it visible rather than implying a review that did not happen.

## Where this is tracked

- `TICKET-12` and `TICKET-19` both carry this file as a note.
- `docs/ideas/build-readiness.md` lists it as the one open dependency.
- The deadline is the submission: **21 Nov 2026, 02:59 UTC+7**. Slot 1 slipping past 17 Nov removes the ability to publish a clean evaluation; slot 2 slipping past 18 Nov removes the ability to correct the deck.
