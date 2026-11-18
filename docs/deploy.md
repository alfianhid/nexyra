# Deploying the prototype (Vercel + Turso)

Decided 18 Nov 2026. The frontend is a static Vite build; the API is the same Express app as `npm run server`, running as one Vercel function (`api/index.ts`). Vercel functions keep nothing on disk between requests, so the data lives in Turso, a hosted libSQL (SQLite-compatible) database.

## What is already in the repo

- `api/index.ts` exports the Express app from `server/index.ts`.
- `vercel.json` builds with `npm run build`, serves `dist/`, sends `/api/*` to the function, and sends every other path to `index.html` so React Router can handle it.
- `server/db.ts` uses `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` when they are set, and a local file (`DATABASE_FILE`, default `data/nexyra.sqlite`) when they are not. On Vercel without the URL it fails on purpose with a message saying what is missing.

## Steps (done by a team member, from their own accounts)

1. **Create the Turso database.** In the Turso dashboard, create a database (for example `nexyra`) in a region near the Vercel region. Copy its URL (`libsql://...`) and create an auth token for it.
2. **Fill the database once from your machine.** Put both values in a local `.env` (copy `.env.example`; `.env` is git-ignored), then run:
   ```bash
   npm run demo:reset:remote
   ```
   It prints `reset libsql://...` and `actors=6 cases=3 events=8`. The same command resets the deployed demo at any time.
3. **Create the Vercel project.** Either import the GitHub repository in the Vercel dashboard, or run `npx vercel` from the project folder. Importing needs the Vercel GitHub app on the repository owner's account; if you are a collaborator rather than the owner, the CLI route avoids that.
4. **Set the environment variables** in the Vercel project (Settings → Environment Variables): `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Redeploy after adding them.
5. **Check from a logged-out browser:** the worklist loads, `/api/clock` returns JSON, confirming closure on `CX-1003` works as the physician and is refused as the coordinator, and "+1 day" moves the clock.

## Not done yet

- Automatic periodic reset of the deployed demo (TICKET-21). Until then, run `npm run demo:reset:remote` before the judges look and after every rehearsal.
- The deployed app has not been run on Vercel yet. Locally, the libSQL version passes all 95 tests, and its escalation sequence matches the previous `better-sqlite3` build step for step.

## Things to keep out of git

- `.env` (Turso token, LLM key).
- The DoH circular PDF. The repository is public.
