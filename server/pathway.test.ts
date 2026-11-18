import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  FIT_COLONOSCOPY,
  PathwayTemplateError,
  loadPathwayFile,
  validatePathway,
} from "./pathways/index.js";
import { deadlineRows } from "./pathways/deadlines.js";

// TICKET-04 done-when: the template validates, a broken one fails loudly, the engine
// names no FIT stage or deadline, and the deadline list prints with one command.

const TEMPLATE_PATH = join(import.meta.dirname, "pathways", "fit-colonoscopy.json");
const UNSOURCED = "unsourced, needs clinical review";

function rawTemplate(): Record<string, any> {
  return JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
}

function problemsOf(mutate: (t: Record<string, any>) => void): string {
  const t = rawTemplate();
  mutate(t);
  try {
    validatePathway(t, "broken.json");
  } catch (error) {
    expect(error).toBeInstanceOf(PathwayTemplateError);
    return (error as Error).message;
  }
  throw new Error("the broken template was accepted");
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("TICKET-04: the FIT pathway template", () => {
  it("passes validation and keeps every stage key the frontend, seed and API use", () => {
    expect(FIT_COLONOSCOPY.stages.map((s) => s.key)).toEqual([
      "result_received",
      "patient_notified",
      "referral_sent",
      "referral_accepted",
      "colonoscopy_booked",
      "procedure_completed",
      "pathology_ordered",
      "pathology_received",
      "closure_proposed",
      "closure_confirmed",
      "closed",
    ]);
    expect(FIT_COLONOSCOPY.outcomes.map((o) => o.key)).toEqual([
      "returned_to_routine_screening",
      "surveillance_scheduled",
      "oncology_accepted_therapy_started",
    ]);
  });

  it("gives every deadline a source, and only the 31-day referral limit a real one", () => {
    for (const stage of FIT_COLONOSCOPY.stages) {
      if (stage.sla_hours !== null) expect(stage.source, stage.key).toBe(UNSOURCED);
    }
    for (const outcome of FIT_COLONOSCOPY.outcomes) expect(outcome.source).toBe(UNSOURCED);

    expect(FIT_COLONOSCOPY.limits).toHaveLength(1);
    expect(FIT_COLONOSCOPY.limits[0]).toMatchObject({
      from_stage: "referral_sent",
      to_stage: "procedure_completed",
      max_days: 31,
      source: "HAAD standard, cited in BMC Cancer 2021",
    });
  });

  it("fits the stage deadlines between referral and colonoscopy inside the 31 days", () => {
    const stages = FIT_COLONOSCOPY.stages;
    const from = stages.findIndex((s) => s.key === "referral_sent");
    const to = stages.findIndex((s) => s.key === "procedure_completed");
    const hours = stages.slice(from, to).reduce((sum, s) => sum + (s.sla_hours ?? 0), 0);
    expect(hours).toBeLessThanOrEqual(31 * 24);
  });

  it("names an owner role, an urgency and an escalation ladder for every open stage", () => {
    for (const stage of FIT_COLONOSCOPY.stages.filter((s) => s.key !== "closed")) {
      expect(stage.owner_role, stage.key).toBeTruthy();
      expect(stage.escalation.length, stage.key).toBeGreaterThan(0);
      expect(stage.exits.length, stage.key).toBeGreaterThan(0);
    }
  });
});

describe("TICKET-04: a broken template stops the server with a clear message", () => {
  it("says which file is broken and that the server will not start", () => {
    const message = problemsOf((t) => {
      delete t.stages[2].source;
    });
    expect(message).toContain("Pathway template broken.json is invalid");
    expect(message).toContain("the server will not start");
    expect(message).toContain("stages[2] (referral_sent).source must be a non-empty string");
  });

  it.each<[string, (t: Record<string, any>) => void, string]>([
    ["a negative deadline", (t) => (t.stages[0].sla_hours = -5), "sla_hours must be greater than 0"],
    ["a deadline missing on an open stage", (t) => (t.stages[1].sla_hours = null), "may be null only on the terminal stage"],
    ["an exit to an unknown event", (t) => (t.stages[0].exits[0].event = "teleported"), 'uses the event "teleported"'],
    ["an exit to an unknown stage", (t) => (t.stages[0].exits[0].to = "nowhere"), 'which is not a stage'],
    ["a stage defined twice", (t) => (t.stages[1].key = "result_received"), "is defined twice"],
    ["an unknown owner role", (t) => (t.stages[0].owner_role = "receptionist"), "owner_role must be one of"],
    ["the system role able to close", (t) => t.events.closure_confirmed.roles.push("system"), 'includes "system", which may never close a case'],
    ["coordination staff able to close", (t) => t.events.case_closed.roles.push("coordination_staff"), 'includes "coordination_staff"'],
    ["a non-closure event reaching closed", (t) => (t.stages[9].exits[0].event = "reopened"), "is not a closure event"],
    ["stage deadlines that break the 31-day limit", (t) => (t.stages[4].sla_hours = 900), "add up to"],
    ["an outcome with no evidence", (t) => (t.outcomes[0].evidence = {}), "must require at least one document kind"],
    ["a stage a case cannot leave", (t) => (t.stages[3].exits = []), "has no exit to a later stage"],
    ["a creation event that names no owner", (t) => (t.events.case_created.owner = "keep"), 'a new case starts with an owner'],
  ])("refuses %s", (_name, mutate, expected) => {
    expect(problemsOf(mutate)).toContain(expected);
  });

  it("lists every problem at once, not only the first", () => {
    const message = problemsOf((t) => {
      t.stages[0].sla_hours = "a week";
      t.stages[1].urgency = undefined;
    });
    expect(message).toContain("stages[0] (result_received).sla_hours must be a number");
    expect(message).toContain("stages[1] (patient_notified).urgency must be a number");
  });

  it("fails the same way when the file on disk is not JSON or is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "nexyra-pathway-"));
    dirs.push(dir);

    const notJson = join(dir, "not-json.json");
    writeFileSync(notJson, "{ stages: [");
    expect(() => loadPathwayFile(notJson)).toThrow(/could not be read as JSON/);

    const invalid = join(dir, "invalid.json");
    const t = rawTemplate();
    delete t.terminal_stage;
    writeFileSync(invalid, JSON.stringify(t));
    expect(() => loadPathwayFile(invalid)).toThrow(/terminal_stage must be a non-empty string/);

    // The real file passes the same loader the server uses.
    expect(loadPathwayFile(TEMPLATE_PATH).id).toBe("fit-colonoscopy");
  });
});

describe("TICKET-04: the engine reads the template instead of naming the pathway", () => {
  const engineSource = readFileSync(join(import.meta.dirname, "engine.ts"), "utf8");

  it("has no FIT stage name in server/engine.ts", () => {
    for (const stage of FIT_COLONOSCOPY.stages) {
      expect(engineSource, stage.key).not.toMatch(new RegExp(`["'\`]${stage.key}["'\`]`));
    }
    for (const type of Object.keys(FIT_COLONOSCOPY.events)) {
      expect(engineSource, type).not.toMatch(new RegExp(`["'\`]${type}["'\`]`));
    }
  });

  it("has no deadline number in server/engine.ts", () => {
    const numbers = new Set<number>([
      ...FIT_COLONOSCOPY.stages.flatMap((s) => (s.sla_hours === null ? [] : [s.sla_hours])),
      ...FIT_COLONOSCOPY.limits.map((l) => l.max_days),
      FIT_COLONOSCOPY.escalation_spacing_hours,
    ]);
    for (const n of numbers) {
      expect(engineSource, String(n)).not.toMatch(new RegExp(`\\b${n}\\b`));
    }
  });
});

describe("TICKET-04: the deadline list for clinical review", () => {
  it("prints each stage with its deadline, owner and source", () => {
    const rows = deadlineRows(FIT_COLONOSCOPY);
    const referral = rows.find((row) => row.item === "Referral to colonoscopy");
    expect(referral).toMatchObject({ deadline: "31 days", source: "HAAD standard, cited in BMC Cancer 2021" });

    const result = rows.find((row) => row.item === "result_received");
    expect(result).toMatchObject({ deadline: "168 h (7 days)", owner: "coordination_staff", source: UNSOURCED });
    expect(rows.filter((row) => row.kind === "stage")).toHaveLength(FIT_COLONOSCOPY.stages.length);
  });
});
