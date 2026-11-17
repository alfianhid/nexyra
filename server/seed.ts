import { createHash } from "node:crypto";
import { databaseFile, getDb } from "./db";

// TICKET-17: three cases, all fictional. Running this file twice must not duplicate
// anything, so every row has a fixed id and every write is an upsert.

const NOW = "2026-11-17T11:42:00+07:00";
const DEMO_DAY_ZERO = "2026-11-17T11:42:00+07:00";

const ACTORS = [
  { id: "act_001", role: "coordination_staff", display_name: "R. Haddad" },
  { id: "act_002", role: "navigator", display_name: "Nur H." },
  { id: "act_003", role: "responsible_physician", display_name: "Dr. Fulan" },
  { id: "act_004", role: "program_manager", display_name: "A. Al Suwaidi" },
  { id: "act_005", role: "coordination_staff", display_name: "S. Al Ali" },
  { id: "act_system", role: "system", display_name: "system" },
];

type SeedCase = {
  id: string;
  patient_name: string;
  patient_age: number;
  patient_language: string;
  owner_actor_id: string | null;
  stage: string;
  status: string;
  events: { id: string; type: string; actor_id: string; at: string; summary: string }[];
};

const CASES: SeedCase[] = [
  {
    // 1. The silent patient — unanswered messages, then a recorded fear of the prep.
    id: "CX-1001",
    patient_name: "Y. Al Hammadi",
    patient_age: 58,
    patient_language: "ar",
    owner_actor_id: "act_005",
    stage: "result_received",
    status: "open",
    events: [
      {
        id: "e_1001_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-11-15T09:12:00+07:00",
        summary: "Case created from FIT result 4412/26",
      },
      {
        id: "e_1001_2",
        type: "outreach_attempted",
        actor_id: "act_005",
        at: "2026-11-16T10:20:00+07:00",
        summary: "First call unanswered, SMS sent in Arabic",
      },
    ],
  },
  {
    // 2. Referral rejected, patient moves clinic — ends up unowned.
    id: "CX-1002",
    patient_name: "R. Kumar",
    patient_age: 47,
    patient_language: "en",
    owner_actor_id: null,
    stage: "result_received",
    status: "open",
    events: [
      {
        id: "e_1002_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-11-16T08:00:00+07:00",
        summary: "Referral received from clinic A, insufficient data",
      },
      {
        id: "e_1002_2",
        type: "referral_rejected",
        actor_id: "act_system",
        at: "2026-11-16T15:40:00+07:00",
        summary: "Referral rejected: colonoscopy report missing; patient moved to clinic B",
      },
    ],
  },
  {
    // 3. "Done" that is not done — procedure marked finished, verification proposes reopen.
    id: "CX-1003",
    patient_name: "L. Fernandes",
    patient_age: 52,
    patient_language: "en",
    owner_actor_id: "act_003",
    stage: "closure_proposed",
    status: "open",
    events: [
      {
        id: "e_1003_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-11-12T09:00:00+07:00",
        summary: "Case created from FIT result 4302/26",
      },
      {
        id: "e_1003_2",
        type: "colonoscopy_performed",
        actor_id: "act_005",
        at: "2026-11-15T10:00:00+07:00",
        summary: "Colonoscopy recorded as completed",
      },
      {
        id: "e_1003_3",
        type: "extraction_completed",
        actor_id: "act_system",
        at: "2026-11-17T09:14:00+07:00",
        summary: "2 findings extracted with citations; proposal reopen",
      },
    ],
  },
];

const REPORT_TEXT =
  "Procedure: colonoscopy. Preparation was inadequate. The cecum was not reached. " +
  "No polyp identified in the examined segment. Recommend repeat examination.";

const CACHED_FIELDS = [
  {
    key: "adequate_prep",
    value: "no",
    quote: "Preparation was inadequate.",
    quote_offset: [29, 59],
    source: "colonoscopy-report-15-11.pdf",
    read_at: "2026-11-17T09:14:00+07:00",
    validated: true,
  },
  {
    key: "complete_exam",
    value: "no",
    quote: "The cecum was not reached.",
    quote_offset: [60, 87],
    source: "colonoscopy-report-15-11.pdf",
    read_at: "2026-11-17T09:14:00+07:00",
    validated: true,
  },
  {
    key: "pathology_available",
    value: "unknown",
    quote: null,
    quote_offset: [0, 0],
    source: "colonoscopy-report-15-11.pdf",
    read_at: "2026-11-17T09:14:00+07:00",
    validated: false,
  },
];

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function seed(): { actors: number; cases: number; events: number } {
  const db = getDb();

  const upsertActor = db.prepare(
    `INSERT INTO actors (id, role, display_name) VALUES (@id, @role, @display_name)
     ON CONFLICT(id) DO UPDATE SET role = excluded.role, display_name = excluded.display_name`,
  );

  const upsertCase = db.prepare(
    `INSERT INTO cases (
       id, patient_name, patient_age, patient_language, pathway_id,
       owner_actor_id, stage, status, stage_entered_at, created_at, updated_at
     ) VALUES (
       @id, @patient_name, @patient_age, @patient_language, @pathway_id,
       @owner_actor_id, @stage, @status, @created_at, @created_at, @updated_at
     )
     ON CONFLICT(id) DO UPDATE SET
       patient_name = excluded.patient_name,
       patient_age = excluded.patient_age,
       patient_language = excluded.patient_language,
       owner_actor_id = excluded.owner_actor_id,
       stage = excluded.stage,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  );

  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO events (
       id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload
     ) VALUES (
       @id, @case_id, @type, @actor_id, @actor_role, @occurred_at, @recorded_at, @payload
     )`,
  );

  const upsertDocument = db.prepare(
    `INSERT INTO documents (id, case_id, kind, title, text)
     VALUES (@id, @case_id, @kind, @title, @text)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, text = excluded.text`,
  );

  const upsertExtraction = db.prepare(
    `INSERT INTO extractions (
       id, case_id, document_id, prompt_version, model, proposal,
       proposal_reason, fields, text_hash, created_at
     ) VALUES (
       @id, @case_id, @document_id, @prompt_version, @model, @proposal,
       @proposal_reason, @fields, @text_hash, @created_at
     )
     ON CONFLICT(text_hash) DO UPDATE SET
       proposal = excluded.proposal,
       proposal_reason = excluded.proposal_reason,
       fields = excluded.fields`,
  );

  const upsertTask = db.prepare(
    `INSERT INTO tasks (id, case_id, kind, owner_actor_id, due_at, status)
     VALUES (@id, @case_id, @kind, @owner_actor_id, @due_at, @status)
     ON CONFLICT(id) DO UPDATE SET
       owner_actor_id = excluded.owner_actor_id,
       due_at = excluded.due_at,
       status = excluded.status`,
  );

  const run = db.transaction(() => {
    for (const a of ACTORS) upsertActor.run(a);

    for (const c of CASES) {
      upsertCase.run({
        id: c.id,
        patient_name: c.patient_name,
        patient_age: c.patient_age,
        patient_language: c.patient_language,
        pathway_id: "fit-colonoscopy",
        owner_actor_id: c.owner_actor_id,
        stage: c.stage,
        status: c.status,
        created_at: c.events[0]?.at ?? NOW,
        updated_at: NOW,
      });

      const roles = new Map(ACTORS.map((a) => [a.id, a.role]));
      for (const e of c.events) {
        insertEvent.run({
          id: e.id,
          case_id: c.id,
          type: e.type,
          actor_id: e.actor_id,
          actor_role: roles.get(e.actor_id) ?? "system",
          occurred_at: e.at,
          recorded_at: e.at,
          payload: JSON.stringify({ summary: e.summary }),
        });
      }
    }

    upsertDocument.run({
      id: "d_1003",
      case_id: "CX-1003",
      kind: "colonoscopy",
      title: "Colonoscopy report",
      text: REPORT_TEXT,
    });

    // Cached so the demo never needs the network (TICKET-17).
    upsertExtraction.run({
      id: "x_1003",
      case_id: "CX-1003",
      document_id: "d_1003",
      prompt_version: "v1",
      model: "deepseek/deepseek-v4.1-flash-1017",
      proposal: "reopen",
      proposal_reason: "Incomplete exam and inadequate prep",
      fields: JSON.stringify(CACHED_FIELDS),
      text_hash: textHash(REPORT_TEXT),
      created_at: "2026-11-17T09:14:00+07:00",
    });

    upsertTask.run({
      id: "t_1001_outreach",
      case_id: "CX-1001",
      kind: "patient_outreach",
      owner_actor_id: "act_005",
      due_at: "2026-11-18T09:00:00+07:00",
      status: "open",
    });
    upsertTask.run({
      id: "t_1002_owner",
      case_id: "CX-1002",
      kind: "assign_owner",
      owner_actor_id: null,
      due_at: "2026-11-18T12:00:00+07:00",
      status: "open",
    });
    upsertTask.run({
      id: "t_1003_closure",
      case_id: "CX-1003",
      kind: "confirm_closure",
      owner_actor_id: "act_003",
      due_at: "2026-11-17T14:00:00+07:00",
      status: "open",
    });
  });

  run();

  const count = (table: string) =>
    (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  return { actors: count("actors"), cases: count("cases"), events: count("events") };
}

// `tsx server/seed.ts` prints what it did; importing it (tests) just gets the function.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("server/seed.ts")) {
  const result = seed();
  console.log(`seeded ${databaseFile()}`);
  console.log(
    `actors=${result.actors} cases=${result.cases} events=${result.events} demo_day=${DEMO_DAY_ZERO}`,
  );
}
