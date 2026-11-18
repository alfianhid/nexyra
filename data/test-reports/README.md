# Labeled test reports (TICKET-12)

24 synthetic English colonoscopy reports (`r01.txt` to `r24.txt`), with the answers fixed in `labels.json`. They are used by the closure-verification evaluation (TICKET-14).

Everything is invented: patients are `TEST-00NN`, the doctors are `Dr. A. Example`, `Dr. B. Sample`, `Dr. C. Placeholder`, and the hospital and laboratory are marked "(fictional)". No real hospital or person is used.

## Distribution

| Category (`category` in labels.json) | Reports | Count |
|---|---|---|
| complete_normal (complete, no findings) | r02, r06, r10, r14, r19, r23 | 6 |
| polyp_pathology_back (polyps removed, pathology available) | r04, r11, r17, r24 | 4 |
| cancer (cancer on pathology) | r08, r16 | 2 |
| incomplete (caecum not reached) | r01, r09, r15, r22 | 4 |
| inadequate_prep | r05, r13, r20 | 3 |
| pathology_pending (tissue taken, no result) | r03, r12, r21 | 3 |
| ambiguous (key information missing or contradictory) | r07, r18 | 2 |
| **Total** | | **24** |

`may_propose_closure` is `yes` for 10 reports (the 6 complete_normal and the 4 polyp_pathology_back) and `no` for the other 14.

Styles are mixed: tidy with headings, one-paragraph narrative, and abbreviation-heavy.

## Label conventions

- `complete_exam`, `adequate_prep`, `tissue_taken`: `yes` / `no` / `not_stated`. If the report contradicts itself, the label is `not_stated`.
- `pathology_available`: `yes` / `no` / `not_applicable` (no tissue taken).
- `outcome_category`: `normal` / `polyp` / `cancer` / `not_stated`. It is `not_stated` when nothing was found in a limited exam or when pathology is pending.
- `stated_next_step`: a short summary of what the report itself recommends, or `null` if it recommends nothing.
- Cancer reports are labeled `may_propose_closure: no`: the follow-up moves to a cancer pathway and is not closed as a routine screening episode. This is a judgment call; see the flag list.
- Incomplete or poorly prepared exams with a benign finding (r15) are `no`, because the colon was not adequately examined.

## Independence rule

The reports and labels were written without access to the extraction prompt, the verification code or the API docs, and without guessing what the extractor looks for. The reports are written the way real endoscopy and pathology reports are written. The report writer must stay separate from the extraction prompt writer (TICKET-12 notes). They are still AI-written and are later read by AI, so results show that the mechanism works, not accuracy on real hospital reports.

## Rule: labels are frozen

`labels.json` was written on 2026-11-18, before any extraction was run. It must not be changed after extraction results are seen. The only exception is a label that is genuinely wrong. Every such change must be recorded in `change_log` with the report id, old value, new value, reason and date. Do not edit a label because the extractor disagrees with it.

Human check: `checked_by` and `checked_at` in `labels.json` stay `null` until the human checker has read all reports and the labels. Until then the labels are the writer's own and unchecked.

## Reports recommended for the clinical reviewer

| Id | Why |
|---|---|
| r07 | Header says caecum reached, notes say the scope stopped at the splenic flexure. Is the extent really unresolvable, and is `no` the right closure answer? |
| r18 | Prep entered as BBPS 9 "excellent" but the findings describe obscured right colon. Which statement should a clinician trust? |
| r15 | Benign path back but the exam is incomplete. Confirm that this must stay open. |
| r16 | Invasive adenocarcinoma in an adenoma. Confirm that cancer cases are not "closeable" and that the MDT handoff is what ends the screening follow-up. |
| r20 | Caecum reached but poor prep (Ottawa 11). Confirm it counts as an inadequate exam, not a complete one. |
| r23 | Perfect normal exam but no recommendation written. Can closure be proposed without a stated next step? |
