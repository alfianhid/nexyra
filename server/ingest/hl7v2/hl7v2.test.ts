import type { Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../db.js";

// TICKET-25 done-when, one named test per box, through POST /api/ingest/hl7v2. The sample
// messages are the files in data/hl7. Steps that are a person's act (telling the patient
// the result) go through applyEvent, as the demo does through the UI.

let server: Server | undefined;
let base = "";
let dir = "";
let db: Db;
let events: typeof import("../../events.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "nexyra-hl7-"));
  process.env.DATABASE_FILE = join(dir, "hl7.sqlite");
  const { getDb } = await import("../../db.js");
  const { seed } = await import("../../seed.js");
  const { app } = await import("../../index.js");
  events = await import("../../events.js");
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
  const { closeDb } = await import("../../db.js");
  await closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const ACTOR = { actor_id: "act_001", role: "coordination_staff", display_name: "R. Haddad" };
const HEADER = { "X-Nexyra-Actor": JSON.stringify(ACTOR) };

const sample = (name: string) => readFileSync(join(process.cwd(), "data", "hl7", name), "utf8");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function ingest(text: string, asJson = false): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${base}/api/ingest/hl7v2`, {
    method: "POST",
    headers: { ...HEADER, "Content-Type": asJson ? "application/json" : "text/plain" },
    body: asJson ? JSON.stringify({ message: text }) : text,
  });
  return { status: response.status, body: await response.json() };
}

async function getJson(path: string): Promise<Json> {
  const response = await fetch(`${base}${path}`, { headers: HEADER });
  return response.json();
}

async function caseCount(): Promise<number> {
  return (await db.prepare("SELECT count(*) AS n FROM cases").get<{ n: number }>())?.n ?? 0;
}

async function tellPatient(caseId: string) {
  await events.applyEvent(db, { caseId, type: "patient_notified", actor: ACTOR as never });
}

function refMessage(opts: { control: string; status: "P^Pending" | "A^Accepted" | "R^Rejected"; referral: string; patient: string; reason?: string }) {
  return [
    `MSH|^~\\&|EREF_A|prov_clinic_a|NEXYRA|NEXYRA|20261117100000||REF^I12^REF_I12|${opts.control}|P|2.5`,
    `RF1|${opts.status}|R^Routine|394584008^Gastroenterology^SCT|||${opts.referral}|20261117|||${opts.reason ? `^${opts.reason}` : ""}`,
    "PRD|RP|Haddad^R|||||prov_clinic_a",
    "PRD|RT|Fulana^Dr|||||prov_hospital_b",
    `PID|1||${opts.patient}^^^NEXYRA^MR||Test^Patient||19700101|M|||||||en`,
  ].join("\n");
}

describe("TICKET-25 HL7 v2 ingest", () => {
  it("an ORU message with a positive FIT creates one case with an initial owner", async () => {
    const before = await caseCount();
    const { status, body } = await ingest(sample("01-oru-fit-positive-NX-P-2001.hl7"));
    expect(status).toBe(200);
    expect(body.outcome).toBe("created_case");
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe("case_created");
    expect(body.raw).toContain("MSH|");
    expect(body.segments.map((s: Json) => s.segment)).toEqual(["MSH", "PID", "OBR", "OBX"]);
    expect(await caseCount()).toBe(before + 1);

    const detail = await getJson(`/api/cases/${body.case_id}`);
    expect(JSON.stringify(detail)).toContain("act_001");
    const row = await db
      .prepare("SELECT owner_actor_id, stage, patient_identifier, provider_id FROM cases WHERE id = ?")
      .get<{ owner_actor_id: string | null; stage: string; patient_identifier: string; provider_id: string }>(body.case_id);
    expect(row?.owner_actor_id).toBe("act_001");
    expect(row?.stage).toBe("result_received");
    expect(row?.patient_identifier).toBe("NX-P-2001");
    expect(row?.provider_id).toBe("prov_clinic_a");

    // The same message again, as JSON { message }: answered duplicate, no second case.
    const again = await ingest(sample("01-oru-fit-positive-NX-P-2001.hl7"), true);
    expect(again.body.duplicate).toBe(true);
    expect(await caseCount()).toBe(before + 1);
  });

  it("a negative FIT creates no case and a second positive FIT for an open case is held", async () => {
    const before = await caseCount();
    const negative = await ingest(sample("03-oru-fit-negative.hl7"));
    expect(negative.body.outcome).toBe("no_action");
    expect(negative.body.reason_code).toBe("fit_negative");
    const second = sample("01-oru-fit-positive-NX-P-2001.hl7").replace("ORU-2001-1", "ORU-2001-2");
    const held = await ingest(second);
    expect(held.body.outcome).toBe("queued_unstitched");
    expect(held.body.reason_code).toBe("open_case_exists");
    expect(await caseCount()).toBe(before);
  });

  it("a REF 'rejected' message triggers the unowned status through TICKET-08", async () => {
    const created = await ingest(sample("01-oru-fit-positive-NX-P-2001.hl7").replace(/NX-P-2001/g, "NX-P-3001").replace("ORU-2001-1", "ORU-3001-1").replace("FIT-2001-26", "FIT-3001-26"));
    const caseId = created.body.case_id as string;
    expect(created.body.outcome).toBe("created_case");
    await tellPatient(caseId);

    const sent = await ingest(refMessage({ control: "R-3001-N", status: "P^Pending", referral: "REF-3001-1", patient: "NX-P-3001" }));
    expect(sent.body.outcome).toBe("applied");
    expect(sent.body.events[0]).toMatchObject({ type: "referral_sent", stage: "referral_sent" });
    const referral = await db.prepare("SELECT priority, specialty_code, to_provider_id, status FROM referrals WHERE id = 'REF-3001-1'").get<Json>();
    expect(referral).toMatchObject({ priority: "routine", specialty_code: "394584008", to_provider_id: "prov_hospital_b", status: "pending" });

    const rejected = await ingest(refMessage({ control: "R-3001-R", status: "R^Rejected", referral: "REF-3001-1", patient: "NX-P-3001", reason: "Request incomplete" }));
    expect(rejected.body.outcome).toBe("applied");
    expect(rejected.body.events[0].type).toBe("referral_rejected");

    const row = await db.prepare("SELECT owner_actor_id, stage FROM cases WHERE id = ?").get<{ owner_actor_id: string | null; stage: string }>(caseId);
    expect(row?.owner_actor_id).toBeNull();
    expect(row?.stage).toBe("patient_notified");
    const unowned = await getJson("/api/unowned");
    const entry = JSON.stringify(unowned);
    expect(entry).toContain(caseId);
    expect(entry).toContain("referral_rejected");
    const gap = await db.prepare("SELECT trigger_type, previous_owner_actor_id FROM ownership_gaps WHERE case_id = ?").get<Json>(caseId);
    expect(gap).toMatchObject({ trigger_type: "referral_rejected", previous_owner_actor_id: "act_001" });
  });

  it("a broken message does not crash the application and is recorded with its reason", async () => {
    const broken = await ingest(sample("15-malformed-not-hl7.hl7"));
    expect(broken.status).toBe(200);
    expect(broken.body.outcome).toBe("queued_unstitched");
    expect(broken.body.reason_code).toBe("not_hl7v2");
    expect(broken.body.reason).toMatch(/MSH/);
    expect(broken.body.events).toEqual([]);

    const noControl = await ingest("MSH|^~\\&|X|prov_clinic_a|NEXYRA|NEXYRA|20261117||ORU^R01|||P|2.5\nPID|1||NX-P-5|");
    expect(noControl.body.reason_code).toBe("missing_control_id");
    const unsupported = await ingest(sample("14-adt-a01-unsupported-type.hl7"));
    expect(unsupported.body.reason_code).toBe("unsupported_message_type");
    const notSnomed = await ingest(sample("13-ref-new-specialty-not-snomed.hl7"));
    expect(notSnomed.body.reason_code).toBe("specialty_not_snomed");
    const empty = await ingest("");
    expect(empty.status).toBe(200);
    expect(empty.body.outcome).toBe("queued_unstitched");

    const queue = await getJson("/api/ingest/unstitched");
    const codes = (queue.items ?? queue.unstitched ?? queue).map?.((i: Json) => i.reason_code) ?? [];
    expect(codes).toEqual(expect.arrayContaining(["not_hl7v2", "missing_control_id", "unsupported_message_type", "specialty_not_snomed"]));

    // Still up, and a plain JSON request without a message is a clean 400.
    const health = await fetch(`${base}/api/providers`);
    expect(health.status).toBe(200);
    const bad = await fetch(`${base}/api/ingest/hl7v2`, { method: "POST", headers: { ...HEADER, "Content-Type": "application/json" }, body: JSON.stringify({ nope: 1 }) });
    expect(bad.status).toBe(400);
  });

  it("demo case 2 can be driven by HL7 messages: ORU, a held REF, then the rejection", async () => {
    const created = await ingest(sample("02-oru-fit-positive-demo2-NX-P-2002.hl7"));
    const caseId = created.body.case_id as string;
    expect(created.body.outcome).toBe("created_case");

    // The referral cannot arrive before the patient was told: held, not lost.
    const early = await ingest(sample("06-ref-new-demo2-NX-P-2002.hl7"));
    expect(early.body.outcome).toBe("queued_unstitched");
    await tellPatient(caseId);
    const sent = await ingest(sample("06-ref-new-demo2-NX-P-2002.hl7"));
    expect(sent.body.outcome).toBe("applied");
    expect(sent.body.duplicate).toBeUndefined();
    const queued = await db.prepare("SELECT status, stitched_case_id FROM unstitched WHERE resource_id = ?").get<Json>("prov_clinic_a/REF-4377-R2-NEW");
    expect(queued).toMatchObject({ status: "stitched", stitched_case_id: caseId });

    const rejected = await ingest(sample("09-ref-rejected-demo2-NX-P-2002.hl7"));
    expect(rejected.body.events[0].type).toBe("referral_rejected");
    const unowned = JSON.stringify(await getJson("/api/unowned"));
    expect(unowned).toContain(caseId);

    // Hospital B's rejection of the seeded CX-1002 referral changes nothing: already so.
    const seeded = await ingest(sample("10-ref-rejected-seeded-CX-1002.hl7"));
    expect(seeded.body.outcome).toBe("no_action");
    expect(seeded.body.reason_code).toBe("already_in_state");
  });

  it("an ASAP referral then an accepted REF moves the case to referral_accepted", async () => {
    const created = await ingest(sample("04-oru-fit-numeric-positive.hl7"));
    expect(created.body.outcome).toBe("created_case");
    expect(created.body.parsed.positive).toBe(true);
    await tellPatient(created.body.case_id);
    const asap = refMessage({ control: "R-2004-N", status: "P^Pending", referral: "REF-2004-9", patient: "NX-P-2004" }).replace("R^Routine", "A^ASAP");
    expect((await ingest(asap)).body.outcome).toBe("applied");
    const accepted = await ingest(refMessage({ control: "R-2004-A", status: "A^Accepted", referral: "REF-2004-9", patient: "NX-P-2004" }));
    expect(accepted.body.events[0]).toMatchObject({ type: "referral_accepted", stage: "referral_accepted" });
    const referral = await db.prepare("SELECT priority, status FROM referrals WHERE id = 'REF-2004-9'").get<Json>();
    expect(referral).toMatchObject({ priority: "asap", status: "accepted" });
  });

  it("every sample file in data/hl7 is answered without an error", async () => {
    const files = readdirSync(join(process.cwd(), "data", "hl7")).filter((f) => f.endsWith(".hl7"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.length).toBeLessThanOrEqual(15);
    for (const file of files) {
      const { status, body } = await ingest(sample(file));
      expect(status, file).toBe(200);
      expect(["created_case", "applied", "no_action", "queued_unstitched"], file).toContain(body.outcome);
    }
    const accepted = await ingest(sample("11-ref-accepted-unknown-referral.hl7"));
    expect(accepted.body.reason_code).toBe("unknown_referral");
    const noCase = await ingest(sample("12-ref-new-no-open-case.hl7"));
    expect(noCase.body.reason_code).toBe("no_open_case");
  });
});
