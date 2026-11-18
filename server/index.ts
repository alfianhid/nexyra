import express, { type NextFunction, type Request, type Response } from "express";
import { actorMiddleware, roleForRead, type Actor } from "./actor.js";
import { getCaseDetail, getVerification, isCaseFilter, listCases } from "./caseView.js";
import { DEMO_START, getClock, setClock } from "./clock.js";
import { databaseLabel, getDb } from "./db.js";
import { advanceClock, tick } from "./escalation.js";
import { applyEvent, completeTask, confirmCaseClosure, logOutreach, reopenCase } from "./events.js";
import { HttpError, sendError } from "./errors.js";
import { runCaseVerification } from "./verify/caseVerification.js";

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
    });
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
    await writeResponse(res, caseId, actor.role, recorded);
  }),
);

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
