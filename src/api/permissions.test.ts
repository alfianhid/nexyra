import { describe, expect, it } from "vitest";
import { PROGRAMME_READ_ROLES as SERVER_PROGRAMME_READ_ROLES } from "../../server/programme";
import { ROLES } from "../../server/vocabulary";
import { canReadProgramme, PROGRAMME_READ_ROLES } from "./permissions";

describe("canReadProgramme", () => {
  it("matches the server's programme read rule for every role", () => {
    for (const role of ROLES) {
      expect(canReadProgramme(role), role).toBe(SERVER_PROGRAMME_READ_ROLES.includes(role));
    }
    expect([...PROGRAMME_READ_ROLES].sort()).toEqual([...SERVER_PROGRAMME_READ_ROLES].sort());
  });

  it("keeps coordination staff out of the programme view", () => {
    expect(canReadProgramme("coordination_staff")).toBe(false);
    expect(canReadProgramme("responsible_physician")).toBe(true);
    expect(canReadProgramme("program_manager")).toBe(true);
  });
});
