import { Router, type NextFunction, type Request, type Response } from "express";
import { roleForRead } from "../actor.js";
import { getDb } from "../db.js";
import { respondAsPatient } from "./ladder.js";
import { getOutreachLadder, getPatientPage } from "./view.js";

// TICKET-10 routes, mounted by server/index.ts before the /api catch-all.
//
// The patient routes take no actor header: the patient has no login, and the token in
// the link is the only key. It maps to one case and allows exactly two answers.

export const outreachRouter = Router();

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
function handle(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

// The staff view of the ladder: steps, tasks, the message as sent and the simulated link.
outreachRouter.get(
  "/api/cases/:case_id/outreach",
  handle(async (req, res) => {
    const db = await getDb();
    await roleForRead(req, db);
    res.json(await getOutreachLadder(db, param(req, "case_id")));
  }),
);

outreachRouter.get(
  "/api/patient/:token",
  handle(async (req, res) => {
    res.json(await getPatientPage(await getDb(), param(req, "token"), req.query.lang));
  }),
);

outreachRouter.post(
  "/api/patient/:token/response",
  handle(async (req, res) => {
    const db = await getDb();
    const body = (req.body ?? {}) as { response?: unknown; language?: unknown };
    const token = param(req, "token");
    const { recorded } = await respondAsPatient(db, {
      token,
      response: body.response,
      language: body.language,
    });
    res.json({ ...(await getPatientPage(db, token, body.language)), recorded });
  }),
);
