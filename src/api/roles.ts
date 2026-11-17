import type { Role as ShellRole } from "../components/Shell";
import type { Role } from "./types";

// The role picker in src/components/Shell.tsx is the prototype's stand-in for the
// X-Nexyra-Actor header described in docs/api.md. Phase 6 replaces this with the
// full actor (id, role, display_name); until then the map is the only place the two
// vocabularies meet.
export const roleFor: Record<ShellRole, Role> = {
  coordinator: "coordination_staff",
  physician: "responsible_physician",
  program_manager: "program_manager",
};
