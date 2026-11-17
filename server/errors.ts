import type { Response } from "express";

// docs/api.md: every failure returns { error: { code, message } }, and `details`
// appears only where the contract shows it.

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, boolean>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Record<string, boolean>;
  };
};

export function errorBody(error: HttpError): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

// Unknown failures still use the envelope, with a stable code and a generic message,
// so a client never has to parse an HTML stack trace.
export function sendError(res: Response, error: unknown): void {
  if (error instanceof HttpError) {
    res.status(error.status).json(errorBody(error));
    return;
  }
  console.error(error);
  res.status(500).json({
    error: { code: "internal_error", message: "The server could not complete the request." },
  });
}
