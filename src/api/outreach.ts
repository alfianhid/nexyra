import { request } from "./http";
import type { Actor, MutationResult, OutreachLadder, PatientPage, Role } from "./types";

// The generic event write (docs/api.md, POST /api/cases/{id}/events), used by the outreach
// screen to record that the patient has now been told the result.
export function recordPatientNotified(caseId: string, actor: Actor, channel: string): Promise<MutationResult> {
  return request<MutationResult>(`/cases/${encodeURIComponent(caseId)}/events`, {
    method: "POST",
    actor,
    body: { type: "patient_notified", payload: { channel } },
  });
}

// TICKET-10 calls. Kept beside NexyraApi rather than inside it: the patient page has no
// actor and no fixture twin, and the ladder view is read by one screen only.

export function getOutreachLadder(caseId: string, role: Role): Promise<OutreachLadder> {
  return request<OutreachLadder>(
    `/cases/${encodeURIComponent(caseId)}/outreach?role=${encodeURIComponent(role)}`,
    { role },
  );
}

export function getPatientPage(token: string, language?: string): Promise<PatientPage> {
  const query = language ? `?lang=${encodeURIComponent(language)}` : "";
  return request<PatientPage>(`/patient/${encodeURIComponent(token)}${query}`);
}

export function respondAsPatient(
  token: string,
  response: "understood" | "request_call",
  language: string,
): Promise<PatientPage> {
  return request<PatientPage>(`/patient/${encodeURIComponent(token)}/response`, {
    method: "POST",
    body: { response, language },
  });
}
