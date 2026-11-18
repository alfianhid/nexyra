import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getDb, type Db } from "./db.js";
import { isRole, type Role } from "./engine.js";
import { HttpError } from "./errors.js";

// docs/api.md "Actor and trust model": identity travels in one JSON header, is
// validated against the actors table, and never falls back to a default actor.

export type Actor = {
  actor_id: string;
  role: Role;
  display_name: string;
};

type ActorRow = {
  id: string;
  role: string;
  display_name: string;
};

const HEADER = "x-nexyra-actor";

function reject(message: string): never {
  throw new HttpError(403, "role_not_permitted", message);
}

export async function authenticateActor(
  headerValue: string | undefined,
  db: Db,
): Promise<Actor> {
  if (!headerValue) reject("An X-Nexyra-Actor header is required.");

  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(headerValue);
  } catch {
    reject("X-Nexyra-Actor must be a JSON object.");
  }

  if (typeof parsed !== "object" || parsed === null) reject("X-Nexyra-Actor must be a JSON object.");

  const candidate = parsed as Record<string, unknown>;
  const actorId = candidate.actor_id;
  const role = candidate.role;

  if (typeof actorId !== "string" || actorId.length === 0) {
    reject("X-Nexyra-Actor must name an actor_id.");
  }
  if (!isRole(role)) {
    // Includes role "system", which exists only for events the engine writes itself.
    reject(`The role "${String(role)}" may not act over HTTP.`);
  }

  const row = await db
    .prepare("SELECT id, role, display_name FROM actors WHERE id = ?")
    .get<ActorRow>(actorId);

  if (!row) reject(`No actor carries the id "${actorId}".`);

  // The stored role wins; a header that disagrees is rejected rather than trusted.
  if (row.role !== role) {
    reject("The header role does not match the actor's stored role.");
  }
  if (!isRole(row.role)) reject(`The role "${row.role}" may not act over HTTP.`);

  return { actor_id: row.id, role: row.role, display_name: row.display_name };
}

// For mutating routes (phase 5 onwards): a request without a valid actor never reaches
// the handler. The connection is resolved per request, because on a serverless host
// it is opened lazily by the first request rather than at import time.
export function actorMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.actor = await authenticateActor(req.header(HEADER), await getDb());
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Reads are not guarded yet (the frontend only switches to the header in phase 6), so a
// read resolves its role from the header when present, otherwise from `?role=`.
// A present-but-invalid header is always refused, never downgraded to the query.
export async function roleForRead(req: Request, db: Db): Promise<Role> {
  const headerValue = req.header(HEADER);
  if (headerValue !== undefined) return (await authenticateActor(headerValue, db)).role;

  const role = req.query.role;
  if (!isRole(role)) {
    throw new HttpError(
      400,
      "validation_failed",
      "A role query parameter (or an X-Nexyra-Actor header) is required.",
    );
  }
  return role;
}
