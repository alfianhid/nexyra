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
