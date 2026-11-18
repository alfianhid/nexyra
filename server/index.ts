import express, { type NextFunction, type Request, type Response } from "express";
import { actorMiddleware, roleForRead, type Actor } from "./actor.js";
import {
  getCaseDetail,
  getVerification,
  isCaseFilter,
  listCases,
  listUnowned,
  listUnstitched,
} from "./caseView.js";
import { DEMO_START, getClock, setClock } from "./clock.js";
import { databaseLabel, getDb } from "./db.js";
import { advanceClock, tick } from "./escalation.js";
import {
  answerConsultation,
  applyEvent,
  completeTask,
  confirmCaseClosure,
  logOutreach,
  reopenCase,
  requestConsultation,
} from "./events.js";
import { HttpError, sendError } from "./errors.js";
import { programmeSummary } from "./programme.js";
import { ingestFhir } from "./ingest.js";
import { ingestHl7Text } from "./ingest/hl7v2/ingest.js";
import { runCaseVerification } from "./verify/caseVerification.js";
// TICKET-10
import { afterOutreachLogged, evaluateCase } from "./outreach/ladder.js";
import { outreachRouter } from "./outreach/routes.js";
// TICKET-21
import { demoResetRouter } from "./demoReset.js";

// Reads and writes both lean on server/engine.ts for the rules. The handlers here parse
// input, call the engine, and return the case view: no permission check lives in a route.
//
// The same `app` runs locally (`npm run server`) and as one Vercel function (api/index.ts).

export const app = express();
app.use(express.json());

// Express 4 does not catch a rejected promise, so every async handler goes through this.
type AsyncHandler = (req: Request, res: Response) => Promise<void>;
function handle(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function actorOf(res: Response): Actor {
  const actor = res.locals.actor as Actor | undefined;
  if (!actor) throw new HttpError(403, "role_not_permitted", "An actor is required.");
  return actor;
}

// Express 5 types a route param as string | string[]; these paths take one value.
function param(req: express.Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

// ---- TICKET-17: `?cohort=include` shows the synthetic cohort (hidden by default) ------
function cohortParam(req: Request): boolean {
  const raw = req.query.cohort;
  if (raw === undefined || raw === "hide") return false;
  if (raw === "include") return true;
  throw new HttpError(400, "validation_failed", 'cohort must be "include" or "hide".');
}
// ---- end TICKET-17 ---------------------------------------------------------------------

// The write envelope: the updated case view plus the id of the event that produced it.
async function writeResponse(
  res: Response,
  caseId: string,
  role: Actor["role"],
  recorded: string,
): Promise<void> {
  res.json({ ...(await getCaseDetail(await getDb(), caseId, role)), recorded });
}

app.get(
  "/api/clock",
  handle(async (_req, res) => {
    res.json(await getClock(await getDb()));
  }),
);

// TICKET-06 demo controls. Advance moves the demo clock and then ticks, so every case
// that has gone past its deadline escalates without anyone pressing a case button.
app.post(
  "/api/clock/advance",
  handle(async (req, res) => {
    const body = (req.body ?? {}) as { days?: unknown; until?: unknown };

    const until = body.until === "next_deadline" ? "next_deadline" : undefined;
    const days = typeof body.days === "number" && Number.isFinite(body.days) ? body.days : undefined;

    if (!until && days === undefined) {
      throw new HttpError(
        400,
        "validation_failed",
        'Send { "days": 1 } or { "until": "next_deadline" }.',
      );
    }
    if (days !== undefined && (days < 1 || days > 365)) {
      throw new HttpError(400, "validation_failed", "days must be between 1 and 365.");
    }

    res.json(await advanceClock(await getDb(), until ? { until } : { days }));
  }),
);

// Demo only, and not exposed in the normal UI: it moves the clock, not the data. The
// full reset is `npm run demo:reset`, which reseeds and therefore also clears timers.
app.post(
  "/api/clock/reset",
  handle(async (_req, res) => {
    res.json({
      clock: await setClock(await getDb(), DEMO_START, 0),
      escalations: 0,
      cases_advanced: 0,
    });
  }),
);

// Runs the timers without moving the clock: idempotent by construction, and the test
// calls it twice to prove it.
app.post(
  "/api/clock/tick",
  handle(async (_req, res) => {
    const db = await getDb();
    const result = await tick(db, (await getClock(db)).now);
    res.json({
      clock: await getClock(db),
      escalations: result.escalations,
      cases_advanced: 0,
      escalations_per_role: result.per_role,
      unowned_triggered: result.unowned_triggered ?? 0,
      // TICKET-10
      ...(result.outreach ? { outreach: result.outreach } : {}),
    });
  }),
);

app.get(
  "/api/cases",
  handle(async (req, res) => {
    const db = await getDb();
    const role = await roleForRead(req, db);

    const rawFilter = req.query.filter;
    if (rawFilter !== undefined && !isCaseFilter(rawFilter)) {
      res.status(400).json({
        error: {
          code: "validation_failed",
          message: 'filter must be one of "late", "unowned", "awaiting_closure_confirmation".',
        },
      });
      return;
    }

    res.json(
      await listCases(
        db,
        role,
        isCaseFilter(rawFilter) ? rawFilter : undefined,
        (await getClock(db)).now,
        { includeCohort: cohortParam(req) }, // TICKET-17
      ),
    );
  }),
);

app.get(
  "/api/cases/:case_id/verification",
  handle(async (req, res) => {
    const db = await getDb();
    // A present header is still validated; the contract does not require one here.
    const header = req.header("x-nexyra-actor");
    if (header !== undefined) await roleForRead(req, db);
    res.json(await getVerification(db, param(req, "case_id")));
  }),
);

app.get(
  "/api/cases/:case_id",
  handle(async (req, res) => {
    const db = await getDb();
    const role = await roleForRead(req, db);
    res.json(await getCaseDetail(db, param(req, "case_id"), role));
  }),
);

// --- program view (TICKET-16) -----------------------------------------------
// One read for the whole screen, computed from the event trail at the demo clock's now.
// The role is resolved the same way as every other read; the permission check lives in
// server/programme.ts.

app.get(
  "/api/program/summary",
  handle(async (req, res) => {
    const db = await getDb();
    const role = await roleForRead(req, db);
    res.json(await programmeSummary(db, role));
  }),
);

// --- writes (phase 5) -------------------------------------------------------
// All four guarded surfaces are tested directly in server/writes.test.ts, so the UI is
// never the only defence.

app.post(
  "/api/cases/:case_id/closure/confirm",
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as { final_outcome?: unknown };
    const caseId = param(req, "case_id");
    const { recorded } = await confirmCaseClosure(await getDb(), {
      caseId,
      actor,
      finalOutcome: body.final_outcome,
    });
    await writeResponse(res, caseId, actor.role, recorded);
  }),
);

app.post(
  "/api/cases/:case_id/reopen",
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as { owner_actor_id?: unknown };
    const caseId = param(req, "case_id");
    const { recorded } = await reopenCase(await getDb(), {
      caseId,
      actor,
      ownerActorId: typeof body.owner_actor_id === "string" ? body.owner_actor_id : undefined,
    });
    await writeResponse(res, caseId, actor.role, recorded);
  }),
);

// TICKET-13: read the case report (or return its cached reading). The handler only
// records the reading; it never moves the case, so an AI result cannot close one.
app.post(
  "/api/cases/:case_id/verification",
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as { document_id?: unknown };
    if (body.document_id !== undefined && typeof body.document_id !== "string") {
      throw new HttpError(400, "validation_failed", "document_id must be a string.");
    }
    res.json(
      await runCaseVerification(await getDb(), param(req, "case_id"), {
        actor,
        ...(typeof body.document_id === "string" ? { documentId: body.document_id } : {}),
      }),
    );
  }),
);

app.post(
  "/api/cases/:case_id/events",
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as { type?: unknown; payload?: unknown };

    if (typeof body.type !== "string" || body.type.length === 0) {
      throw new HttpError(400, "validation_failed", "An event type is required.");
    }
    if (body.payload !== undefined && (typeof body.payload !== "object" || body.payload === null)) {
      throw new HttpError(400, "validation_failed", "payload must be an object.");
    }

    const { recorded } = await applyEvent(await getDb(), {
      caseId: param(req, "case_id"),
      type: body.type,
      actor,
      payload: (body.payload ?? {}) as Record<string, unknown>,
    });
    // TICKET-10: a case that leaves the ladder's stage stops its open ladder tasks now.
    await evaluateCase(await getDb(), param(req, "case_id"), (await getClock(await getDb())).now, {
      stopOnly: true,
    });
    await writeResponse(res, param(req, "case_id"), actor.role, recorded);
  }),
);

app.post(
  "/api/cases/:case_id/outreach",
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as {
      outcome?: unknown;
      channel?: unknown;
      delay_reason?: unknown;
      minutes?: unknown;
      note?: unknown;
      connected?: unknown;
    };
    const caseId = param(req, "case_id");

    const { recorded } = await logOutreach(await getDb(), {
      caseId,
      actor,
      outcome: body.outcome,
      channel: body.channel,
      delayReason: body.delay_reason,
      minutes: body.minutes,
      note: body.note,
      connected: body.connected,
    });
    // TICKET-10: the caller's ladder task is done, and a barrier escalates at once.
    await afterOutreachLogged(await getDb(), { caseId, actor, eventId: recorded });
    await writeResponse(res, caseId, actor.role, recorded);
  }),
);

app.post(
  "/api/tasks/:task_id/complete",
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as {
      outcome?: unknown;
      delay_reason?: unknown;
      note?: unknown;
    };

    const { recorded, caseId } = await completeTask(await getDb(), {
      taskId: param(req, "task_id"),
      actor,
      outcome: body.outcome,
      delayReason: body.delay_reason,
      note: body.note,
    });
    // TICKET-10: a delay reason recorded on a task is a barrier for the outreach ladder.
    await afterOutreachLogged(await getDb(), {
      caseId,
      actor,
      eventId: recorded,
      completeOwnTasks: false,
    });
    await writeResponse(res, caseId, actor.role, recorded);
  }),
);

// --- TICKET-08 / TICKET-11 --------------------------------------------------------
// The unowned list, the unstitched queue, FHIR ingest and consultations. The rules are
// the engine's and the template's; these handlers parse and call.

app.get(
  "/api/unowned",
  handle(async (req, res) => {
    const db = await getDb();
    if (req.header("x-nexyra-actor") !== undefined) await roleForRead(req, db);
    res.json(await listUnowned(db, (await getClock(db)).now, { includeCohort: cohortParam(req) })); // TICKET-17
  }),
);

app.get(
  "/api/providers",
  handle(async (_req, res) => {
    const db = await getDb();
    res.json({
      providers: await db
        .prepare("SELECT id AS provider_id, name, kind FROM providers ORDER BY id")
        .all(),
    });
  }),
);

app.get(
  "/api/ingest/unstitched",
  handle(async (req, res) => {
    const db = await getDb();
    if (req.header("x-nexyra-actor") !== undefined) await roleForRead(req, db);
    const raw = req.query.status;
    const status = raw === undefined ? "queued" : raw;
    if (status !== "queued" && status !== "stitched" && status !== "all") {
      throw new HttpError(400, "validation_failed", 'status must be "queued", "stitched" or "all".');
    }
    res.json(await listUnstitched(db, status));
  }),
);

app.post(
  "/api/ingest/fhir",
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    if (req.body === undefined || req.body === null || typeof req.body !== "object") {
      throw new HttpError(400, "validation_failed", "Send one FHIR resource or a Bundle.");
    }
    res.json(await ingestFhir(await getDb(), req.body, actor));
  }),
);

// --- TICKET-25: HL7 v2 ingest (REF and ORU) -------------------------------------------
// text/plain body, or JSON { "message": "MSH|..." }. One message answers the result
// object; several (each starting "MSH|") answer { results, counts }. See server/ingest/hl7v2.
app.post(
  "/api/ingest/hl7v2",
  express.text({ type: ["text/*", "application/hl7-v2", "x-application/hl7-v2+er7"], limit: "1mb" }),
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    const body: unknown = req.body;
    const text =
      typeof body === "string"
        ? body
        : typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string"
          ? (body as { message: string }).message
          : null;
    if (text === null) {
      throw new HttpError(400, "validation_failed", 'Send the HL7 v2 message as a text/plain body or as JSON { "message": "MSH|..." }.');
    }
    const results = await ingestHl7Text(await getDb(), text, actor);
    if (results.length === 1) {
      res.json(results[0]);
      return;
    }
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    res.json({ results, counts });
  }),
);
// --- end TICKET-25 ---------------------------------------------------------------------

app.post(
  "/api/cases/:case_id/consultations",
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as {
      question?: unknown;
      to_provider_id?: unknown;
      to_actor_id?: unknown;
    };
    const caseId = param(req, "case_id");
    const { recorded, consultationId } = await requestConsultation(await getDb(), {
      caseId,
      actor,
      question: body.question,
      toProviderId: body.to_provider_id,
      toActorId: body.to_actor_id,
    });
    res.json({
      ...(await getCaseDetail(await getDb(), caseId, actor.role)),
      recorded,
      consultation_id: consultationId,
    });
  }),
);

app.post(
  "/api/consultations/:consultation_id/answer",
  actorMiddleware(),
  handle(async (req, res) => {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as {
      outcome?: unknown;
      note?: unknown;
      owner_actor_id?: unknown;
      redirect_to_provider_id?: unknown;
      referral?: unknown;
    };
    const { recorded, caseId } = await answerConsultation(await getDb(), {
      consultationId: param(req, "consultation_id"),
      actor,
      outcome: body.outcome,
      note: body.note,
      ownerActorId: body.owner_actor_id,
      redirectToProviderId: body.redirect_to_provider_id,
      referral: body.referral,
    });
    await writeResponse(res, caseId, actor.role, recorded);
  }),
);
// ---- TICKET-10: outreach ladder and patient page -------------------------------------
app.use(outreachRouter);
// ---- end TICKET-10 --------------------------------------------------------------------
// ---- TICKET-21: daily reset of the hosted demo (404 unless a secret is set) ----------
app.use(demoResetRouter);
// ---- end TICKET-21 --------------------------------------------------------------------

// Anything under /api that matched no route still uses the error envelope.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "No such endpoint." } });
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    sendError(res, error);
  },
);

const PORT = Number(process.env.PORT ?? 3001);

if (process.argv[1]?.replace(/\\/g, "/").endsWith("server/index.ts")) {
  app.listen(PORT, () => {
    console.log(`nexyra api on http://localhost:${PORT}`);
    console.log(`database: ${databaseLabel()}`);
  });
}
