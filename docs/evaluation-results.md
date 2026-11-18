# Closure verification evaluation (TICKET-14)

- Date: 2026-11-18
- Model: muse-spark-1.3
- Prompt version: extract-v1
- Reports: 24; read by the model: 24; unavailable: 0
- No cache: every report was read fresh.

## Closure proposals

- Must not be closed: held back correctly 14 of 14; proposed for closure anyway (dangerous) 0 of 14. Slipped through: none.
- May be closed: correctly proposed 4 of 10; held back (false alarm) 6 of 10. Held back: r06, r10, r17, r19, r23, r24.

## Agreement per field

| Field | Agreement |
|---|---|
| complete_exam | 24 of 24 |
| adequate_prep | 15 of 24 |
| tissue_taken | 20 of 24 |
| pathology_available | 24 of 24 |
| outcome_category | 16 of 24 |
| next_step | 23 of 24 |

## Citations that failed validation

1 rejected across 24 read reports.

## Reports with any disagreement

| Report | Field | Expected | Got |
|---|---|---|---|
| r01 | tissue_taken | no | unknown |
| r01 | outcome_category | not_stated (= not_stated or unknown) | normal |
| r03 | outcome_category | not_stated (= not_stated or unknown) | polyp |
| r06 | adequate_prep | yes | unknown |
| r06 | closure | may propose closure | needs_human_reading |
| r07 | tissue_taken | no | unknown |
| r07 | outcome_category | not_stated (= not_stated or unknown) | normal |
| r10 | adequate_prep | yes | unknown |
| r10 | closure | may propose closure | needs_human_reading |
| r12 | outcome_category | not_stated (= not_stated or unknown) | polyp |
| r12 | next_step | stated | not_stated |
| r13 | tissue_taken | no | unknown |
| r13 | outcome_category | not_stated (= not_stated or unknown) | normal |
| r16 | adequate_prep | yes | unknown |
| r17 | adequate_prep | yes | unknown |
| r17 | closure | may propose closure | needs_human_reading |
| r18 | outcome_category | not_stated (= not_stated or unknown) | normal |
| r19 | adequate_prep | yes | unknown |
| r19 | closure | may propose closure | needs_human_reading |
| r21 | adequate_prep | yes | unknown |
| r21 | outcome_category | not_stated (= not_stated or unknown) | polyp |
| r22 | adequate_prep | yes | unknown |
| r22 | outcome_category | not_stated (= not_stated or unknown) | normal |
| r23 | adequate_prep | yes | unknown |
| r23 | tissue_taken | no | unknown |
| r23 | closure | may propose closure | needs_human_reading |
| r24 | adequate_prep | yes | unknown |
| r24 | closure | may propose closure | needs_human_reading |

## Label to module mapping

- `complete_exam`, `adequate_prep`, `tissue_taken`: label `yes` / `no` match module `yes` / `no`; label `not_stated` matches module `unknown`.
- `pathology_available`: label `yes` / `no` match module `yes` / `no`; label `not_applicable` (no tissue taken, so no pathology needed) matches module `no` or `unknown`, and a module `yes` counts as a disagreement.
- `outcome_category`: `normal`, `polyp`, `cancer` match as written; label `not_stated` matches module `not_stated` or `unknown`.
- `next_step`: label `stated_next_step` with text matches module `stated`; label `null` matches module `not_stated` or `unknown`. Only whether a next step is stated is compared, not its wording.
- "May propose closure" means the module proposal is `propose_closure` and nothing else; `reopen`, `wait_for_pathology` and `needs_human_reading` all count as held back.
- Reports whose extraction was `unavailable` (no key or model unreachable) are excluded from every count below and listed separately; they are never counted as correct hold-backs.

## Limitations

The test reports are synthetic and were written by the team with AI help. 24 reports is a small set, so a fraction here says little about how the system would do on real hospital reports. The labels have not yet been checked by a clinician (`checked_by` in `data/test-reports/labels.json` is null). The prompt was not tuned on this set: 0 prompt changes made after seeing results (0 at first run; update this number if the prompt is changed and the evaluation is rerun).
