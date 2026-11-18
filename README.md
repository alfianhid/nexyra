# Nexyra

Nexyra is a case engine for positive screening results, built for Challenge 05 "Closing the Screening-to-Care Loop" of the Future Health Digital Innovation Challenge. Every case has one owner, a deadline per stage and an audit trail, and it escalates by role when nobody acts. A case closes only when evidence is attached and a responsible physician confirms; AI may extract and propose, and the `system` role can never close a case. All data in this repository is synthetic.

Nexyra builds on Malaffi e-Referral data (DoH Circular 144/2026). It is not a referral tracker and not a messaging channel. No drop-off risk model is built.

## Prerequisites

- Node.js 20.6 or newer, with npm.
- No database server. Locally the app uses a SQLite file (`data/nexyra.sqlite`, created on first run). Deployed, it uses Turso.
- No API key is needed to run the demo. The extraction result shown in the demo is stored in the database. The current build makes no live model call.

## Install

```bash
npm install
```

## Run locally

Run these in order. The last two keep running, so use two terminals.

```bash
npm run demo:reset    # creates data/nexyra.sqlite: the three demo cases, the 1,000-case synthetic cohort, day 0 (about 6 s)
npm run server        # API on http://localhost:3001
npm run dev           # frontend on http://localhost:5173, proxies /api to the server
```

Open the frontend URL, pick a role (coordinator, physician or program manager), and work the three demo cases. The demo clock is controlled from the screen. Run `npm run demo:reset` again to return to the starting state.

Windows note: in PowerShell, if script execution is blocked, use `npm.cmd` and `npx.cmd` instead of `npm` and `npx`, for example `npm.cmd install` and `npm.cmd run server`.

## Tests

```bash
npm test                  # server tests (Vitest)
npm run typecheck:server  # type check for server/
npm run build             # type check and build the frontend
```

## Deploy

The target is Vercel for the frontend and the API function, with Turso as the database. Steps are in [`docs/deploy.md`](docs/deploy.md). Environment variables are listed in `.env.example`. Never commit `.env`.

## Documentation

| File | Content |
|---|---|
| [`docs/assumptions.md`](docs/assumptions.md) | Every assumption, with its source or an assumption label |
| [`docs/dependencies.md`](docs/dependencies.md) | What a pilot needs and does not have yet |
| [`docs/limitations.md`](docs/limitations.md) | What this build does not do or prove |
| [`docs/data-sources.md`](docs/data-sources.md) | Data and literature sources |
| [`docs/evidence.md`](docs/evidence.md) | Evidence summary with caveats as in the sources |
| [`docs/responsible-ai.md`](docs/responsible-ai.md) | Role of AI, limits on it, and how they are enforced |
| [`docs/api.md`](docs/api.md) | API contract |
| [`docs/architecture.md`](docs/architecture.md) | Architecture (being written by another ticket) |
| [`docs/submission.md`](docs/submission.md) | Official submission requirements |

The product brief is [`brief-c05-nexyra.html`](brief-c05-nexyra.html).
