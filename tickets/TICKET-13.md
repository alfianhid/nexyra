# TICKET-13 · Report extraction with citations

- **Priority:** P0 · **Day:** 17 Nov · **Estimate:** 4 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-05, TICKET-12
- **Status:** done in code (checked 18 Nov); run against a real model on 18 Nov 2026 as part of TICKET-14 (`muse-spark-1.3`, 24 synthetic reports). `server/verify/` has the prompt (`extract-v1`), fields, code-checked quotes, proposal rules, cache and an OpenAI-compatible client; endpoint `POST /api/cases/{id}/verification` and `npm run verify:file`. Tests use a fake model (`server/verify/extract.test.ts`, `verification.test.ts`). The live call needs `LLM_BASE_URL` and `LLM_API_KEY`.

## Goal

Nexyra's second differentiator. Reading colonoscopy and pathology reports, then determining whether a case about to be closed really may be closed, with evidence a human can check in seconds.

## Scope

- A `src/verify` module that takes report text and returns structured JSON with fields: complete exam, adequate bowel prep, tissue taken, pathology available, outcome category (normal, polyp, cancer, not stated), and documented next steps.
- Each field holds a `value` (yes, no, or `unknown`) and a `quote` (sentence from the report).
- **Citation validation in code:** a citation must be a fragment of text that appears exactly in the report. If it is absent or does not match, that field's value is forced to `unknown`.
- Model calls through the OpenAI-compatible chat completions API with structured output. Base URL from `LLM_BASE_URL`, key from `LLM_API_KEY`, model from `NEXYRA_MODEL` (default `deepseek/deepseek-v4.1-flash-1017`). The Anthropic SDK is not used.
- Proposal rules, written as plain code and not left to the model:
  - Incomplete exam or inadequate prep → `reopen`
  - Tissue taken but pathology not yet available → `wait_for_pathology`
  - Any key field valued `unknown` → `needs_human_reading`
  - Otherwise → `propose_closure` with the final outcome matching the category
- Extraction results are stored as an event on the case, complete with prompt version and model name.
- A cache per report (keyed by text hash), so the demo keeps working without a network and results do not change mid-presentation.

## Out of scope

Diagnosis, surveillance interval recommendations, or any clinical advice from the model. The model only copies what is written.

## Done when

- [ ] Test: a citation absent from the text forces the field to `unknown`
- [ ] Test: every proposal-rule branch
- [ ] Test: without an API key and without a cache, the module returns `needs_human_reading`, never `propose_closure`
- [ ] Test: extraction results cannot close a case (falls under TICKET-05's rules)
- [ ] Re-running on the same report hits the cache
- [ ] No API keys in the code or in git

## Notes

The request and response shape for extraction is fixed in [`docs/api.md`](../docs/api.md) (`GET` and `POST /api/cases/{case_id}/verification`). The model is `deepseek/deepseek-v4.1-flash-1017` through an OpenAI-compatible endpoint; record the model string and prompt version in `docs/evaluation-results.md` so the numbers can be reproduced.

The safe direction of error is a case staying open too long. Any doubt must end in `needs_human_reading`.
