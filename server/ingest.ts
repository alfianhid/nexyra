import type { Db } from "./db.js";
import { isClosed, stitchedResourceTypes, stitchingRule } from "./engine.js";
import { queueUnstitched, stitchResource, type IncomingResource, type WriteActor } from "./events.js";

// TICKET-08 event stitching. A FHIR-shaped Appointment, Procedure or DiagnosticReport
// from another provider is matched to an open case by two keys together: the patient
// identifier and the originating referral (`basedOn` -> ServiceRequest/<referral id>).
// A resource that matches is stitched onto the case; one that does not is queued in
// `unstitched` with the reason. Nothing is dropped: a malformed resource is answered
// `rejected` with its reason in the response.
//
// This file parses and matches (reads). Every write goes through server/events.ts.
// Identity matching is exact; probabilistic matching is out of scope (docs/architecture.md).

export type IngestOutcome = "created_case" | "stitched" | "queued_unstitched" | "rejected";

export type IngestResult = {
  resource_type: string | null;
  resource_id: string | null;
  outcome: IngestOutcome;
  case_id?: string;
  event_id?: string;
  stage?: string;
  stage_moved?: boolean;
  document_id?: string | null;
  unstitched_id?: string;
  reason_code?: string;
  reason?: string;
  duplicate?: boolean;
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// One resource, or a Bundle's entries in order.
export function resourcesOf(body: unknown): unknown[] {
  if (!isObject(body)) return [body];
  const candidate = isObject(body.resource) ? body.resource : body;
  if (candidate.resourceType === "Bundle") {
    const entries = Array.isArray(candidate.entry) ? candidate.entry : [];
    return entries.map((entry) => (isObject(entry) ? entry.resource : entry));
  }
  return [candidate];
}

function referenceId(ref: unknown, type: string): string | null {
  if (!isObject(ref)) return null;
  const reference = str(ref.reference);
  if (reference && reference.startsWith(`${type}/`)) return reference.slice(type.length + 1) || null;
  if (isObject(ref.identifier)) return str(ref.identifier.value);
  return null;
}

// The patient: subject (Procedure, DiagnosticReport) or the Patient participant
// (Appointment). The identifier's value wins over a Patient/<id> reference.
function patientIdentifierOf(resource: Json): string | null {
  const candidates: unknown[] = [];
  if (isObject(resource.subject)) candidates.push(resource.subject);
  if (Array.isArray(resource.participant)) {
    for (const participant of resource.participant) {
      if (isObject(participant) && isObject(participant.actor)) candidates.push(participant.actor);
    }
  }
  for (const candidate of candidates) {
    if (!isObject(candidate)) continue;
    const isPatient =
      candidate.type === "Patient" || (str(candidate.reference)?.startsWith("Patient/") ?? false);
    if (!isPatient && candidate !== resource.subject) continue;
    if (isObject(candidate.identifier)) {
      const value = str(candidate.identifier.value);
      if (value) return value;
    }
    const id = referenceId(candidate, "Patient");
    if (id) return id;
  }
  return null;
}

function referralIdOf(resource: Json): string | null {
  const basedOn = Array.isArray(resource.basedOn) ? resource.basedOn : [];
  for (const ref of basedOn) {
    const id = referenceId(ref, "ServiceRequest");
    if (id) return id;
  }
  return null;
}

// Where it came from: meta.source as urn:nexyra:provider:<id>, a performer
// Organization reference, or the request's source_provider_id. Informational only; it
// is not a matching key.
function sourceProviderOf(resource: Json, fallback: string | null): string | null {
  if (isObject(resource.meta)) {
    const source = str(resource.meta.source);
    if (source?.startsWith("urn:nexyra:provider:")) return source.slice("urn:nexyra:provider:".length);
  }
  const performers = Array.isArray(resource.performer) ? resource.performer : [];
  for (const performer of performers) {
    const actor = isObject(performer) && isObject(performer.actor) ? performer.actor : performer;
    const id = referenceId(actor, "Organization");
    if (id) return id;
  }
  return fallback;
}

function codings(value: unknown): Json[] {
  const out: Json[] = [];
  const list = Array.isArray(value) ? value : [value];
  for (const concept of list) {
    if (!isObject(concept)) continue;
    if (Array.isArray(concept.coding)) out.push(...concept.coding.filter(isObject));
  }
  return out;
}

// A DiagnosticReport is a pathology report when its category is SP (HL7 v2 table 0074,
// surgical pathology) or its code says pathology; otherwise a colonoscopy report.
function documentKindOf(resource: Json): "pathology" | "colonoscopy" {
  const categories = codings(resource.category);
  if (categories.some((c) => c.code === "SP" || /patholog/i.test(String(c.display ?? "")))) {
    return "pathology";
  }
  const code = isObject(resource.code) ? resource.code : {};
  const text = `${String(code.text ?? "")} ${codings(code).map((c) => String(c.display ?? "")).join(" ")}`;
  return /patholog|histolog/i.test(text) ? "pathology" : "colonoscopy";
}

function reportTextOf(resource: Json): string {
  const forms = Array.isArray(resource.presentedForm) ? resource.presentedForm : [];
  for (const form of forms) {
    if (!isObject(form)) continue;
    const data = str(form.data);
    if (data) {
      try {
        return Buffer.from(data, "base64").toString("utf8");
      } catch {
        // fall through to the conclusion
      }
    }
  }
  return str(resource.conclusion) ?? "";
}

function summaryOf(type: string, status: string, provider: string | null, providerName: string | null): string {
  const where = provider ? ` at ${providerName ?? provider}` : "";
  switch (type) {
    case "Appointment":
      return `Appointment ${status}${where}`;
    case "Procedure":
      return `Procedure ${status}${where}`;
    default:
      return `Report ${status}${where}`;
  }
}

type ReferralMatch = {
  case_id: string;
  stage: string;
  status: string;
  patient_identifier: string | null;
  // TICKET-18: the stitching rules are the case's own template's.
  pathway_id: string;
};

async function caseForReferral(db: Db, referralId: string): Promise<ReferralMatch | undefined> {
  return db
    .prepare(
      `SELECT c.id AS case_id, c.stage, c.status, c.patient_identifier, c.pathway_id
         FROM referrals r JOIN cases c ON c.id = r.case_id
        WHERE r.id = ?`,
    )
    .get<ReferralMatch>(referralId);
}

async function alreadyStitched(db: Db, key: string): Promise<{ case_id: string; id: string } | undefined> {
  return db
    .prepare(
      `SELECT case_id, id FROM events
        WHERE json_extract(payload, '$.fhir.key') = ? ORDER BY rowid LIMIT 1`,
    )
    .get<{ case_id: string; id: string }>(key);
}

export async function ingestFhir(
  db: Db,
  body: unknown,
  actor: WriteActor,
): Promise<{ results: IngestResult[]; counts: Record<IngestOutcome, number> }> {
  const fallbackProvider = isObject(body) ? str(body.source_provider_id) : null;
  const supported = stitchedResourceTypes();
  const results: IngestResult[] = [];

  for (const raw of resourcesOf(body)) {
    results.push(await ingestOne(db, raw, actor, fallbackProvider, supported));
  }

  const counts: Record<IngestOutcome, number> = {
    created_case: 0,
    stitched: 0,
    queued_unstitched: 0,
    rejected: 0,
  };
  for (const result of results) counts[result.outcome] += 1;
  return { results, counts };
}

async function ingestOne(
  db: Db,
  raw: unknown,
  actor: WriteActor,
  fallbackProvider: string | null,
  supported: readonly string[],
): Promise<IngestResult> {
  if (!isObject(raw)) {
    return { resource_type: null, resource_id: null, outcome: "rejected", reason_code: "not_a_resource", reason: "Each entry must be a FHIR resource object." };
  }
  const type = str(raw.resourceType);
  const id = str(raw.id);
  if (!type || !id) {
    return { resource_type: type, resource_id: id, outcome: "rejected", reason_code: "missing_identity", reason: "A resource needs resourceType and id." };
  }
  if (!supported.includes(type)) {
    return {
      resource_type: type,
      resource_id: id,
      outcome: "rejected",
      reason_code: "unsupported_type",
      reason: `This ingest stitches ${supported.join(", ")}; ${type} is not handled.`,
    };
  }
  const status = str(raw.status);
  if (!status) {
    return { resource_type: type, resource_id: id, outcome: "rejected", reason_code: "missing_status", reason: `${type}/${id} has no status.` };
  }

  const sourceProvider = sourceProviderOf(raw, fallbackProvider);
  const providerName = sourceProvider
    ? ((await db.prepare("SELECT name FROM providers WHERE id = ?").get<{ name: string }>(sourceProvider))?.name ?? null)
    : null;

  const resource: IncomingResource = {
    resource_type: type,
    resource_id: id,
    status,
    source_provider_id: providerName === null ? null : sourceProvider,
    patient_identifier: patientIdentifierOf(raw),
    referral_id: referralIdOf(raw),
    summary: summaryOf(type, status, sourceProvider, providerName),
    raw,
  };

  const base = { resource_type: type, resource_id: id };
  const previous = await alreadyStitched(db, `${type}/${id}`);
  if (previous) {
    return { ...base, outcome: "stitched", case_id: previous.case_id, event_id: previous.id, duplicate: true };
  }

  const queue = async (reasonCode: string, reason: string): Promise<IngestResult> => {
    const queued = await queueUnstitched(db, { resource, reasonCode, reason });
    return {
      ...base,
      outcome: "queued_unstitched",
      unstitched_id: queued.unstitched_id,
      reason_code: reasonCode,
      reason,
      ...(queued.duplicate ? { duplicate: true } : {}),
    };
  };

  if (resource.patient_identifier === null) {
    return queue("no_patient_identifier", "The resource names no patient identifier to match on.");
  }
  if (resource.referral_id === null) {
    return queue("no_referral_reference", "The resource has no basedOn reference to the originating referral.");
  }
  const match = await caseForReferral(db, resource.referral_id);
  if (!match) {
    return queue("unknown_referral", `No case carries the referral ${resource.referral_id}.`);
  }
  if (match.patient_identifier !== resource.patient_identifier) {
    return queue(
      "patient_mismatch",
      `Referral ${resource.referral_id} belongs to a case for a different patient identifier.`,
    );
  }
  if (isClosed({ stage: match.stage, status: match.status, pathway_id: match.pathway_id })) {
    return queue("case_closed", `The case for referral ${resource.referral_id} is closed.`);
  }

  const documentKind = type === "DiagnosticReport" ? documentKindOf(raw) : null;
  const rule = stitchingRule(type, status, documentKind, match.pathway_id);
  const text = type === "DiagnosticReport" ? reportTextOf(raw) : "";
  const stitched = await stitchResource(db, {
    caseId: match.case_id,
    resource,
    event: rule?.event ?? null,
    document:
      documentKind !== null && text.length > 0
        ? {
            kind: documentKind,
            title: `${documentKind === "pathology" ? "Pathology" : "Colonoscopy"} report (${providerName ?? sourceProvider ?? "external"})`,
            text,
          }
        : null,
    ingestedBy: actor,
  });

  return {
    ...base,
    outcome: "stitched",
    case_id: match.case_id,
    event_id: stitched.recorded,
    stage: stitched.stage,
    stage_moved: stitched.moved,
    document_id: stitched.document_id,
  };
}
