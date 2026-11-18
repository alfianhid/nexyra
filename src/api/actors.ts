import type { Role as ShellRole } from "../components/Shell";
import type { Actor } from "./types";

// The three actors the role picker may become. The ids are the ones server/seed.ts
// writes into the actors table; a header naming an actor that does not exist is
// refused with 403 role_not_permitted.
export const actors: Record<ShellRole, Actor> = {
  coordinator: { actor_id: "act_001", role: "coordination_staff", display_name: "R. Haddad" },
  physician: { actor_id: "act_003", role: "responsible_physician", display_name: "Dr. Fulan" },
  program_manager: { actor_id: "act_004", role: "program_manager", display_name: "A. Al Suwaidi" },
};

export function actorFor(role: ShellRole): Actor {
  return actors[role];
}

// TICKET-08 / TICKET-11: the human actors in server/seed.ts, with the provider each works
// at. The API has no actor list (ownership gaps and consultations name actors by id
// only), so the owner picker and the consultation addressee read this copy. The server
// still validates every id it receives against its own actors table.
export type RosterActor = Actor & { provider_id: string | null };

export const roster: RosterActor[] = [
  { ...actors.coordinator, provider_id: "prov_clinic_a" },
  { actor_id: "act_002", role: "navigator", display_name: "Nur H.", provider_id: "prov_clinic_b" },
  { ...actors.physician, provider_id: "prov_clinic_b" },
  { ...actors.program_manager, provider_id: null },
  { actor_id: "act_005", role: "coordination_staff", display_name: "S. Al Ali", provider_id: "prov_clinic_b" },
  { actor_id: "act_006", role: "responsible_physician", display_name: "Dr. Fulana", provider_id: "prov_hospital_b" },
];

export function rosterActor(actorId: string | null | undefined): RosterActor | undefined {
  return actorId ? roster.find((a) => a.actor_id === actorId) : undefined;
}

// A name for an id the payload carries; the id itself when the roster does not know it.
export function actorName(actorId: string | null | undefined): string {
  if (!actorId) return "nobody";
  return rosterActor(actorId)?.display_name ?? actorId;
}
