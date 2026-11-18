import type { Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.js";
import {
  evidenceAttached,
  foldEvents,
  rulesOf,
  stageDefinition,
  transitionFor,
  type RecordedEvent,
} from "./engine.js";
import {
  FIT_COLONOSCOPY,
  PATHWAYS,
  PATHWAY_DIRECTORY,
  PathwayTemplateError,
  UnknownPathwayError,
  getPathway,
  loadPathwayDirectory,
} from "./pathways/index.js";

// TICKET-18 done-when, one named test per box. The mammography template is a second
// pathway that runs on the same engine as FIT; these tests drive the seeded MM cases and
// fresh ones through the HTTP surface and the write path, beside the FIT cases.

const UNSOURCED = "unsourced, needs clinical review";
const MAMMOGRAPHY = getPathway("mammography-biopsy");

let server: Server | undefined;
let base = "";
let dir = "";
let db: Db;
let events: typeof import("./events.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-pathway2-"));
  process.env.DATABASE_FILE = join(dir, "pathway2.sqlite");
  const { getDb } = await import("./db.js");
  const { seed } = await import("./seed.js");
  const { app } = await import("./index.js");
  events = await import("./events.js");
  db = await getDb();
  await seed(db);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server?.address();
  if (typeof address === "object" && address !== null) base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { closeDb } = await import("./db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const header = (actor_id: string, role: string) => ({
  "X-Nexyra-Actor": JSON.stringify({ actor_id, role, display_name: actor_id }),
});
const BREAST_NAVIGATOR = header("act_007", "navigator");
const BREAST_PHYSICIAN = header("act_008", "responsible_physician");
const COORDINATOR = header("act_001", "coordination_staff");
const MANAGER = header("act_004", "program_manager");

const RADIOLOGY = { system: "http://snomed.info/sct", code: "394914008", display: "Radiology" };

async function call(
  method: "GET" | "POST",
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, body: (await response.json()) as any };
}

async function post(caseId: string, type: string, headers: Record<string, string>, payload: Record<string, unknown> = {}) {
  const result = await call("POST", `/api/cases/${caseId}/events`, { headers, body: { type, payload } });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body;
}

async function cached(caseId: string) {
  return db
    .prepare("SELECT stage, status, owner_actor_id, final_outcome, stage_entered_at, provider_id FROM cases WHERE id = ?")
    .get<Record<string, unknown>>(caseId);
}

describe("TICKET-18: the mammography template", () => {
  it("loads beside FIT from its own JSON file", () => {
    expect(PATHWAYS.map((p) => p.id)).toEqual(["fit-colonoscopy", "mammography-biopsy"]);
    expect(MAMMOGRAPHY.stages.map((s) => s.key)).toEqual([
      "mammogram_abnormal",
      "patient_recalled",
      "assessment_referred",
      "assessment_accepted",
      "imaging_booked",
      "imaging_done",
      "biopsy_done",
      "pathology_received",
      "closure_proposed",
      "closure_confirmed",
      "closed",
    ]);
  });

  it("marks every deadline unsourced, needs clinical review", () => {
    for (const stage of MAMMOGRAPHY.stages.filter((s) => s.key !== MAMMOGRAPHY.terminal_stage)) {
      expect(stage.source, stage.key).toBe(UNSOURCED);
      expect(stage.sla_hours, stage.key).toBeGreaterThan(0);
    }
    for (const limit of MAMMOGRAPHY.limits) expect(limit.source, limit.key).toBe(UNSOURCED);
    for (const outcome of MAMMOGRAPHY.outcomes) expect(outcome.source, outcome.key).toBe(UNSOURCED);
    expect(MAMMOGRAPHY.trigger.source).toBe(UNSOURCED);
    expect(MAMMOGRAPHY.unowned?.source).toBe(UNSOURCED);
    expect(MAMMOGRAPHY.consultation?.source).toBe(UNSOURCED);
  });

  it("says it is a configuration demonstration and that the DoH standard was not read", () => {
    expect(MAMMOGRAPHY.description).toMatch(/configuration demonstration/i);
    expect(MAMMOGRAPHY.description).toMatch(/not been clinically reviewed/);
    expect(MAMMOGRAPHY.description).toMatch(/version 2, effective August 2025/);
    expect(MAMMOGRAPHY.description).toMatch(/has not read it/);
  });

  it("has owners, an escalation ladder and closure evidence for every open stage", () => {
    for (const stage of MAMMOGRAPHY.stages.filter((s) => s.key !== "closed")) {
      expect(stage.owner_role, stage.key).toBeTruthy();
      expect(stage.escalation.length, stage.key).toBeGreaterThan(0);
    }
    expect(MAMMOGRAPHY.outcomes.map((o) => [o.key, o.evidence])).toEqual([
      ["returned_to_routine_screening", { any_of: ["diagnostic_imaging", "pathology"], all_of: [] }],
      ["short_interval_follow_up", { any_of: [], all_of: ["diagnostic_imaging"] }],
      ["breast_service_accepted_treatment_started", { any_of: [], all_of: ["pathology"] }],
    ]);
  });
});

describe("TICKET-18: git diff does not touch the engine for a pathway", () => {
  const engineSource = readFileSync(join(import.meta.dirname, "engine.ts"), "utf8");

  it("names no mammography stage, event or deadline in server/engine.ts", () => {
    for (const stage of MAMMOGRAPHY.stages) {
      expect(engineSource, stage.key).not.toMatch(new RegExp(`["'\`]${stage.key}["'\`]`));
    }
    for (const type of Object.keys(MAMMOGRAPHY.events)) {
      expect(engineSource, type).not.toMatch(new RegExp(`["'\`]${type}["'\`]`));
    }
    const numbers = new Set<number>([
      ...MAMMOGRAPHY.stages.flatMap((s) => (s.sla_hours === null ? [] : [s.sla_hours])),
      ...MAMMOGRAPHY.limits.map((l) => l.max_days),
      MAMMOGRAPHY.escalation_spacing_hours,
    ]);
    for (const n of numbers) expect(engineSource, String(n)).not.toMatch(new RegExp(`\\b${n}\\b`));
    expect(engineSource).not.toContain(MAMMOGRAPHY.id);
    expect(engineSource).not.toContain(FIT_COLONOSCOPY.id);
  });

  it("registers every JSON file in server/pathways/ and nothing else", () => {
    const files = readdirSync(PATHWAY_DIRECTORY).filter((name) => name.endsWith(".json")).sort();
    expect(files.map((name) => name.replace(/\.json$/, ""))).toEqual(PATHWAYS.map((p) => p.id));
  });

  it("runs a third pathway written as a JSON file only, with no code change", () => {
    const third = mkdtempSync(join(tmpdir(), "nexyra-third-"));
    try {
      const text = readFileSync(join(PATHWAY_DIRECTORY, "mammography-biopsy.json"), "utf8")
        .replaceAll("mammography-biopsy", "third-demo")
        .replaceAll("mammogram_abnormal", "sample_received");
      writeFileSync(join(third, "third-demo.json"), text);
      const [pathway] = loadPathwayDirectory(third);
      expect(pathway?.id).toBe("third-demo");
      if (!pathway) return;

      const at = "2026-11-17T09:00:00+07:00";
      const history: RecordedEvent[] = [
        { type: "case_created", actor_id: "act_system", actor_role: "system", occurred_at: at, payload: { owner_actor_id: "act_007", provider_id: "prov_clinic_b" } },
        { type: "patient_recalled", actor_id: "act_007", actor_role: "navigator", occurred_at: at, payload: {} },
      ];
      expect(foldEvents(history, pathway)).toMatchObject({ stage: "patient_recalled", owner_actor_id: "act_007" });
      expect(stageDefinition("sample_received", pathway)?.owner_role).toBe("navigator");
      expect(transitionFor("sample_received", "patient_recalled", "navigator", pathway)).toMatchObject({ ok: true });
      expect(transitionFor("sample_received", "colonoscopy_booked", "navigator", pathway)).toMatchObject({ ok: false });
      expect(rulesOf(pathway).initialStage).toBe("sample_received");
      expect(evidenceAttached("short_interval_follow_up", [{ kind: "diagnostic_imaging" }], pathway)).toBe(true);
    } finally {
      rmSync(third, { recursive: true, force: true });
    }
  });

  it("refuses two template files that claim the same id", () => {
    const twice = mkdtempSync(join(tmpdir(), "nexyra-twice-"));
    try {
      const text = readFileSync(join(PATHWAY_DIRECTORY, "mammography-biopsy.json"), "utf8");
      writeFileSync(join(twice, "a.json"), text);
      writeFileSync(join(twice, "b.json"), text);
      expect(() => loadPathwayDirectory(twice)).toThrow(PathwayTemplateError);
      expect(() => loadPathwayDirectory(twice)).toThrow(/"mammography-biopsy" is already used by a\.json/);
    } finally {
      rmSync(twice, { recursive: true, force: true });
    }
  });

  it("refuses an unknown pathway id with a clear error", async () => {
    expect(() => getPathway("lung-ct")).toThrow(UnknownPathwayError);
    expect(() => getPathway("lung-ct")).toThrow(
      'No pathway template carries the id "lung-ct". Known pathways: fit-colonoscopy, mammography-biopsy.',
    );
    await expect(
      events.createCase(db, {
        caseId: "MM-T-UNKNOWN",
        patient: { name: "Nobody", age: 50, language: "en" },
        actor: events.SYSTEM_ACTOR,
        pathwayId: "lung-ct",
      }),
    ).rejects.toMatchObject({ status: 400, code: "validation_failed" });
  });
});

describe("TICKET-18: second-pathway cases appear in the worklist like FIT cases", () => {
  it("lists the seeded mammography cases in the same register as the FIT cases", async () => {
    const { status, body } = await call("GET", "/api/cases?role=program_manager", { headers: MANAGER });
    expect(status).toBe(200);
    const ids = body.cases.map((c: { case_id: string }) => c.case_id);
    for (const id of ["CX-1001", "CX-1002", "CX-1003", "MM-2001", "MM-2002", "MM-2003"]) expect(ids).toContain(id);

    const row = (id: string) => body.cases.find((c: { case_id: string }) => c.case_id === id);
    expect(row("MM-2001")).toMatchObject({
      pathway_id: "mammography-biopsy",
      stage: "patient_recalled",
      stage_label: "Patient recalled for assessment",
      owner: { actor_id: "act_007", role: "navigator" },
    });
    // Due 24 Nov 09:00, recalled 17 Nov 09:00 on a 168-hour deadline, read at day 0 11:42.
    expect(row("MM-2001").hours_left_stage).toBe(165);
    expect(row("CX-1001")).toMatchObject({ pathway_id: "fit-colonoscopy", stage_label: "Result received" });
    // Its own limit: 21 days from referral to diagnostic imaging, met on day 8.
    expect(row("MM-2002").days_left_referral_limit).toBe(13);
    expect(row("MM-2003").flags).toContain("closed");
  });

  it("shows the physician the mammography case they own", async () => {
    const { body } = await call("GET", "/api/cases?role=responsible_physician", { headers: BREAST_PHYSICIAN });
    expect(body.cases.map((c: { case_id: string }) => c.case_id)).toEqual(expect.arrayContaining(["MM-2002", "CX-1003"]));
  });

  it("gives a mammography case its own stage list, outcomes and actions", async () => {
    const { status, body } = await call("GET", "/api/cases/MM-2002?role=responsible_physician", {
      headers: BREAST_PHYSICIAN,
    });
    expect(status).toBe(200);
    expect(body.case.pathway).toEqual({
      id: "mammography-biopsy",
      version: 1,
      label: "Abnormal screening mammogram to diagnostic imaging, biopsy, pathology and follow-up",
    });
    expect(body.stages.map((s: { key: string }) => s.key)).toEqual(MAMMOGRAPHY.stages.map((s) => s.key));
    expect(body.stages.find((s: { state: string }) => s.state === "current").key).toBe("biopsy_done");
    expect(body.case.outcomes.map((o: { key: string }) => o.key)).toEqual(MAMMOGRAPHY.outcomes.map((o) => o.key));
    expect(body.available_actions).toContain("advance_case");
    expect(body.referrals[0]).toMatchObject({ referral_id: "REF-8790-1", status: "accepted" });
  });

  it("rebuilds every seeded mammography case from its events", async () => {
    for (const id of ["MM-2001", "MM-2002", "MM-2003"]) {
      const before = await cached(id);
      await db.prepare("UPDATE cases SET stage = 'wiped', owner_actor_id = NULL WHERE id = ?").run(id);
      await events.rebuildCase(db, id);
      expect(await cached(id), id).toEqual(before);
    }
  });
});

describe("TICKET-18: second-pathway cases escalate like FIT cases", () => {
  // The scripted FIT demo ends on day 6 (23 Nov 11:42); the MM deadlines fall after it.
  it("escalates no MM case through day 6, then MM-2001 and MM-2002 on day 7, each by its own ladder", async () => {
    const day1 = await call("POST", "/api/clock/advance", { body: { days: 1 } });
    const day2 = await call("POST", "/api/clock/advance", { body: { days: 1 } });
    const mm = (body: { escalations_per_case?: { case_id: string }[] }) =>
      (body.escalations_per_case ?? []).filter((e) => e.case_id.startsWith("MM-"));
    expect(day1.status).toBe(200);
    expect(day2.status).toBe(200);

    const { tick } = await import("./escalation.js");
    const { advanceDays } = await import("./clock.js");
    for (let day = 3; day <= 6; day++) {
      await advanceDays(db, 1);
      expect(mm(await tick(db)), `day ${day}`).toEqual([]);
    }
    const missedByDay6 = await db
      .prepare("SELECT count(*) AS n FROM events WHERE case_id LIKE 'MM-%' AND type = 'deadline_missed'")
      .get<{ n: number }>();
    expect(missedByDay6?.n).toBe(0);

    // day 7: 24 Nov 11:42, past MM-2001's 24 Nov 09:00 and MM-2002's 24 Nov 10:00
    await advanceDays(db, 1);
    const day7 = await tick(db);
    expect(mm(day7)).toEqual([
      { case_id: "MM-2001", level: 1, role: "responsible_physician" },
      { case_id: "MM-2002", level: 1, role: "responsible_physician" },
    ]);

    await advanceDays(db, 1); // day 8: the template's 24-hour spacing, so each climbs its ladder
    const day8 = await tick(db);
    expect(mm(day8)).toEqual([
      { case_id: "MM-2001", level: 2, role: "program_manager" },
      { case_id: "MM-2002", level: 2, role: "program_manager" },
    ]);

    const event = await db
      .prepare(
        `SELECT payload FROM events WHERE case_id = 'MM-2001' AND type = 'deadline_missed'
          ORDER BY rowid LIMIT 1`,
      )
      .get<{ payload: string }>();
    expect(JSON.parse(event?.payload ?? "{}").summary).toBe(
      "Escalated to responsible physician: 3h past the Patient recalled for assessment deadline",
    );

    const { body } = await call("GET", "/api/cases?role=program_manager&filter=late", { headers: MANAGER });
    expect(body.cases.map((c: { case_id: string }) => c.case_id)).toEqual(
      expect.arrayContaining(["MM-2001", "MM-2002"]),
    );
  });
});

describe("TICKET-18: second-pathway cases move like FIT cases", () => {
  it("moves MM-2001 with its own events, sends its referral and stops its old timer", async () => {
    const body = await post("MM-2001", "assessment_referred", BREAST_NAVIGATOR, {
      referral: { referral_id: "REF-8812-1", to_provider_id: "prov_breast_c", priority: "routine", specialty: RADIOLOGY },
    });
    expect(body.case.stage).toBe("assessment_referred");
    expect(body.referrals.at(-1)).toMatchObject({ referral_id: "REF-8812-1", status: "pending" });
    const timers = await db
      .prepare("SELECT status FROM timers WHERE case_id = 'MM-2001' AND stage = 'patient_recalled'")
      .all<{ status: string }>();
    expect(timers.map((t) => t.status)).toEqual(["cancelled", "cancelled"]);
  });

  it("makes an unanswered assessment referral unowned with the template's own rule", async () => {
    const { tick } = await import("./escalation.js");
    const { advanceDays } = await import("./clock.js");
    await advanceDays(db, 3); // past the 72-hour acceptance deadline
    const ticked = await tick(db);
    expect(ticked.unowned_cases).toContain("MM-2001");

    const { body } = await call("GET", "/api/cases/MM-2001?role=program_manager", { headers: MANAGER });
    expect(body.case.owner).toBeNull();
    expect(body.ownership.gaps.at(-1).trigger).toMatchObject({
      type: "referral_unanswered",
      label: "Assessment referral not answered by the acceptance deadline",
    });
    const task = body.tasks.find((t: { kind: string; status: string }) => t.kind === "assign_owner" && t.status === "open");
    // The template gives the assign-owner task to a navigator at the case's provider.
    expect(task.owner.role).toBe("navigator");

    const unowned = await call("GET", "/api/unowned", { headers: MANAGER });
    expect(unowned.body.cases.find((c: { case_id: string }) => c.case_id === "MM-2001")).toMatchObject({
      pathway_id: "mammography-biopsy",
      stage_label: "Referred for diagnostic breast assessment",
    });
  });

  it("closes MM-2002 only with the evidence its own outcome needs", async () => {
    await post("MM-2002", "pathology_received", BREAST_PHYSICIAN);
    await post("MM-2002", "closure_proposed", BREAST_PHYSICIAN, {
      outcome: "breast_service_accepted_treatment_started",
    });

    // A FIT outcome is not in this pathway's vocabulary.
    const fitOutcome = await call("POST", "/api/cases/MM-2002/closure/confirm", {
      headers: BREAST_PHYSICIAN,
      body: { final_outcome: "surveillance_scheduled" },
    });
    expect(fitOutcome.status).toBe(400);
    expect(fitOutcome.body.error.message).toContain("breast_service_accepted_treatment_started");

    const noPathology = await call("POST", "/api/cases/MM-2002/closure/confirm", { headers: BREAST_PHYSICIAN });
    expect(noPathology.status).toBe(409);
    expect(noPathology.body.error.details).toEqual({
      final_outcome: true,
      evidence_attached: false,
      physician_confirmation: true,
    });

    await db
      .prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES (?, ?, 'pathology', ?, ?)")
      .run("d_2002_path", "MM-2002", "Breast pathology", "Synthetic pathology report.");
    const closed = await call("POST", "/api/cases/MM-2002/closure/confirm", { headers: BREAST_PHYSICIAN });
    expect(closed.status).toBe(200);
    expect(closed.body.case).toMatchObject({
      stage: "closed",
      status: "closed",
      final_outcome: "breast_service_accepted_treatment_started",
    });
  });
});

describe("TICKET-18: both pathways run side by side without affecting each other", () => {
  it("TICKET-18: both pathways run side by side without affecting each other", async () => {
    const { tick } = await import("./escalation.js");
    const patient = { name: "Synthetic patient", age: 52, language: "ar" };
    await events.createCase(db, {
      caseId: "MM-T-SIDE",
      patient,
      actor: events.SYSTEM_ACTOR,
      providerId: "prov_clinic_b",
      pathwayId: "mammography-biopsy",
    });
    await events.createCase(db, {
      caseId: "CX-T-SIDE",
      patient,
      actor: events.SYSTEM_ACTOR,
      providerId: "prov_clinic_b",
    });

    // Each starts at its own initial stage with an owner of its own initial role.
    const mm = await call("GET", "/api/cases/MM-T-SIDE?role=program_manager", { headers: MANAGER });
    const cx = await call("GET", "/api/cases/CX-T-SIDE?role=program_manager", { headers: MANAGER });
    expect(mm.body.case).toMatchObject({ stage: "mammogram_abnormal", owner: { role: "navigator" } });
    expect(cx.body.case).toMatchObject({ stage: "result_received", owner: { role: "coordination_staff" } });
    expect(cx.body.case.pathway.id).toBe("fit-colonoscopy");

    // One pathway's events mean nothing on the other.
    const fitOnMm = await call("POST", "/api/cases/MM-T-SIDE/events", {
      headers: BREAST_NAVIGATOR,
      body: { type: "patient_notified", payload: {} },
    });
    expect(fitOnMm.status).toBe(400);
    expect(fitOnMm.body.error.message).toBe('"patient_notified" is not a case event.');
    const mmOnFit = await call("POST", "/api/cases/CX-T-SIDE/events", {
      headers: COORDINATOR,
      body: { type: "patient_recalled", payload: {} },
    });
    expect(mmOnFit.status).toBe(400);

    // The FIT outreach ladder writes a message for the FIT case and nothing for the other.
    const ticked = await tick(db);
    const outreachCases = (ticked.outreach?.per_case ?? []).map((f) => f.case_id);
    expect(outreachCases).toContain("CX-T-SIDE");
    expect(outreachCases).not.toContain("MM-T-SIDE");
    const mmOutreach = await db
      .prepare("SELECT count(*) AS n FROM events WHERE case_id = 'MM-T-SIDE' AND type LIKE 'outreach_%'")
      .get<{ n: number }>();
    expect(mmOutreach?.n).toBe(0);
    const ladderView = await call("GET", "/api/cases/MM-T-SIDE/outreach?role=program_manager", { headers: MANAGER });
    expect(ladderView.status).toBe(404);
    expect(ladderView.body.error.message).toContain("has no patient outreach ladder");

    // Interleaved moves: each case advances through its own template only.
    await post("MM-T-SIDE", "patient_recalled", BREAST_NAVIGATOR);
    await post("CX-T-SIDE", "patient_notified", COORDINATOR);
    await post("MM-T-SIDE", "assessment_referred", BREAST_NAVIGATOR);
    await post("CX-T-SIDE", "referral_sent", COORDINATOR);
    expect((await cached("MM-T-SIDE"))?.stage).toBe("assessment_referred");
    expect((await cached("CX-T-SIDE"))?.stage).toBe("referral_sent");

    // Report verification is FIT-only: the other pathway is handed to a person.
    const verification = await call("POST", "/api/cases/MM-T-SIDE/verification", { headers: BREAST_PHYSICIAN, body: {} });
    expect(verification.status).toBe(200);
    expect(verification.body.extraction).toMatchObject({
      proposal: "needs_human_reading",
      origin: "pathway_not_verified",
    });

    // Rebuilding either case from its own events gives back exactly its row.
    for (const id of ["MM-T-SIDE", "CX-T-SIDE"]) {
      const before = await cached(id);
      await events.rebuildCase(db, id);
      expect(await cached(id), id).toEqual(before);
    }

    // The programme view is the FIT funnel: mammography cases are not counted in it.
    const { programmeSummary } = await import("./programme.js");
    const summary = await programmeSummary(db, "program_manager");
    const fitCases = await db
      .prepare("SELECT count(*) AS n FROM cases WHERE pathway_id = 'fit-colonoscopy'")
      .get<{ n: number }>();
    expect(summary.counts.total).toBe(fitCases?.n);
    expect(summary.pathway.id).toBe("fit-colonoscopy");
  });
});
