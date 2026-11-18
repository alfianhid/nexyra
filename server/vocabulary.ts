// The words every pathway shares: who can act and which actions a case view can offer.
// They are not pathway-specific, so they live here rather than in a template; the
// template says which of them apply at which stage.

export type Role =
  | "coordination_staff"
  | "navigator"
  | "responsible_physician"
  | "program_manager";

export const ROLES: readonly Role[] = [
  "coordination_staff",
  "navigator",
  "responsible_physician",
  "program_manager",
];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// `system` writes events the engine produces itself (timers, ingest, extraction). It
// is never accepted over HTTP (server/actor.ts) and never closes a case.
export type EventRole = Role | "system";

export const EVENT_ROLES: readonly EventRole[] = [...ROLES, "system"];

export type Action =
  | "advance_case"
  | "log_outreach"
  | "assign_owner"
  | "answer_consultation"
  | "confirm_closure"
  | "reopen_case"
  | "reject_proposal"
  // TICKET-11
  | "request_consultation"
  // TICKET-08: record that the patient moved to another provider (unowned trigger 3).
  | "record_provider_move";

// The `cases.status` column. A case is open until it reaches the pathway's terminal
// stage; the status word is shared by every pathway, the terminal stage's key is not.
export type CaseStatus = "open" | "closed";

export const CASE_OPEN: CaseStatus = "open";
export const CASE_CLOSED: CaseStatus = "closed";

// The order `available_actions` is sent in.
export const ACTIONS: readonly Action[] = [
  "log_outreach",
  "advance_case",
  "assign_owner",
  "answer_consultation",
  "confirm_closure",
  "reject_proposal",
  "reopen_case",
  // TICKET-11
  "request_consultation",
  // TICKET-08
  "record_provider_move",
];
