import { roster, type RosterActor } from "./api/actors";
import type {
  CaseDetailResponse,
  Consultation,
  ConsultationAnswer,
  ConsultationOutcome,
} from "./api/types";

type RosterActorLike = RosterActor;

// Pure helpers for the TICKET-08 / TICKET-11 screens. Nothing here computes a deadline,
// a stage or an hour count: those come from the server. These only pick a default, shape
// a request body, or reprint a server timestamp.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-16T15:40:00+07:00" -> "16 Nov 15:40". A reprint of the wall-clock time the
// server wrote, in the stamp's own offset (the demo clock's UTC+7); no timezone math.
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[4]}:${m[5]}`;
}

export function openConsultation(consultations: Consultation[]): Consultation | undefined {
  return consultations.find((k) => k.status === "open");
}

// The owner a picker starts on: whoever holds the open assign-owner task (the server
// gives it to coordination staff at the case's current provider), else nobody chosen.
export function defaultOwnerId(detail: Pick<CaseDetailResponse, "tasks">): string | undefined {
  const task = detail.tasks.find((t) => t.kind === "assign_owner" && t.status === "open");
  return task?.owner?.actor_id ?? undefined;
}

// People who may hold a case. The program manager reads the programme, not cases.
export function ownerCandidates(list: RosterActorLike[] = roster): RosterActorLike[] {
  return list.filter((a) => a.role !== "program_manager");
}

export function physiciansAt(providerId: string | undefined, list: RosterActorLike[] = roster): RosterActorLike[] {
  return list.filter((a) => a.role === "responsible_physician" && a.provider_id === providerId);
}

// `patient_moved_provider` has no entry in available_actions (the engine's action list
// stops at the eight in server/vocabulary.ts). The template gives the event the same
// roles as `log_outreach` (coordination staff, navigator) on an open case, so that
// server-sent action is the gate; the server still rejects any other caller.
export function canRecordMove(detail: Pick<CaseDetailResponse, "case" | "available_actions">): boolean {
  return detail.case.status === "open" && detail.available_actions.includes("log_outreach");
}

export const outcomeWords: Record<ConsultationOutcome, string> = {
  accepted: "Referral accepted",
  redirected: "Redirected to another provider",
  more_data_requested: "More data requested",
};

// The body of POST /api/consultations/{id}/answer. Only the fields the outcome uses are
// sent: an owner only on an unowned case, a provider only on a redirect.
export function answerBody(
  outcome: ConsultationOutcome,
  options: { note?: string; ownerActorId?: string; redirectProviderId?: string; unowned: boolean },
): ConsultationAnswer {
  const body: ConsultationAnswer = { outcome };
  const note = options.note?.trim();
  if (note) body.note = note;
  if (options.unowned && options.ownerActorId) body.owner_actor_id = options.ownerActorId;
  if (outcome === "redirected" && options.redirectProviderId) {
    body.redirect_to_provider_id = options.redirectProviderId;
  }
  return body;
}

// What the answer form must still be told before it can send.
export function answerProblem(
  outcome: ConsultationOutcome,
  options: { ownerActorId?: string; redirectProviderId?: string; unowned: boolean },
): string | null {
  if (outcome === "redirected" && !options.redirectProviderId) {
    return "Pick the provider the referral is redirected to.";
  }
  if (options.unowned && !options.ownerActorId) {
    return "This case has no owner. Pick who takes it.";
  }
  return null;
}
