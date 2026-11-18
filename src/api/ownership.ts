import { request } from "./http";
import type {
  Actor,
  CaseDetailResponse,
  ConsultationAnswer,
  MutationResult,
  ProviderOption,
  Role,
  UnownedResponse,
  UnstitchedResponse,
} from "./types";

// TICKET-08 / TICKET-11 calls (docs/api.md). Kept beside NexyraApi, like src/api/outreach.ts,
// because the fixtures in src/data.ts have no providers, referrals or consultations.

type Written = CaseDetailResponse & MutationResult;

export function getUnowned(role: Role): Promise<UnownedResponse> {
  return request<UnownedResponse>("/unowned", { role });
}

export function getProviders(): Promise<{ providers: ProviderOption[] }> {
  return request<{ providers: ProviderOption[] }>("/providers");
}

export function getUnstitched(role: Role, status: "queued" | "stitched" | "all"): Promise<UnstitchedResponse> {
  return request<UnstitchedResponse>(`/ingest/unstitched?status=${encodeURIComponent(status)}`, { role });
}

// `owner_assigned` through the generic events endpoint: the payload names the new owner,
// and the server records who handed over and who received.
export function assignOwner(caseId: string, actor: Actor, ownerActorId: string): Promise<Written> {
  return request<Written>(`/cases/${encodeURIComponent(caseId)}/events`, {
    method: "POST",
    actor,
    body: { type: "owner_assigned", payload: { owner_actor_id: ownerActorId } },
  });
}

// Unowned trigger 3: the patient moved provider while the case is open.
export function recordPatientMoved(caseId: string, actor: Actor, providerId: string): Promise<Written> {
  return request<Written>(`/cases/${encodeURIComponent(caseId)}/events`, {
    method: "POST",
    actor,
    body: { type: "patient_moved_provider", payload: { provider_id: providerId } },
  });
}

export function requestConsultation(
  caseId: string,
  actor: Actor,
  input: { question: string; to_provider_id?: string; to_actor_id?: string },
): Promise<Written & { consultation_id: string }> {
  return request<Written & { consultation_id: string }>(
    `/cases/${encodeURIComponent(caseId)}/consultations`,
    { method: "POST", actor, body: input },
  );
}

export function answerConsultation(
  consultationId: string,
  actor: Actor,
  answer: ConsultationAnswer,
): Promise<Written> {
  return request<Written>(`/consultations/${encodeURIComponent(consultationId)}/answer`, {
    method: "POST",
    actor,
    body: answer,
  });
}
