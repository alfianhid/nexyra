import type { Role } from "./types";

// What the screen offers each role, in one place. The server decides every read and write;
// these rules only keep the screen from offering what the server would refuse.

// docs/api.md permission table, "Read the program view": the responsible physician and the
// program manager. Same list as PROGRAMME_READ_ROLES in server/programme.ts; the test
// beside this file fails if the two drift apart.
export const PROGRAMME_READ_ROLES: readonly Role[] = ["responsible_physician", "program_manager"];

export function canReadProgramme(role: Role): boolean {
  return PROGRAMME_READ_ROLES.includes(role);
}

// TICKET-08: the not-yet-stitched queue is coordination and programme work. The server
// lets any staff role read it; the physician simply is not sent there from the nav.
export function showsUnstitchedInNav(role: Role): boolean {
  return role !== "responsible_physician";
}
