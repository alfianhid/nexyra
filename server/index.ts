import express from "express";
import { roleForRead } from "./actor";
import { getCaseDetail, isCaseFilter, listCases } from "./caseView";
import { getClock } from "./clock";
import { databaseFile, getDb } from "./db";
import { sendError } from "./errors";

// Phase 4: reads are real queries, and the case view's `available_actions` comes from
// server/engine.ts. Writes arrive in phase 5 and reuse the same engine and guards.

export const app = express();
app.use(express.json());

app.get("/api/clock", (_req, res) => {
  res.json(getClock());
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

app.get("/api/cases/:case_id", (req, res, next) => {
  try {
    const db = getDb();
    const role = roleForRead(req, db);
    res.json(getCaseDetail(db, req.params.case_id, role));
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
