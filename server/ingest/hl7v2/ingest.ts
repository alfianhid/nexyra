import type { Db } from "../../db.js";
import { getClock } from "../../clock.js";
import { isClosed } from "../../engine.js";
import { DEFAULT_PATHWAY } from "../../pathways/index.js";
import { HttpError } from "../../errors.js";
import {
  SYSTEM_ACTOR,
  applyEvent,
  createCase,
  queueUnstitched,
  type IncomingResource,
  type WriteActor,
} from "../../events.js";
import {
  Hl7Problem,
  fallbackControlId,
  normaliseHl7,
  parseHl7,
  segmentsOf,
  splitMessages,
  type ParsedMessage,
  type ParsedOru,
  type ParsedRef,
  type SegmentView,
} from "./parse.js";

// TICKET-25: HL7 v2 REF and ORU messages into the same case engine the FHIR ingest uses.
//
// - ORU with a positive FIT: `createCase` (one case, the template's initial owner).
// - REF pending: `referral_sent` on the patient's open case.
// - REF accepted / rejected: `referral_accepted` / `referral_rejected` on the case that
//   carries that referral. A rejection clears the owner, so the TICKET-08 machinery
//   (ownership gap, assign-owner task, unowned list) takes over; nothing is special-cased.
// - Anything else (unparseable, unsupported, no matching case, an illegal step) goes to
//   the `unstitched` queue of TICKET-08 with a reason. The app never throws for a message.
// - A message already applied (same sending facility + control id) is answered
//   `duplicate: true` and writes nothing.
//
// Every write goes through server/events.ts. This file parses and matches.

export type Hl7Outcome = "created_case" | "applied" | "no_action" | "queued_unstitched";

export type Hl7Result = {
  raw: string;
  segments: SegmentView[];
  message_type: string | null;
  control_id: string;
  outcome: Hl7Outcome;
  parsed: ParsedMessage | null;
  events: { event_id: string; type: string; case_id: string; stage: string }[];
  case_id?: string;
  unstitched_id?: string;
  reason_code?: string;
  reason?: string;
  duplicate?: boolean;
};

const RESOURCE_TYPE = "HL7v2";

type OpenCase = { id: string; stage: string; status: string; provider_id: string | null; owner_actor_id: string | null };

function hl7Payload(parsed: ParsedMessage, actor: WriteActor, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hl7: {
      key: keyOf(parsed.sending_facility, parsed.control_id),
      control_id: parsed.control_id,
      message_type: parsed.kind,
      sending_facility: parsed.sending_facility,
      patient_identifier: parsed.patient_identifier,
      ...(parsed.kind === "REF" ? { referral_id: parsed.referral_id } : {}),
    },
    ingested_by: actor.actor_id,
    ...extra,
  };
}

function keyOf(facility: string | null, controlId: string): string {
  return `${RESOURCE_TYPE}/${facility ?? "-"}/${controlId}`;
}

async function alreadyApplied(db: Db, key: string): Promise<{ case_id: string; id: string } | undefined> {
  return db
    .prepare("SELECT case_id, id FROM events WHERE json_extract(payload, '$.hl7.key') = ? ORDER BY rowid LIMIT 1")
    .get<{ case_id: string; id: string }>(key);
}

async function stageOf(db: Db, caseId: string): Promise<string> {
  const row = await db.prepare("SELECT stage FROM cases WHERE id = ?").get<{ stage: string }>(caseId);
  return row?.stage ?? "";
}

async function openCaseFor(db: Db, patientIdentifier: string): Promise<OpenCase | undefined> {
  const rows = await db
    .prepare(
      // FIT results and colonoscopy referrals only ever concern the FIT pathway: an open case
        // on another pathway (a mammography recall) is not a reason to hold them (TICKET-18).
        `SELECT id, stage, status, provider_id, owner_actor_id FROM cases
        WHERE patient_identifier = ? AND pathway_id = ? ORDER BY rowid DESC`,
    )
    .all<OpenCase>(patientIdentifier, DEFAULT_PATHWAY.id);
  return rows.find((row) => !isClosed(row));
}

async function ownerOf(db: Db, caseId: string): Promise<WriteActor | null> {
  const row = await db
    .prepare(
      `SELECT a.id, a.role, a.display_name FROM cases c JOIN actors a ON a.id = c.owner_actor_id WHERE c.id = ?`,
    )
    .get<{ id: string; role: string; display_name: string }>(caseId);
  return row ? ({ actor_id: row.id, role: row.role, display_name: row.display_name } as WriteActor) : null;
}

async function providerExists(db: Db, id: string | null): Promise<boolean> {
  if (id === null) return false;
  return (await db.prepare("SELECT id FROM providers WHERE id = ?").get(id)) !== undefined;
}

function ageFrom(dob: string | null, now: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(dob ?? "");
  const today = new Date(now);
  if (!match || Number.isNaN(today.getTime())) return 0;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = today.getUTCFullYear() - year;
  if (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) age -= 1;
  return Math.max(age, 0);
}

function languageOf(code: string | null): string {
  const two = (code ?? "").slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(two) ? two : "en";
}

function caseIdFor(oru: ParsedOru): string {
  const base = (oru.accession ?? oru.control_id).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `CX-H7-${base || oru.control_id.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

type Attempt =
  | { kind: "ok"; outcome: Hl7Outcome; caseId: string; events: { event_id: string; type: string }[] }
  | { kind: "no_action"; code: string; reason: string }
  | { kind: "queue"; code: string; reason: string };

async function applyOru(db: Db, oru: ParsedOru, actor: WriteActor): Promise<Attempt> {
  if (oru.positive === null) {
    return { kind: "queue", code: "fit_result_unclear", reason: "The FIT observation is neither clearly positive nor negative (OBX-5, OBX-8)." };
  }
  if (!oru.positive) {
    return { kind: "no_action", code: "fit_negative", reason: "The FIT result is negative; no case is created." };
  }
  const existing = await openCaseFor(db, oru.patient_identifier);
  if (existing) {
    return { kind: "queue", code: "open_case_exists", reason: `Patient ${oru.patient_identifier} already has the open case ${existing.id}; a second positive FIT is held for review.` };
  }
  const providerId = (await providerExists(db, oru.sending_facility)) ? (oru.sending_facility as string) : undefined;
  const now = (await getClock(db)).now;
  const caseId = caseIdFor(oru);
  const created = await createCase(db, {
    caseId,
    patient: {
      name: oru.patient_name ?? oru.patient_identifier,
      age: ageFrom(oru.patient_dob, now),
      language: languageOf(oru.patient_language),
    },
    actor: SYSTEM_ACTOR,
    ...(providerId ? { providerId } : {}),
    patientIdentifier: oru.patient_identifier,
    payload: {
      ...hl7Payload(oru, actor),
      summary: `Case created from HL7 ORU: positive FIT${oru.accession ? ` ${oru.accession}` : ""}${providerId ? ` at ${providerId}` : ""}`,
    },
  });
  return { kind: "ok", outcome: "created_case", caseId, events: [{ event_id: created.recorded, type: "case_created" }] };
}

async function applyRef(db: Db, ref: ParsedRef, actor: WriteActor): Promise<Attempt> {
  if (ref.status === "pending") {
    const target = await openCaseFor(db, ref.patient_identifier);
    if (!target) {
      return { kind: "queue", code: "no_open_case", reason: `No open case for patient ${ref.patient_identifier}; the referral ${ref.referral_id} has nothing to attach to.` };
    }
    if (ref.priority === null) {
      return { kind: "queue", code: "missing_priority", reason: "RF1-2 (priority) is empty or not routine, ASAP or STAT." };
    }
    if (ref.specialty === null) {
      return { kind: "queue", code: "missing_specialty", reason: "RF1-3 carries no SNOMED CT specialty code." };
    }
    if (!(await providerExists(db, ref.receiving_provider_id))) {
      return { kind: "queue", code: "unknown_receiving_provider", reason: `The receiving provider "${ref.receiving_provider_id ?? ""}" (PRD, role RT) is not a known provider.` };
    }
    // Sending a referral is a human act: the template does not let the system role record
    // it. The message is the sending clinic's e-Referral, so it is attributed to the
    // case's current owner (who is the sender); the ingesting actor is kept in the payload.
    const sender = await ownerOf(db, target.id);
    if (!sender) {
      return { kind: "queue", code: "case_has_no_owner", reason: `Case ${target.id} has no owner to attribute the sent referral to; assign an owner first.` };
    }
    const recorded = await applyEvent(db, {
      caseId: target.id,
      type: "referral_sent",
      actor: sender,
      payload: {
        ...hl7Payload(ref, actor),
        summary: `Referral ${ref.referral_id} received by HL7 REF`,
        referral: {
          referral_id: ref.referral_id,
          to_provider_id: ref.receiving_provider_id,
          status: "pending",
          priority: ref.priority,
          specialty: ref.specialty,
        },
      },
    });
    return { kind: "ok", outcome: "applied", caseId: target.id, events: [{ event_id: recorded.recorded, type: "referral_sent" }] };
  }

  const row = await db
    .prepare(
      `SELECT r.id AS referral_id, r.status AS referral_status, c.id AS case_id, c.patient_identifier, c.stage, c.status
         FROM referrals r JOIN cases c ON c.id = r.case_id WHERE r.id = ?`,
    )
    .get<{ referral_id: string; referral_status: string; case_id: string; patient_identifier: string | null; stage: string; status: string }>(ref.referral_id);
  if (!row) return { kind: "queue", code: "unknown_referral", reason: `No case carries the referral ${ref.referral_id}.` };
  if (row.patient_identifier !== ref.patient_identifier) {
    return { kind: "queue", code: "patient_mismatch", reason: `Referral ${ref.referral_id} belongs to a case for a different patient identifier.` };
  }
  if (isClosed(row)) return { kind: "queue", code: "case_closed", reason: `The case for referral ${ref.referral_id} is closed.` };
  if (row.referral_status === ref.status) {
    return { kind: "no_action", code: "already_in_state", reason: `Referral ${ref.referral_id} is already ${ref.status}.` };
  }

  const type = ref.status === "accepted" ? "referral_accepted" : "referral_rejected";
  const reason = ref.reason ?? (ref.status === "rejected" ? "Referral rejected by the receiving provider (HL7 REF)" : null);
  const recorded = await applyEvent(db, {
    caseId: row.case_id,
    type,
    actor: SYSTEM_ACTOR,
    payload: {
      ...hl7Payload(ref, actor),
      summary: `Referral ${ref.referral_id} ${ref.status} by HL7 REF${ref.reason ? `: ${ref.reason}` : ""}`,
      ...(reason ? { reason } : {}),
    },
  });
  return { kind: "ok", outcome: "applied", caseId: row.case_id, events: [{ event_id: recorded.recorded, type }] };
}

function queued(partial: Hl7Result["parsed"] | null): { source: string | null; patient: string | null; referral: string | null } {
  return {
    source: partial?.sending_facility ?? null,
    patient: partial?.patient_identifier ?? null,
    referral: partial?.kind === "REF" ? partial.referral_id : null,
  };
}

// One message. Never throws for a bad message; a database failure still does.
export async function ingestHl7Message(db: Db, rawText: string, actor: WriteActor = SYSTEM_ACTOR): Promise<Hl7Result> {
  const raw = normaliseHl7(rawText);
  const segments = segmentsOf(raw);
  const messageType = /^MSH\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|([^|]*)/.exec(raw.split("\r")[0] ?? "")?.[1] ?? null;
  let parsed: ParsedMessage | null = null;
  let controlId = fallbackControlId(raw);
  let facility: string | null = null;
  let patient: string | null = null;
  let referral: string | null = null;

  const queueIt = async (code: string, reason: string): Promise<Hl7Result> => {
    const info = parsed ? queued(parsed) : { source: facility, patient, referral };
    const providerKnown = await providerExists(db, info.source);
    const resource: IncomingResource = {
      resource_type: RESOURCE_TYPE,
      resource_id: `${facility ?? "-"}/${controlId}`,
      status: "received",
      source_provider_id: providerKnown ? info.source : null,
      patient_identifier: info.patient,
      referral_id: info.referral,
      summary: `HL7 ${messageType ?? "message"} ${controlId}`,
      raw: { hl7v2: raw.split("\r"), message_type: messageType, control_id: controlId },
    };
    const result = await queueUnstitched(db, { resource, reasonCode: code, reason });
    return {
      raw,
      segments,
      message_type: messageType,
      control_id: controlId,
      outcome: "queued_unstitched",
      parsed,
      events: [],
      unstitched_id: result.unstitched_id,
      reason_code: code,
      reason,
      ...(result.duplicate ? { duplicate: true } : {}),
    };
  };

  try {
    parsed = parseHl7(raw);
  } catch (error) {
    if (error instanceof Hl7Problem) {
      controlId = error.partial.control_id ?? controlId;
      facility = error.partial.sending_facility ?? null;
      patient = error.partial.patient_identifier ?? null;
      referral = error.partial.referral_id ?? null;
      return queueIt(error.code, error.message);
    }
    return queueIt("unreadable", error instanceof Error ? error.message : String(error));
  }
  controlId = parsed.control_id;
  facility = parsed.sending_facility;

  const key = keyOf(parsed.sending_facility, parsed.control_id);
  const previous = await alreadyApplied(db, key);
  if (previous) {
    return {
      raw,
      segments,
      message_type: messageType,
      control_id: controlId,
      outcome: "applied",
      parsed,
      events: [],
      case_id: previous.case_id,
      duplicate: true,
    };
  }

  let attempt: Attempt;
  try {
    attempt = parsed.kind === "ORU" ? await applyOru(db, parsed, actor) : await applyRef(db, parsed, actor);
  } catch (error) {
    // A step the pathway does not allow now (the case is not at the right stage, the
    // referral id is taken, a role may not record it): held, not lost.
    if (error instanceof HttpError) return queueIt(error.code, error.message);
    throw error;
  }

  if (attempt.kind === "queue") return queueIt(attempt.code, attempt.reason);
  if (attempt.kind === "no_action") {
    return {
      raw,
      segments,
      message_type: messageType,
      control_id: controlId,
      outcome: "no_action",
      parsed,
      events: [],
      reason_code: attempt.code,
      reason: attempt.reason,
    };
  }

  await db
    .prepare(
      `UPDATE unstitched SET status = 'stitched', stitched_case_id = ?
        WHERE resource_type = ? AND resource_id = ? AND status = 'queued'`,
    )
    .run(attempt.caseId, RESOURCE_TYPE, `${facility ?? "-"}/${controlId}`);
  const stage = await stageOf(db, attempt.caseId);
  return {
    raw,
    segments,
    message_type: messageType,
    control_id: controlId,
    outcome: attempt.outcome,
    parsed,
    case_id: attempt.caseId,
    events: attempt.events.map((e) => ({ ...e, case_id: attempt.caseId, stage })),
  };
}

// A body or file with one or several messages, in order.
export async function ingestHl7Text(db: Db, text: string, actor: WriteActor = SYSTEM_ACTOR): Promise<Hl7Result[]> {
  const messages = splitMessages(text);
  if (messages.length === 0) return [await ingestHl7Message(db, text, actor)];
  const results: Hl7Result[] = [];
  for (const message of messages) results.push(await ingestHl7Message(db, message, actor));
  return results;
}
