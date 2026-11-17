import express, { type Response } from "express";
import { actorMiddleware, roleForRead, type Actor } from "./actor";
import { getCaseDetail, getVerification, isCaseFilter, listCases } from "./caseView";
import { DEMO_START, getClock, setClock } from "./clock";
import { databaseFile, getDb } from "./db";
import { advanceClock, tick } from "./escalation";
import { applyEvent, completeTask, confirmCaseClosure, logOutreach, reopenCase } from "./events";
import { HttpError, sendError } from "./errors";

// Reads and writes both lean on server/engine.ts for the rules. The handlers here parse
// input, call the engine, and return the case view: no permission check lives in a route.

export const app = express();
app.use(express.json());

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
function writeResponse(
  res: Response,
  caseId: string,
  role: Actor["role"],
  recorded: string,
): void {
  res.json({ ...getCaseDetail(getDb(), caseId, role), recorded });
}

app.get("/api/clock", (_req, res) => {
  res.json(getClock(getDb()));
});

// TICKET-06 demo controls. Advance moves the demo clock and then ticks, so every case
// that has gone past its deadline escalates without anyone pressing a case button.
app.post("/api/clock/advance", (req, res, next) => {
  try {
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

    res.json(advanceClock(getDb(), until ? { until } : { days }));
  } catch (error) {
    next(error);
  }
});

// Demo only, and not exposed in the normal UI: it moves the clock, not the data. The
// full reset is `npm run demo:reset`, which reseeds and therefore also clears timers.
app.post("/api/clock/reset", (_req, res, next) => {
  try {
    res.json({ clock: setClock(getDb(), DEMO_START, 0), escalations: 0, cases_advanced: 0 });
  } catch (error) {
    next(error);
  }
});

// Runs the timers without moving the clock: idempotent by construction, and the test
// calls it twice to prove it.
app.post("/api/clock/tick", (_req, res, next) => {
  try {
    const db = getDb();
    const result = tick(db, getClock(db).now);
    res.json({
      clock: getClock(db),
      escalations: result.escalations,
      cases_advanced: 0,
      escalations_per_role: result.per_role,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/cases", (req, res, next) => {
  try {
    const db = getDb();
    const role = roleForRead(req, db);

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

    res.json(listCases(db, role, isCaseFilter(rawFilter) ? rawFilter : undefined, getClock().now));
  } catch (error) {
    next(error);
  }
});

app.get("/api/cases/:case_id/verification", (req, res, next) => {
  try {
    // A present header is still validated; the contract does not require one here.
    const header = req.header("x-nexyra-actor");
    if (header !== undefined) roleForRead(req, getDb());
    res.json(getVerification(getDb(), param(req, "case_id")));
  } catch (error) {
    next(error);
  }
});

app.get("/api/cases/:case_id", (req, res, next) => {
  try {
    const db = getDb();
    const role = roleForRead(req, db);
    res.json(getCaseDetail(db, req.params.case_id, role));
  } catch (error) {
    next(error);
  }
});

// --- writes (phase 5) -------------------------------------------------------
// All four guarded surfaces are tested directly in server/writes.test.ts, so the UI is
// never the only defence.

app.post("/api/cases/:case_id/closure/confirm", actorMiddleware(getDb()), (req, res, next) => {
  try {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as { final_outcome?: unknown };
    const caseId = param(req, "case_id");
    const { recorded } = confirmCaseClosure(getDb(), {
      caseId,
      actor,
      finalOutcome: body.final_outcome,
    });
    writeResponse(res, caseId, actor.role, recorded);
  } catch (error) {
    next(error);
  }
});

app.post("/api/cases/:case_id/reopen", actorMiddleware(getDb()), (req, res, next) => {
  try {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as { owner_actor_id?: unknown };
    const caseId = param(req, "case_id");
    const { recorded } = reopenCase(getDb(), {
      caseId,
      actor,
      ownerActorId: typeof body.owner_actor_id === "string" ? body.owner_actor_id : undefined,
    });
    writeResponse(res, caseId, actor.role, recorded);
  } catch (error) {
    next(error);
  }
});

app.post("/api/cases/:case_id/events", actorMiddleware(getDb()), (req, res, next) => {
  try {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as { type?: unknown; payload?: unknown };

    if (typeof body.type !== "string" || body.type.length === 0) {
      throw new HttpError(400, "validation_failed", "An event type is required.");
    }
    if (body.payload !== undefined && (typeof body.payload !== "object" || body.payload === null)) {
      throw new HttpError(400, "validation_failed", "payload must be an object.");
    }

    const { recorded } = applyEvent(getDb(), {
      caseId: param(req, "case_id"),
      type: body.type,
      actor,
      payload: (body.payload ?? {}) as Record<string, unknown>,
    });
    writeResponse(res, param(req, "case_id"), actor.role, recorded);
  } catch (error) {
    next(error);
  }
});

app.post("/api/cases/:case_id/outreach", actorMiddleware(getDb()), (req, res, next) => {
  try {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as {
      outcome?: unknown;
      channel?: unknown;
      delay_reason?: unknown;
      minutes?: unknown;
      note?: unknown;
    };
    const caseId = param(req, "case_id");

    const { recorded } = logOutreach(getDb(), {
      caseId,
      actor,
      outcome: body.outcome,
      channel: body.channel,
      delayReason: body.delay_reason,
      minutes: body.minutes,
      note: body.note,
    });
    writeResponse(res, caseId, actor.role, recorded);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:task_id/complete", actorMiddleware(getDb()), (req, res, next) => {
  try {
    const actor = actorOf(res);
    const body = (req.body ?? {}) as {
      outcome?: unknown;
      delay_reason?: unknown;
      note?: unknown;
    };

    const { recorded, caseId } = completeTask(getDb(), {
      taskId: param(req, "task_id"),
      actor,
      outcome: body.outcome,
      delayReason: body.delay_reason,
      note: body.note,
    });
    writeResponse(res, caseId, actor.role, recorded);
  } catch (error) {
    next(error);
  }
});

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
    console.log(`database: ${databaseFile()}`);
  });
}
