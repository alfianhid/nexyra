import { actorFor } from "./actors";
import { ApiError, type NexyraApi } from "./client";
import type {
  Actor,
  AdvanceResult,
  CaseDetailResponse,
  CaseListResponse,
  CaseFilter,
  Clock,
  MutationResult,
  ProgramSummary,
  Role,
  Verification,
} from "./types";

// HTTP implementation of NexyraApi. Everything the server answers with is the shape in
// docs/api.md; nothing here reshapes, derives or caches.

const BASE = "/api";

type ErrorEnvelope = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

type RequestOptions = {
  method?: "GET" | "POST";
  // The caller's actor. Writes must pass it; reads may pass only a role.
  actor?: Actor;
  role?: Role;
  body?: unknown;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const actor = options.actor ?? (options.role ? actorForContractRole(options.role) : undefined);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (actor) headers["X-Nexyra-Actor"] = JSON.stringify(actor);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError("network_error", "The case engine is not reachable. Is `npm run server` running?");
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = (payload ?? {}) as ErrorEnvelope;
    throw new ApiError(
      envelope.error?.code ?? "request_failed",
      envelope.error?.message ?? `The request failed (${response.status}).`,
      envelope.error?.details,
    );
  }

  return payload as T;
}

// Reads carry a role in the query as well as the header, so a copied URL says who was
// asking. The header is the one the server trusts; see docs/api.md.
function queryRole(role: Role): string {
  return `?role=${encodeURIComponent(role)}`;
}

export const httpApi: NexyraApi = {
  getClock(): Promise<Clock> {
    return request<Clock>("/clock");
  },

  advanceClock(days: number | "next_deadline"): Promise<AdvanceResult> {
    return request<AdvanceResult>("/clock/advance", {
      method: "POST",
      body: days === "next_deadline" ? { until: "next_deadline" } : { days },
    });
  },

  listCases(role: Role, filter?: CaseFilter): Promise<CaseListResponse> {
    const suffix = filter ? `&filter=${encodeURIComponent(filter)}` : "";
    return request<CaseListResponse>(`/cases${queryRole(role)}${suffix}`, { role });
  },

  getCase(caseId: string, role: Role): Promise<CaseDetailResponse> {
    return request<CaseDetailResponse>(`/cases/${encodeURIComponent(caseId)}${queryRole(role)}`, {
      role,
    });
  },

  getVerification(caseId: string, role: Role): Promise<Verification> {
    return request<Verification>(`/cases/${encodeURIComponent(caseId)}/verification`, { role });
  },

  getProgramme(role: Role): Promise<ProgramSummary> {
    return request<ProgramSummary>(`/program/summary${queryRole(role)}`, { role });
  },

  confirmClosure(caseId: string, actor: Actor, finalOutcome?: string): Promise<CaseDetailResponse> {
    return request<CaseDetailResponse>(`/cases/${encodeURIComponent(caseId)}/closure/confirm`, {
      method: "POST",
      actor,
      body: finalOutcome ? { final_outcome: finalOutcome } : {},
    });
  },

  reopenCase(caseId: string, actor: Actor): Promise<CaseDetailResponse> {
    return request<CaseDetailResponse>(`/cases/${encodeURIComponent(caseId)}/reopen`, {
      method: "POST",
      actor,
      body: {},
    });
  },

  logOutreach(caseId: string, input, actor: Actor): Promise<MutationResult> {
    return request<MutationResult>(`/cases/${encodeURIComponent(caseId)}/outreach`, {
      method: "POST",
      actor,
      body: input,
    });
  },
};

// Maps a contract role to the actor that carries it. Only the three pickable roles have
// an actor; `navigator` has no screen and no header.
function actorForContractRole(role: Role): Actor | undefined {
  switch (role) {
    case "coordination_staff":
      return actorFor("coordinator");
    case "responsible_physician":
      return actorFor("physician");
    case "program_manager":
      return actorFor("program_manager");
    default:
      return undefined;
  }
}
