import { createHash } from "node:crypto";
import type { InStatement } from "@libsql/client";
import { databaseLabel, getDb, type Db } from "./db.js";
import { foldEvents, type CaseState, type RecordedEvent } from "./engine.js";
// TICKET-10
import { composeMessage } from "./outreach/ladder.js";

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
  // TICKET-10: the patient, acting only through the link in the outreach message.
  { id: "act_patient", role: "patient", display_name: "Patient (via link)" },
];

// ---- TICKET-10: CX-1001's automated message ------------------------------------------
// The silent patient got the ladder's step 1 on 16 Nov and has not answered. The text is
// composed by the same function the ladder uses, so the seeded message is exactly what
// the template sends. The token is fixed so the demo link is the same after every reset.
export const CX1001_TOKEN = "hq7m3kx9va";
const CX1001_RUN = "result_received@2026-11-15T09:12:00+07:00";
const CX1001_MESSAGE_AT = "2026-11-16T10:20:00+07:00";
const CX1001_MESSAGE = composeMessage(
  { patient_name: "Y. Al Hammadi", patient_language: "ar" },
  CX1001_TOKEN,
  CX1001_MESSAGE_AT,
);
// ---- end TICKET-10 --------------------------------------------------------------------

type SeedEvent = {
  id: string;
  type: string;
  actor_id: string;
  at: string;
  summary: string;
  // Extra payload the engine reads back on replay: the owner a creation or hand-over
  // names, the outcome a closure proposal carries.
  payload?: Record<string, unknown>;
};

type SeedCase = {
  id: string;
  patient_name: string;
  patient_age: number;
  patient_language: string;
  // What the story says the case looks like at day 0. The seed does not write these: it
  // replays `events` through the engine and refuses to run if the replay disagrees, so
  // the cached columns are always what rebuildCase would produce (TICKET-03).
  expect: {
    stage: string;
    owner_actor_id: string | null;
    final_outcome: string | null;
  };
  events: SeedEvent[];
};

const CASES: SeedCase[] = [
  {
    // 1. The silent patient: the result is in and the automated Arabic message (TICKET-10
    // step 1) goes unanswered, so the patient has not been told yet and the case sits at
    // result_received. Advancing the clock climbs the ladder: staff call, then navigator.
    id: "CX-1001",
    patient_name: "Y. Al Hammadi",
    patient_age: 58,
    patient_language: "ar",
    expect: { stage: "result_received", owner_actor_id: "act_005", final_outcome: null },
    events: [
      {
        id: "e_1001_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-11-15T09:12:00+07:00",
        summary: "Case created from FIT result 4412/26",
        payload: { owner_actor_id: "act_005" },
      },
      {
        id: "e_1001_2",
        type: "outreach_message_sent",
        actor_id: "act_system",
        at: CX1001_MESSAGE_AT,
        summary: CX1001_MESSAGE.summary,
        payload: { run_id: CX1001_RUN, step: "message", ...CX1001_MESSAGE },
      },
    ],
  },
  {
    // 2. Referral rejected by the receiving hospital while the patient moves clinic: the
    // case goes back to the step before the referral with no owner (TICKET-08 trigger 1).
    id: "CX-1002",
    patient_name: "R. Kumar",
    patient_age: 47,
    patient_language: "en",
    expect: { stage: "patient_notified", owner_actor_id: null, final_outcome: null },
    events: [
      {
        id: "e_1002_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-11-12T08:00:00+07:00",
        summary: "Case created from FIT result 4377/26 at clinic A",
        payload: { owner_actor_id: "act_001" },
      },
      {
        id: "e_1002_2",
        type: "patient_notified",
        actor_id: "act_001",
        at: "2026-11-13T09:30:00+07:00",
        summary: "Patient told the result by phone and agreed to a colonoscopy",
      },
      {
        id: "e_1002_3",
        type: "referral_sent",
        actor_id: "act_001",
        at: "2026-11-14T10:00:00+07:00",
        summary: "Referral sent to hospital B through e-Referral",
      },
      {
        id: "e_1002_4",
        type: "referral_rejected",
        actor_id: "act_system",
        at: "2026-11-16T15:40:00+07:00",
        summary: "Referral rejected by hospital B: colonoscopy request incomplete; patient moved to clinic B",
      },
    ],
  },
  {
    // 3. "Done" that is not done: every step was recorded as complete and closure was
    // proposed, but the colonoscopy report says the caecum was never reached. The
    // cached verification proposes reopening; the physician has not decided yet.
    id: "CX-1003",
    patient_name: "L. Fernandes",
    patient_age: 52,
    patient_language: "en",
    expect: {
      stage: "closure_proposed",
      owner_actor_id: "act_003",
      final_outcome: "returned_to_routine_screening",
    },
    events: [
      {
        id: "e_1003_1",
        type: "case_created",
        actor_id: "act_system",
        at: "2026-10-14T09:00:00+07:00",
        summary: "Case created from FIT result 4302/26",
        payload: { owner_actor_id: "act_005" },
      },
      {
        id: "e_1003_2",
        type: "patient_notified",
        actor_id: "act_005",
        at: "2026-10-15T10:30:00+07:00",
        summary: "Patient told the result in clinic",
      },
      {
        id: "e_1003_3",
        type: "referral_sent",
        actor_id: "act_005",
        at: "2026-10-16T09:00:00+07:00",
        summary: "Referral sent to the endoscopy unit through e-Referral",
      },
      {
        id: "e_1003_4",
        type: "referral_accepted",
        actor_id: "act_system",
        at: "2026-10-17T14:00:00+07:00",
        summary: "Endoscopy unit accepted the referral",
      },
      {
        id: "e_1003_5",
        type: "colonoscopy_booked",
        actor_id: "act_005",
        at: "2026-10-19T11:00:00+07:00",
        summary: "Colonoscopy booked for 5 Nov",
      },
      {
        id: "e_1003_6",
        type: "colonoscopy_performed",
        actor_id: "act_005",
        at: "2026-11-05T10:00:00+07:00",
        summary: "Colonoscopy recorded as completed",
      },
      {
        id: "e_1003_7",
        type: "pathology_ordered",
        actor_id: "act_005",
        at: "2026-11-05T10:30:00+07:00",
        summary: "Pathology step opened by the endoscopy unit",
      },
      {
        id: "e_1003_8",
        type: "pathology_received",
        actor_id: "act_system",
        at: "2026-11-10T09:00:00+07:00",
        summary: "Pathology return received: no specimen submitted",
      },
      {
        id: "e_1003_9",
        type: "owner_assigned",
        actor_id: "act_005",
        at: "2026-11-10T09:05:00+07:00",
        summary: "Handed to Dr. Fulan for the closure decision",
        payload: { owner_actor_id: "act_003", previous_owner_actor_id: "act_005" },
      },
      {
        id: "e_1003_10",
        type: "closure_proposed",
        actor_id: "act_005",
        at: "2026-11-12T09:00:00+07:00",
        summary: "Closure proposed: returned to routine screening",
        payload: { outcome: "returned_to_routine_screening" },
      },
      {
        id: "e_1003_11",
        type: "extraction_completed",
        actor_id: "act_system",
        at: "2026-11-17T09:14:00+07:00",
        summary: "2 findings extracted with citations; proposal reopen",
      },
    ],
  },
];

const ROLE_OF = new Map(ACTORS.map((a) => [a.id, a.role]));

function recorded(e: SeedEvent): RecordedEvent {
  return {
    type: e.type,
    actor_id: e.actor_id,
    actor_role: ROLE_OF.get(e.actor_id) ?? "system",
    occurred_at: e.at,
    payload: { ...(e.payload ?? {}), summary: e.summary },
  };
}

// The cached columns for one seed case, computed the way rebuildCase computes them.
function replay(c: SeedCase): CaseState {
  const state = foldEvents(c.events.map(recorded));
  if (state === null) throw new Error(`Seed case ${c.id} has no case creation event.`);
  const mismatch = (["stage", "owner_actor_id", "final_outcome"] as const).filter(
    (key) => state[key] !== c.expect[key],
  );
  if (mismatch.length > 0) {
    throw new Error(
      `Seed case ${c.id} replays to ${JSON.stringify(state)}, which disagrees with its story on ` +
        mismatch.join(", "),
    );
  }
  return state;
}

const REPORT_TEXT =
  "Procedure: colonoscopy. Preparation was inadequate. The cecum was not reached. " +
  "No polyp identified in the examined segment. Recommend repeat examination.";

// Offsets are located in the text, never typed by hand: a citation that points at the
// wrong sentence is worse than no citation, and a hardcoded offset silently rots.
function offsetOf(quote: string): [number, number] {
  const start = REPORT_TEXT.indexOf(quote);
  if (start < 0) throw new Error(`Seed quote not found in report text: ${quote}`);
  return [start, start + quote.length];
}

const CACHED_FIELDS = [
  {
    key: "adequate_prep",
    value: "no",
    quote: "Preparation was inadequate.",
    quote_offset: offsetOf("Preparation was inadequate."),
    source: "colonoscopy-report-05-11.pdf",
    read_at: "2026-11-17T09:14:00+07:00",
    validated: true,
  },
  {
    key: "complete_exam",
    value: "no",
    quote: "The cecum was not reached.",
    quote_offset: offsetOf("The cecum was not reached."),
    source: "colonoscopy-report-05-11.pdf",
    read_at: "2026-11-17T09:14:00+07:00",
    validated: true,
  },
  {
    key: "pathology_available",
    value: "unknown",
    quote: null,
    quote_offset: [0, 0],
    source: "colonoscopy-report-05-11.pdf",
    read_at: "2026-11-17T09:14:00+07:00",
    validated: false,
  },
];

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function seed(
  target?: Db,
): Promise<{ actors: number; cases: number; events: number }> {
  const db = target ?? (await getDb());
  const statements: InStatement[] = [];

  const upsertActor = db.prepare(
    `INSERT INTO actors (id, role, display_name) VALUES (@id, @role, @display_name)
     ON CONFLICT(id) DO UPDATE SET role = excluded.role, display_name = excluded.display_name`,
  );

  const upsertCase = db.prepare(
    `INSERT INTO cases (
       id, patient_name, patient_age, patient_language, pathway_id,
       owner_actor_id, stage, status, final_outcome, stage_entered_at, created_at, updated_at
     ) VALUES (
       @id, @patient_name, @patient_age, @patient_language, @pathway_id,
       @owner_actor_id, @stage, @status, @final_outcome, @stage_entered_at, @created_at, @updated_at
     )
     ON CONFLICT(id) DO UPDATE SET
       patient_name = excluded.patient_name,
       patient_age = excluded.patient_age,
       patient_language = excluded.patient_language,
       owner_actor_id = excluded.owner_actor_id,
       stage = excluded.stage,
       status = excluded.status,
       final_outcome = excluded.final_outcome,
       stage_entered_at = excluded.stage_entered_at,
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

  // One atomic batch: a seed that fails halfway leaves the database as it was.
  {
    for (const a of ACTORS) statements.push(upsertActor.bind(a));

    for (const c of CASES) {
      const state = replay(c);
      statements.push(upsertCase.bind({
        id: c.id,
        patient_name: c.patient_name,
        patient_age: c.patient_age,
        patient_language: c.patient_language,
        pathway_id: "fit-colonoscopy",
        owner_actor_id: state.owner_actor_id,
        stage: state.stage,
        status: state.status,
        final_outcome: state.final_outcome,
        stage_entered_at: state.stage_entered_at,
        created_at: c.events[0]?.at ?? NOW,
        updated_at: NOW,
      }));

      for (const e of c.events) {
        const event = recorded(e);
        statements.push(insertEvent.bind({
          id: e.id,
          case_id: c.id,
          type: event.type,
          actor_id: event.actor_id,
          actor_role: event.actor_role,
          occurred_at: event.occurred_at,
          recorded_at: e.at,
          payload: JSON.stringify(event.payload),
        }));
      }
    }

    statements.push(upsertDocument.bind({
      id: "d_1003",
      case_id: "CX-1003",
      kind: "colonoscopy",
      title: "Colonoscopy report",
      text: REPORT_TEXT,
    }));

    // Cached so the demo never needs the network (TICKET-17).
    statements.push(upsertExtraction.bind({
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
    }));

    // ---- TICKET-10: the link and the fired message step for CX-1001 ----------------
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO outreach_links (token, case_id, created_at) VALUES (?, ?, ?)")
        .bind(CX1001_TOKEN, "CX-1001", CX1001_MESSAGE_AT),
      db
        .prepare(
          `INSERT OR IGNORE INTO outreach_steps
             (id, case_id, run_id, step, fired_at, reason, task_id, event_id)
           VALUES (?, ?, ?, 'message', ?, 'case_at_stage', NULL, ?)`,
        )
        .bind("os_1001_message", "CX-1001", CX1001_RUN, CX1001_MESSAGE_AT, "e_1001_2"),
    );
    // ---- end TICKET-10 ------------------------------------------------------------

    // The owner's standing to-do on the case (tell the patient). The ladder's own call and
    // navigator tasks are created by tick() when their deadlines pass.
    statements.push(upsertTask.bind({
      id: "t_1001_outreach",
      case_id: "CX-1001",
      kind: "patient_outreach",
      owner_actor_id: "act_005",
      due_at: "2026-11-18T09:00:00+07:00",
      status: "open",
    }));
    statements.push(upsertTask.bind({
      id: "t_1002_owner",
      case_id: "CX-1002",
      kind: "assign_owner",
      owner_actor_id: null,
      due_at: "2026-11-18T12:00:00+07:00",
      status: "open",
    }));
    statements.push(upsertTask.bind({
      id: "t_1003_closure",
      case_id: "CX-1003",
      kind: "confirm_closure",
      owner_actor_id: "act_003",
      due_at: "2026-11-17T14:00:00+07:00",
      status: "open",
    }));
  }

  await db.batch(statements);

  const count = async (table: string) =>
    (await db.prepare(`SELECT count(*) AS n FROM ${table}`).get<{ n: number }>())?.n ?? 0;

  return {
    actors: await count("actors"),
    cases: await count("cases"),
    events: await count("events"),
  };
}

// `tsx server/seed.ts` prints what it did; importing it (tests) just gets the function.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("server/seed.ts")) {
  const result = await seed();
  console.log(`seeded ${databaseLabel()}`);
  console.log(
    `actors=${result.actors} cases=${result.cases} events=${result.events} demo_day=${DEMO_DAY_ZERO}`,
  );
}
