# Deploying the prototype (Vercel + Turso)

Decided 18 Nov 2026. The frontend is a static Vite build; the API is the same Express app as `npm run server`, running as one Vercel function (`api/index.ts`). Vercel functions keep nothing on disk between requests, so the data lives in Turso, a hosted libSQL (SQLite-compatible) database.

## What is already in the repo

- `api/index.ts` exports the Express app from `server/index.ts`.
- `vercel.json` builds with `npm run build`, serves `dist/`, sends `/api/*` to the function, and sends every other path to `index.html` so React Router can handle it.
- `server/db.ts` uses `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` when they are set, and a local file (`DATABASE_FILE`, default `data/nexyra.sqlite`) when they are not. On Vercel without the URL it fails on purpose with a message saying what is missing.

## Shortest route: the Turso integration in the Vercel Marketplace

1. Create the Vercel project (step 3 below), without environment variables yet.
2. In the Vercel project, open **Storage** (or the Marketplace), add **Turso Cloud**, create a database, and connect it to the project. The integration sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, the same names `server/db.ts` reads.
3. Copy those values to your machine and fill the database once:
   ```bash
   npx vercel env pull .env
   ```
   ```bash
   npm run demo:reset:remote
   ```
4. Redeploy, then run the check in step 5 below.

## Manual route (done by a team member, from their own accounts)

1. **Create the Turso database.** In the Turso dashboard, create a database (for example `nexyra`) in a region near the Vercel region. Copy its URL (`libsql://...`) and create an auth token for it.
2. **Fill the database once from your machine.** Put both values in a local `.env` (copy `.env.example`; `.env` is git-ignored), then run:
   ```bash
   npm run demo:reset:remote
   ```
   It prints `reset libsql://...` and `cases=1003 (cohort 1000) events=5257 clock=day 0`, in about 10 s: the state is built on your machine and copied in a few batches (TICKET-17). The same command resets the deployed demo at any time.
3. **Create the Vercel project.** Either import the GitHub repository in the Vercel dashboard, or run `npx vercel` from the project folder. Importing needs the Vercel GitHub app on the repository owner's account; if you are a collaborator rather than the owner, the CLI route avoids that.
4. **Set the environment variables** in the Vercel project (Settings → Environment Variables): `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, plus `CRON_SECRET` (a random string of 16 or more characters) for the daily reset below. Redeploy after adding them.
5. **Check from a logged-out browser:** the worklist loads, `/api/clock` returns JSON, confirming closure on `CX-1003` works as the physician and is refused as the coordinator, and "+1 day" moves the clock.

## Not done yet

- The daily reset (TICKET-21) is configured but has not run on Vercel yet. `vercel.json` has a cron entry that calls `/api/demo/reset` at 21:00 UTC every day (Hobby allows one run a day, at some point in that hour); Vercel sends `Authorization: Bearer $CRON_SECRET`, and without `CRON_SECRET` (or `DEMO_RESET_SECRET`) the route answers 404 and the cron does nothing. To reset by hand: `curl -X POST -H "Authorization: Bearer <secret>" https://<deployment>/api/demo/reset`, or `npm run demo:reset:remote` from a laptop. Still reset before the judges look and after every rehearsal. The reset builds the state in an in-memory libSQL database inside the function, which needs the libSQL native module to load there (it already does, since `@libsql/client` imports it); check the first cron run in the Vercel logs.
- The deployed app has not been run on Vercel yet. Locally, the libSQL version passes all 95 tests, and its escalation sequence matches the previous `better-sqlite3` build step for step.

## Things to keep out of git

- `.env` (Turso token, LLM key).
- The DoH circular PDF. The repository is public.
