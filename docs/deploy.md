# Deploying the prototype (Vercel + Turso)

Decided 18 Nov 2026. The frontend is a static Vite build; the API is the same Express app as `npm run server`, running as one Vercel function (`api/index.ts`). Vercel functions keep nothing on disk between requests, so the data lives in Turso, a hosted libSQL (SQLite-compatible) database.

## What is already in the repo

- `api/index.ts` exports the Express app from `server/index.ts`.
- `vercel.json` builds with `npm run build`, serves `dist/`, sends `/api/*` to the function, and sends every other path to `index.html` so React Router can handle it.
- `server/db.ts` uses `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` when they are set, and a local file (`DATABASE_FILE`, default `data/nexyra.sqlite`) when they are not. On Vercel without the URL it fails on purpose with a message saying what is missing.

## Shortest route: the Turso integration in the Vercel Marketplace

1. Create the Vercel project (step 3 below), without environment variables yet.
2. In the Vercel project, open **Storage** (or the Marketplace), add **Turso Cloud**, create a database, and connect it to the project. The integration sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, the same names `server/db.ts` reads.
3. The values are marked sensitive in Vercel and cannot be pulled with `vercel env pull`. Fill the database through the hosted reset (see "Deployed" below).
4. Redeploy, then run the check in step 5 below.

## Manual route (done by a team member, from their own accounts)

1. **Create the Turso database.** In the Turso dashboard, create a database (for example `nexyra`) in a region near the Vercel region. Copy its URL (`libsql://...`) and create an auth token for it.
2. **Fill the database once from your machine.** Put both values in a local `.env` (copy `.env.example`; `.env` is git-ignored), then run:
   ```bash
   npm run demo:reset:remote
   ```
   It prints `reset libsql://...` and `cases=1006 (cohort 1000) events=5276 clock=day 0`, in about 10 s: the state is built on your machine and copied in a few batches (TICKET-17). The same command resets the deployed demo at any time.
3. **Create the Vercel project.** Either import the GitHub repository in the Vercel dashboard, or run `npx vercel` from the project folder. Importing needs the Vercel GitHub app on the repository owner's account; if you are a collaborator rather than the owner, the CLI route avoids that.
4. **Set the environment variables** in the Vercel project (Settings → Environment Variables): `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, plus `CRON_SECRET` (a random string of 16 or more characters) for the daily reset below. Redeploy after adding them.
5. **Check from a logged-out browser:** the worklist loads, `/api/clock` returns JSON, confirming closure on `CX-1003` works as the physician and is refused as the coordinator, and "+1 day" moves the clock.

## Deployed (18 Nov 2026)

The prototype is live at **https://nexyra-health.vercel.app** (Vercel project `nexyra`, public). The API runs in Mumbai (`bom1`), next to the Turso database, also in Mumbai and the closest region to Abu Dhabi.

- **Deploys run from the local folder** with `npx vercel deploy --prod --yes`. The GitHub repository is owned by a teammate, so there is no Git integration: pushing does not deploy.
- **Turso values are marked sensitive in Vercel** and cannot be read back with `vercel env pull`. Seed the hosted database through the hosted reset below, not with `npm run demo:reset:remote` from a laptop.
- **Hosted reset:** `curl -X POST -H "Authorization: Bearer <CRON_SECRET>" https://nexyra-health.vercel.app/api/demo/reset`. Verified on the hosted app: 1,006 cases including the 1,000-case synthetic cohort, in about 6 to 9 s.
- **Daily reset:** a Vercel Cron entry in `vercel.json` calls the same route at 21:00 UTC (Hobby allows one run a day, at some point in that hour) with `Authorization: Bearer $CRON_SECRET`. Without `CRON_SECRET` (or `DEMO_RESET_SECRET`) the route answers 404 and the cron does nothing. Still reset before the judges look and after every rehearsal.
- **Idle connections:** a database call is retried once when Turso has closed an idle connection (seen on Vercel). SQL errors are never retried.

## Not done yet

- The first scheduled cron run has not been checked in the Vercel logs.

## Things to keep out of git

- `.env` (Turso token, LLM key).
- The DoH circular PDF. The repository is public.
