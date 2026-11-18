# TICKET-21 · Demo video and prototype link

- **Priority:** P0 · **Day:** first deploy 18 Nov, video 19 Nov · **Estimate:** 3 hours deploy, 3 hours video · **Assignee:** human, assisted by Claude Code
- **Depends on:** TICKET-17
- **Status:** in progress. 18 Nov: the daily reset exists (`POST /api/demo/reset`, a Vercel cron in `vercel.json`, `CRON_SECRET`), not yet run on Vercel. `docs/video-script.md` drafted. Deploy and video not done.

## Goal

The submission form requires two links: a prototype or deployment, and a demo video under 3 minutes. Judges assess from both links and from the deck, so both must open without our help.

## Scope

### Prototype link

- The application is hosted and judges can open it via a single link, without login.
- Hosting is decided (18 Nov): Vercel for the frontend and the API function, Turso for the database. Steps are in [`docs/deploy.md`](../docs/deploy.md). Do the first deploy on 18 Nov, because the first deploy almost always surfaces problems.
- The demo database is reset automatically on a schedule, so judges always find the three demo cases in their starting state.
- The landing page explains in a few sentences what is being looked at and which step to try first.
- API keys live only on the server. Closure verification on the hosted version uses pre-stored results for the demo reports, so there is no cost or abuse from visitors.
- The link must stay alive until judging is over (30 Nov) and preferably until 11 Dec.

### Demo video

- Duration **under 3 minutes**. Aim for 2 minutes 45 seconds.
- A video-specific script in `docs/video-script.md`, derived from the TICKET-17 demo script:
  1. 0:00–0:20: the problem in one sentence and one number.
  2. 0:20–1:20: case 3. The case is marked done, verification finds an incomplete exam, the clinician reopens it.
  3. 1:20–2:00: case 2. Referral rejected, unowned case detected, new owner assigned.
  4. 2:00–2:30: clock advances, escalation runs, program view.
  5. 2:30–2:45: what has been proven, what has not, and the pilot path.
- Screen-record with English narration. On-screen text large enough to read in a small video window.
- Upload to YouTube (unlisted), Vimeo, or Google Drive with "anyone with the link" access.

## Out of scope

Production infrastructure, own domain, authentication, elaborate video editing.

## Done when

- [ ] The prototype link opens from another device, another network, and an incognito window
- [ ] All three demo cases run on the hosted version
- [ ] The video is under 3 minutes according to the video player
- [ ] The video link opens in an incognito window without login
- [ ] No API keys, personal data, or private notifications are visible in the video or the repository
- [ ] Every number mentioned in the video matches the documentation

## Notes

Creating a hosting account, uploading the video, and opening the application to the internet are outward-facing actions. The project owner decides on and performs them. Case 1 (the silent patient) is not in the video because there is not enough time; that case stays in the prototype and the deck.
