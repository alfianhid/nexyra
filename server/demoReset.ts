import { Router, type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { getClock } from "./clock.js";
import { getDb } from "./db.js";
import { HttpError } from "./errors.js";
import { resetDemo } from "./reset.js";

// TICKET-21: the hosted demo resets itself once a day, so judges always find the three
// demo cases at their starting point. `POST /api/demo/reset` runs the same reset as
// `npm run demo:reset` against the deployed database.
//
// It is closed unless a secret is configured: with neither DEMO_RESET_SECRET nor
// CRON_SECRET set, the route answers 404 like any unknown endpoint. With one set, the
// request needs `Authorization: Bearer <secret>`. Vercel Cron sends exactly that header
// with the project's CRON_SECRET, and it sends a GET, so GET is accepted too.

export const demoResetRouter = Router();

function secrets(): string[] {
  return [process.env.DEMO_RESET_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function matches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function reset(req: Request, res: Response): Promise<void> {
  const accepted = secrets();
  if (accepted.length === 0) {
    throw new HttpError(404, "not_found", "No such endpoint.");
  }
  const header = req.header("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? "";
  if (!token || !accepted.some((secret) => matches(secret, token))) {
    throw new HttpError(401, "unauthorized", "A valid Authorization: Bearer token is required.");
  }

  const db = await getDb();
  const started = Date.now();
  const result = await resetDemo(db);
  res.json({
    reset: true,
    clock: await getClock(db),
    cases: result.cases,
    cohort_cases: result.cohort_cases,
    events: result.events,
    took_ms: Date.now() - started,
  });
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

demoResetRouter.post("/api/demo/reset", handle(reset));
demoResetRouter.get("/api/demo/reset", handle(reset));
