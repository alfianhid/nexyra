# Dependencies

Two lists: what a pilot needs and does not have yet, and what the prototype itself runs on.

## What a pilot needs and does not have

| Need | Status |
|---|---|
| Access to Malaffi referral and lab-result data (the HL7 REF messages DoH Circular 144/2026 requires) | Not available. Not requested. |
| Department of Health approval for a pilot | Not sought |
| Hosting and identity set-up that satisfies clinical data policy | Not done. The prototype is on public hosting with no login. |
| Local clinical review of pathway stages, deadlines and closure evidence rules | `[CLINICAL REVIEW PENDING — TICKET-19]` |
| Native-speaker review of Arabic patient-facing text | Not done. No Arabic patient templates exist in the current build. |
| A policy for using AI models on clinical data | Not written. The prototype sends only synthetic data to any model. |
| Real alerts (email, SMS) | Not built. Outreach attempts are logged by staff. |
| Real authentication and per-user audit | Not built. The role is chosen from a menu. |
| Malaffi message formats beyond the circular's REF description | Not seen first-hand |
| A clinician on the team or a named clinical owner for a pilot | None |

## What the prototype runs on

| Component | Use | Where |
|---|---|---|
| Node.js, TypeScript | Server and tooling | `package.json` |
| React 18, Vite 5, React Router 6 | Frontend | `src/` |
| Express 4 | API, run as one Vercel function in deployment | `server/`, `api/index.ts` |
| `@libsql/client` | Database client. Local SQLite file, or Turso when `TURSO_DATABASE_URL` is set. | `server/db.ts` |
| Vitest 2 | Tests | `server/*.test.ts` |
| Vercel | Hosting. Not yet confirmed running there. | `vercel.json`, `docs/deploy.md` |
| Turso | Hosted libSQL database | `docs/deploy.md` |
| An OpenAI-compatible model endpoint | Report extraction. DeepSeek is the default; Meta Muse Spark through the Meta Model API is an option. Configured with `LLM_BASE_URL`, `LLM_API_KEY` and `NEXYRA_MODEL`. | `.env.example` |

## Model dependency, stated plainly

- The current build does not call a model at run time. The extraction shown for the demo case is a stored row.
- The configuration for a model exists. The live extraction step is `[PLANNED — TICKET-13]`.
- While the team uses Meta's free credits, the provider's terms say content may be used for product improvement. For that reason only synthetic data is ever sent to any model.
- Extraction results are meant to be cached by a hash of the report text, so a repeated run does not call the model again. The table and the unique hash index exist in `server/db.ts`.
- API keys live in `.env` and in Vercel settings. They are never committed.

## Third-party licences

The open-source packages above are used under their own licences. A full licence list is not yet produced. `[LICENCE LIST TO BE GENERATED FROM package-lock.json BEFORE THE DECK SLIDE "Pre-existing IP and third-party materials"]`
