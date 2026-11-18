import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.js";
import {
  PATHWAY,
  TERMINAL_STAGE,
  closureConditions,
  confirmClosure,
  nextState,
  ownerAfter,
  transitionFor,
  type CaseState,
  type EngineCase,
} from "./engine.js";
import type { WriteActor } from "./events.js";

// TICKET-03 and TICKET-05 done-when, one named test per box. These run the engine
// against a real database file, through the same functions the HTTP routes call;
// server/writes.test.ts calls the guarded endpoints themselves.

let dir = "";
let db: Db;
let events: typeof import("./events.js");

const SYSTEM: WriteActor = { actor_id: "act_system", role: "system", display_name: "system" };
const COORDINATOR: WriteActor = { actor_id: "act_001", role: "coordination_staff", display_name: "R. Haddad" };
const NAVIGATOR: WriteActor = { actor_id: "act_002", role: "navigator", display_name: "Nur H." };
const PHYSICIAN: WriteActor = { actor_id: "act_003", role: "responsible_physician", display_name: "Dr. Fulan" };

const SEEDED = ["CX-1001", "CX-1002", "CX-1003"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-engine-"));
  process.env.DATABASE_FILE = join(dir, "engine.sqlite");
  const { getDb } = await import("./db.js");
  const { seed } = await import("./seed.js");
  events = await import("./events.js");
  db = await getDb();
  await seed(db);
});

afterAll(async () => {
  const { closeDb } = await import("./db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

type Cached = {
  stage: string;
  status: string;
  owner_actor_id: string | null;
  final_outcome: string | null;
  stage_entered_at: string | null;
};

async function cached(caseId: string): Promise<Cached> {
  const row = await db
    .prepare(
      "SELECT stage, status, owner_actor_id, final_outcome, stage_entered_at FROM cases WHERE id = ?",
    )
    .get<Cached>(caseId);
  if (!row) throw new Error(`no case ${caseId}`);
  return row;
}

async function newCase(caseId: string): Promise<void> {
  await events.createCase(db, {
    caseId,
    patient: { name: `Patient ${caseId}`, age: 60, language: "en" },
    actor: SYSTEM,
    payload: { summary: "Case created from a positive FIT" },
  });
}

async function attach(caseId: string, kind: string): Promise<void> {
  await db
    .prepare("INSERT INTO documents (id, case_id, kind, title, text) VALUES (?, ?, ?, ?, ?)")
    .run(`d_${caseId}_${kind}`, caseId, kind, `${kind} report`, "Synthetic report.");
}

async function apply(caseId: string, type: string, actor: WriteActor, payload: Record<string, unknown> = {}) {
  return events.applyEvent(db, { caseId, type, actor, payload });
}

// Walks a fresh case forward to `stop` with a permitted actor for every step.
const WALK: [string, WriteActor, Record<string, unknown>?][] = [
  ["patient_notified", COORDINATOR],
  ["referral_sent", COORDINATOR],
  ["referral_accepted", SYSTEM],
  ["colonoscopy_booked", NAVIGATOR],
  ["colonoscopy_performed", SYSTEM],
  ["pathology_ordered", COORDINATOR],
  ["pathology_received", SYSTEM],
  ["closure_proposed", COORDINATOR, { outcome: "surveillance_scheduled" }],
];

async function walkTo(caseId: string, stop: string): Promise<void> {
  await newCase(caseId);
  for (const [type, actor, payload] of WALK) {
    if ((await cached(caseId)).stage === stop) return;
    await apply(caseId, type, actor, payload ?? {});
  }
}

async function expectRefusal(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ status, code });
}

describe("TICKET-03: the case row is a cache of the events table", () => {
  it("TICKET-03: rebuildCase reproduces every seeded case exactly after its status columns are wiped", async () => {
    const before = new Map<string, Cached>();
    for (const id of SEEDED) before.set(id, await cached(id));

    await db
      .prepare(
        `UPDATE cases SET stage = 'wiped', status = 'wiped', owner_actor_id = NULL,
                          final_outcome = NULL, stage_entered_at = NULL`,
      )
      .run();
    expect((await cached("CX-1003")).stage).toBe("wiped");

    for (const id of SEEDED) {
      await events.rebuildCase(db, id);
      expect(await cached(id), id).toEqual(before.get(id));
    }
  });

  it("TICKET-03: rebuildCase agrees with every write applyEvent made", async () => {
    await walkTo("CX-T-REBUILD", "closure_proposed");
    await attach("CX-T-REBUILD", "colonoscopy");
    await events.confirmCaseClosure(db, { caseId: "CX-T-REBUILD", actor: PHYSICIAN });
    await events.reopenCase(db, { caseId: "CX-T-REBUILD", actor: PHYSICIAN });

    const written = await cached("CX-T-REBUILD");
    await db.prepare("UPDATE cases SET stage = 'wiped', owner_actor_id = NULL WHERE id = ?").run("CX-T-REBUILD");
    await events.rebuildCase(db, "CX-T-REBUILD");
    expect(await cached("CX-T-REBUILD")).toEqual(written);
  });

  it("TICKET-03: rebuildCase refuses a case with no creation event instead of guessing", async () => {
    const at = "2026-11-17T09:00:00+07:00";
    await db
      .prepare(
        `INSERT INTO cases (id, patient_name, patient_age, patient_language, pathway_id, stage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("CX-T-ORPHAN", "T. Orphan", 50, "en", PATHWAY.id, "result_received", at, at);
    await expect(events.rebuildCase(db, "CX-T-ORPHAN")).rejects.toThrow(/no case creation event/);
  });
});

describe("TICKET-05: case state machine and closure rules", () => {
  it("TICKET-05: creates a case at the template's first stage with the template's initial owner", async () => {
    await newCase("CX-T-CREATE");
    const row = await cached("CX-T-CREATE");
    expect(row.stage).toBe(PATHWAY.trigger.initial_stage);
    expect(row.status).toBe("open");
    // The first coordination_staff actor in the seed: the initial stage's owner_role.
    expect(row.owner_actor_id).toBe("act_001");
  });

  it("TICKET-05: walks a case from result_received to closed through valid events", async () => {
    await walkTo("CX-T-WALK", "closure_proposed");
    expect((await cached("CX-T-WALK")).stage).toBe("closure_proposed");

    await attach("CX-T-WALK", "colonoscopy");
    await apply("CX-T-WALK", "closure_confirmed", PHYSICIAN);
    expect((await cached("CX-T-WALK")).stage).toBe("closure_confirmed");

    await apply("CX-T-WALK", "case_closed", PHYSICIAN);
    const row = await cached("CX-T-WALK");
    expect(row).toMatchObject({
      stage: "closed",
      status: "closed",
      final_outcome: "surveillance_scheduled",
      owner_actor_id: "act_001",
    });

    const types = await db
      .prepare("SELECT type FROM events WHERE case_id = ? ORDER BY rowid")
      .all<{ type: string }>("CX-T-WALK");
    expect(types.map((t) => t.type)).toEqual([
      "case_created",
      ...WALK.map(([type]) => type),
      "closure_confirmed",
      "case_closed",
    ]);
  });

  it("TICKET-05: refuses every transition that skips a stage", () => {
    const moving = Object.values(PATHWAY.events).filter((e) => e.moves_stage);
    let refused = 0;
    for (const stage of PATHWAY.stages) {
      for (const event of moving) {
        const legal = stage.exits.some((exit) => exit.event === event.type);
        const result = transitionFor(stage.key, event.type, "responsible_physician");
        expect(result.ok, `${event.type} from ${stage.key}`).toBe(legal);
        if (!legal) {
          refused += 1;
          if (!result.ok) expect(result.code).toBe("invalid_transition");
        }
      }
    }
    expect(refused).toBeGreaterThan(100);
  });

  it("TICKET-05: refuses a skipped stage in the write path with 409 invalid_transition", async () => {
    await newCase("CX-T-SKIP");
    await expectRefusal(apply("CX-T-SKIP", "colonoscopy_performed", SYSTEM), 409, "invalid_transition");
    await expectRefusal(apply("CX-T-SKIP", "referral_sent", COORDINATOR), 409, "invalid_transition");
    expect((await cached("CX-T-SKIP")).stage).toBe("result_received");
  });

  it("TICKET-05: refuses closure when the final outcome is missing", async () => {
    await walkTo("CX-T-NO-OUTCOME", "pathology_received");
    await apply("CX-T-NO-OUTCOME", "closure_proposed", COORDINATOR);
    await attach("CX-T-NO-OUTCOME", "colonoscopy");
    await expect(
      events.confirmCaseClosure(db, { caseId: "CX-T-NO-OUTCOME", actor: PHYSICIAN }),
    ).rejects.toMatchObject({
      status: 409,
      code: "closure_conditions_unmet",
      details: { final_outcome: false, evidence_attached: true, physician_confirmation: true },
    });
  });

  it("TICKET-05: refuses closure when the evidence that outcome requires is missing", async () => {
    await walkTo("CX-T-NO-EVIDENCE", "closure_proposed");
    // No document at all.
    await expect(
      events.confirmCaseClosure(db, { caseId: "CX-T-NO-EVIDENCE", actor: PHYSICIAN }),
    ).rejects.toMatchObject({ code: "closure_conditions_unmet", details: { evidence_attached: false } });

    // A colonoscopy report is not enough for "therapy started": that outcome needs pathology.
    await attach("CX-T-NO-EVIDENCE", "colonoscopy");
    await expect(
      events.confirmCaseClosure(db, {
        caseId: "CX-T-NO-EVIDENCE",
        actor: PHYSICIAN,
        finalOutcome: "oncology_accepted_therapy_started",
      }),
    ).rejects.toMatchObject({
      code: "closure_conditions_unmet",
      details: { final_outcome: true, evidence_attached: false, physician_confirmation: true },
    });
    expect((await cached("CX-T-NO-EVIDENCE")).stage).toBe("closure_proposed");
  });

  it("TICKET-05: refuses closure without the responsible physician's confirmation", () => {
    const ready: EngineCase = {
      stage: "closure_proposed",
      status: "open",
      owner_actor_id: "act_003",
      final_outcome: "returned_to_routine_screening",
      documents: [{ kind: "colonoscopy" }],
      physician_confirmed: false,
    };
    // Outcome and evidence present, no physician act: the third condition is unmet.
    expect(closureConditions(ready)).toEqual({
      final_outcome: true,
      evidence_attached: true,
      physician_confirmation: false,
    });
    expect(closureConditions(ready, "navigator").physician_confirmation).toBe(false);
    // And the closing step cannot be reached without the confirmation stage before it.
    expect(transitionFor("closure_proposed", "case_closed", "responsible_physician").ok).toBe(false);
    expect(confirmClosure(ready, "responsible_physician").allowed).toBe(true);
  });

  it("TICKET-05: refuses closure by the system role and by coordination staff", async () => {
    await walkTo("CX-T-ROLES", "closure_proposed");
    await attach("CX-T-ROLES", "colonoscopy");

    for (const actor of [SYSTEM, COORDINATOR, NAVIGATOR]) {
      await expectRefusal(
        events.confirmCaseClosure(db, { caseId: "CX-T-ROLES", actor }),
        403,
        "role_not_permitted",
      );
      await expectRefusal(apply("CX-T-ROLES", "closure_confirmed", actor), 403, "role_not_permitted");
    }
    expect(transitionFor("closure_proposed", "closure_confirmed", "system").ok).toBe(false);
    expect(transitionFor("closure_confirmed", "case_closed", "system").ok).toBe(false);

    // Even past confirmation, the final step is a physician's.
    await apply("CX-T-ROLES", "closure_confirmed", PHYSICIAN);
    await expectRefusal(apply("CX-T-ROLES", "case_closed", COORDINATOR), 403, "role_not_permitted");
    await expectRefusal(apply("CX-T-ROLES", "case_closed", SYSTEM), 403, "role_not_permitted");
    expect((await cached("CX-T-ROLES")).stage).toBe("closure_confirmed");
  });

  it("TICKET-05: an incomplete colonoscopy reopens the case and assigns an owner", async () => {
    // The demo's case 3: closure was proposed, the report says the caecum was not reached.
    await apply("CX-1003", "procedure_incomplete", PHYSICIAN, { summary: "Caecum not reached" });
    expect(await cached("CX-1003")).toMatchObject({
      stage: "referral_sent",
      status: "open",
      owner_actor_id: "act_003",
      final_outcome: null,
    });

    // From an unowned case, the incomplete procedure gives it an owner.
    const unowned: CaseState = {
      stage: "procedure_completed",
      status: "open",
      owner_actor_id: null,
      final_outcome: null,
      stage_entered_at: "2026-11-17T09:00:00+07:00",
    };
    const next = nextState(unowned, {
      type: "procedure_incomplete",
      actor_id: "act_003",
      actor_role: "responsible_physician",
      occurred_at: "2026-11-17T10:00:00+07:00",
      payload: {},
    });
    expect(next).toMatchObject({ stage: "referral_sent", owner_actor_id: "act_003" });

    // Only the physician records it.
    await walkTo("CX-T-INCOMPLETE", "pathology_ordered");
    await expectRefusal(apply("CX-T-INCOMPLETE", "procedure_incomplete", COORDINATOR), 403, "role_not_permitted");
  });

  it("TICKET-05: no open case is ever without an owner except the explicit unowned state", async () => {
    // Every (stage, event) pair in the template, from an owned case: the owner survives
    // unless the event is one the template marks as clearing it.
    const clearing = new Set<string>();
    for (const stage of PATHWAY.stages) {
      for (const exit of stage.exits) {
        const owner = ownerAfter({ owner_actor_id: "act_001" }, exit.event, null);
        if (owner === null) clearing.add(exit.event);
      }
    }
    expect([...clearing]).toEqual(["referral_rejected"]);
    for (const type of clearing) {
      const stage = PATHWAY.stages.find((s) => s.exits.some((e) => e.event === type));
      const target = stage?.exits.find((e) => e.event === type)?.to;
      // The unowned state is an open case, and an owner can be assigned there.
      expect(target).not.toBe(TERMINAL_STAGE);
      expect(transitionFor(target ?? "", "owner_assigned", "coordination_staff").ok).toBe(true);
    }

    // Through the database: a rejected referral leaves the case explicitly unowned, and
    // assigning an owner is its own event that ends that state.
    await walkTo("CX-T-UNOWNED", "referral_sent");
    await apply("CX-T-UNOWNED", "referral_rejected", SYSTEM, { summary: "Rejected by hospital B" });
    expect(await cached("CX-T-UNOWNED")).toMatchObject({ stage: "patient_notified", owner_actor_id: null });

    await apply("CX-T-UNOWNED", "owner_assigned", COORDINATOR, { owner_actor_id: "act_005" });
    expect((await cached("CX-T-UNOWNED")).owner_actor_id).toBe("act_005");
    await expectRefusal(apply("CX-T-UNOWNED", "owner_assigned", SYSTEM), 403, "role_not_permitted");

    // Every open row in the database: owned, or unowned because a clearing event says so.
    const open = await db
      .prepare("SELECT id, owner_actor_id FROM cases WHERE status = 'open'")
      .all<{ id: string; owner_actor_id: string | null }>();
    for (const row of open.filter((r) => r.owner_actor_id === null && r.id !== "CX-T-ORPHAN")) {
      const owning = await db
        .prepare(
          `SELECT type FROM events WHERE case_id = ?
             AND type IN ('referral_rejected', 'owner_assigned', 'case_created', 'reopened', 'procedure_incomplete')
           ORDER BY rowid DESC LIMIT 1`,
        )
        .get<{ type: string }>(row.id);
      expect(owning?.type, row.id).toBe("referral_rejected");
    }
  });
});
