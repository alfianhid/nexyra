# Dependencies

Two lists: what a pilot needs and does not have yet, and what the prototype itself runs on.

## What a pilot needs and does not have

| Need | Status |
|---|---|
| Access to Malaffi referral and lab-result data (the HL7 REF messages DoH Circular 144/2026 requires) | Not available. Not requested. |
| The Malaffi message specification, to check the HL7 v2 field map in `server/ingest/hl7v2/parse.ts` | Not seen. The ingest is generic HL7 v2.5. |
| Malaffi e-Referral as the channel for consultation questions and answers | Not connected. Two endpoints stand in for it. |
| Department of Health approval for a pilot | Not sought |
| Hosting and identity set-up that satisfies clinical data policy | Not done. The prototype is on public hosting with no login. |
| Local clinical review of pathway stages, deadlines, closure evidence rules and message wording | `[CLINICAL REVIEW PENDING — TICKET-19]` |
| A clinician to check the labels of the report test set | Not done. `checked_by` is empty. |
| Native-speaker review of Arabic patient-facing text, and written Urdu, Hindi and Tagalog templates | Arabic written, not reviewed. The other three are empty slots. |
| An SMS or WhatsApp gateway and sender registration | Not built. The message is recorded as sent, not delivered. |
| A policy for using AI models on clinical data, and a model provider whose terms allow it | Not written. The prototype sends only synthetic data to any model. |
| Real authentication and per-user audit | Not built. The role is chosen from a menu. |
| A screening-programme partner with a named clinical owner | None. No clinician on the team. |
| Local identifiers (Emirates ID, MRN) and a rule for identity matching beyond exact keys | Exact keys only. Probabilistic matching is designed, not built. |

## What the prototype runs on

| Component | Use | Where |
|---|---|---|
| Node.js 22, TypeScript | Server and tooling | `package.json` |
| React 18, Vite 5, React Router 6 | Frontend | `src/` |
| Express 4 | API, run as one Vercel function in deployment | `server/`, `api/index.ts` |
| `@libsql/client` | Database client. Local SQLite file, or Turso when `TURSO_DATABASE_URL` is set. | `server/db.ts` |
| `hl7v2` (npm) | HL7 v2 parsing. Pure JavaScript, no native build. | `server/ingest/hl7v2/` |
| Vitest 2 | 317 tests in 26 files | `server/*.test.ts`, `src/*.test.ts` |
| Vercel | Hosting and the daily demo-reset cron. Running at https://nexyra-health.vercel.app (API in Mumbai). | `vercel.json`, `docs/deploy.md` |
| Turso | Hosted libSQL database (Mumbai). Calls retry once when an idle connection was closed. | `docs/deploy.md` |
| An OpenAI-compatible model endpoint | Report extraction. DeepSeek is the default; Meta Muse Spark through the Meta Model API is possible. Configured with `LLM_BASE_URL`, `LLM_API_KEY` and `NEXYRA_MODEL`. | `server/verify/llm.ts`, `.env.example` |

## Model dependency, stated plainly

- The demo does not need a model. The two readings for demo case 3 are stored demo readings (one with a `deepseek/...` model label that was not a verified live call, one written by hand and labelled `hand-written demo reading (no model call)`), and an extraction already seen is served from a cache keyed by a hash of the report text.
- The live path exists: with `LLM_BASE_URL` and `LLM_API_KEY` set, `POST /api/cases/{id}/verification` and `npm run verify:file` call the model, check every quote against the report in code, and apply the proposal rules. Without a key and without a cached reading, the answer is "needs human reading".
- The live path has been tested with a fake model and has not yet been run against a real provider. `[EVAL RESULTS PENDING — TICKET-14]`
- A provider's terms can allow use of content for product improvement while free credits are used. For that reason only synthetic data is ever sent to any model.
- API keys live in `.env` and in Vercel settings. They are never committed.

## Third-party licences

The open-source packages above are used under their own licences. A full licence list is not yet produced. `[LICENCE LIST TO BE GENERATED FROM package-lock.json BEFORE THE DECK SLIDE "Pre-existing IP and third-party materials"]`
