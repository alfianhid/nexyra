import { request } from "./http";
import type { Actor, CaseDetailResponse, MutationResult, Verification } from "./types";

// The case page's "Record next step" and the closure screen's decisions (docs/api.md).
// Kept beside NexyraApi, like src/api/ownership.ts, because the fixtures in src/data.ts
// have no template events.

type Written = CaseDetailResponse & MutationResult;

// One event from the case's `next_steps`, through the generic events endpoint. The server
// checks it against the template; the client never sends a stage.
export function recordStep(
  caseId: string,
  actor: Actor,
  type: string,
  payload: { summary?: string; outcome?: string; owner_actor_id?: string },
): Promise<Written> {
  return request<Written>(`/cases/${encodeURIComponent(caseId)}/events`, {
    method: "POST",
    actor,
    body: { type, payload },
  });
}

// POST /verification: read the case's latest report (a cached reading needs no model).
export function readLatestReport(caseId: string, actor: Actor): Promise<Verification> {
  return request<Verification>(`/cases/${encodeURIComponent(caseId)}/verification`, {
    method: "POST",
    actor,
    body: {},
  });
}

// POST /reopen. At the closure review the engine records the template's
// incomplete-examination event with the reading's reasons.
export function reopenWithReason(caseId: string, actor: Actor, reason?: string): Promise<Written> {
  return request<Written>(`/cases/${encodeURIComponent(caseId)}/reopen`, {
    method: "POST",
    actor,
    body: reason ? { reason } : {},
  });
}

// POST /proposal/reject: the physician says the AI proposal does not hold.
export function rejectProposal(caseId: string, actor: Actor, reason: string): Promise<Written> {
  return request<Written>(`/cases/${encodeURIComponent(caseId)}/proposal/reject`, {
    method: "POST",
    actor,
    body: { reason },
  });
}
