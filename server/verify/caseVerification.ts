import type { InStatement } from "@libsql/client";
import { randomUUID } from "node:crypto";
import type { Actor } from "../actor.js";
import { formatDue, getClock } from "../clock.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import type { ExtractionField } from "./fields.js";
import {
  extractReport,
  textHash,
  type ExtractionCache,
  type ExtractionResult,
  type StoredExtraction,
} from "./extract.js";
import type { FetchLike, LlmConfig } from "./llm.js";
import { PROMPT_VERSION } from "./prompt.js";
import { proposedOutcomeFor } from "./proposal.js";

// POST /api/cases/{case_id}/verification. Reads the case's latest report, extracts it (or
// takes the cached reading of the same text), and records the reading on the case. It
// writes only the `extraction_cache` and `extractions` rows and one `extraction_completed`
// event: it never touches the `cases` row, so no extraction result can move, propose or
// close a case (TICKET-05).

// Report kinds an extraction reads.
const REPORT_KINDS = ["colonoscopy", "pathology"];

type DocumentRow = { id: string; kind: string; title: string; text: string };

// What one reading reads. Usually one document. After a colonoscopy whose tissue went to
// the lab, the latest report is the colonoscopy report together with the pathology reports
// that arrived after it: a physician signs off on both, and the prompt already says the
// outcome follows the pathology result. The offsets of every quote are offsets into
// `text`, which is why that combined text is what is hashed, cached and returned.
export type ReportView = {
  // The latest document in the report (the one the reading is attached to).
  document_id: string;
  document_ids: string[];
  title: string;
  text: string;
};

const HEADINGS: Record<string, string> = {
  colonoscopy: "COLONOSCOPY REPORT",
  pathology: "PATHOLOGY REPORT",
};

// One text from several report documents, in the order they arrived. A single document is
// its own text unchanged, so a reading cached for it still matches.
export function combineReports(parts: readonly { kind: string; text: string }[]): string {
  if (parts.length === 1) return parts[0]!.text;
  return parts.map((part) => `${HEADINGS[part.kind] ?? part.kind.toUpperCase()}\n${part.text}`).join("\n\n");
}

function viewOf(parts: DocumentRow[]): ReportView {
  const last = parts[parts.length - 1]!;
  return {
    document_id: last.id,
    document_ids: parts.map((part) => part.id),
    title: parts.map((part) => part.title).join(" + "),
    text: combineReports(parts),
  };
}

export async function latestReport(
  db: Db,
  caseId: string,
  documentId?: string,
): Promise<ReportView | undefined> {
  if (documentId !== undefined) {
    const row = await db
      .prepare("SELECT id, kind, title, text FROM documents WHERE id = ? AND case_id = ?")
      .get<DocumentRow>(documentId, caseId);
    if (!row) {
      throw new HttpError(
        400,
        "validation_failed",
        `Case ${caseId} has no document with the id "${documentId}".`,
      );
    }
    return viewOf([row]);
  }
  const rows = await db
    .prepare("SELECT id, kind, title, text FROM documents WHERE case_id = ? ORDER BY rowid")
    .all<DocumentRow>(caseId);
  const reports = rows.filter((row) => REPORT_KINDS.includes(row.kind));
  if (reports.length === 0) return rows.length > 0 ? viewOf([rows[rows.length - 1]!]) : undefined;

  const lastColonoscopy = reports.map((row) => row.kind).lastIndexOf("colonoscopy");
  if (lastColonoscopy < 0) return viewOf([reports[reports.length - 1]!]);
  const later = reports.slice(lastColonoscopy + 1).filter((row) => row.kind === "pathology");
  return viewOf([reports[lastColonoscopy]!, ...later]);
}

type ExtractionRow = {
  id: string;
  document_id: string;
  prompt_version: string;
  model: string;
  fields: string;
  proposal: string;
  proposal_reason: string;
  created_at: string;
};

function parseFields(json: string): ExtractionField[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ExtractionField[]) : [];
  } catch {
    return [];
  }
}

function extractionStatements(
  db: Db,
  context: { caseId: string; report: ReportView; actor: Actor },
  hash: string,
  extraction: StoredExtraction,
  occurredAt: string,
  origin: "model" | "cache",
): InStatement[] {
  const extractionId = `x_${randomUUID().slice(0, 8)}`;
  const eventId = `e_${randomUUID().slice(0, 8)}`;
  const recordedAt = new Date().toISOString();
  const validated = extraction.fields.filter((field) => field.validated).length;
  const payload = {
    summary: `${validated} findings extracted with citations; proposal ${extraction.proposal}`,
    extraction_id: extractionId,
    document_id: context.report.document_id,
    document_ids: context.report.document_ids,
    text_hash: hash,
    prompt_version: extraction.prompt_version,
    model: extraction.model,
    proposal: extraction.proposal,
    proposal_reason: extraction.proposal_reason,
    origin,
    requested_by: context.actor.actor_id,
  };
  return [
    db
      .prepare(
        `INSERT INTO extractions (
           id, case_id, document_id, prompt_version, model, proposal,
           proposal_reason, fields, text_hash, created_at, report_text
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(document_id, text_hash) DO NOTHING`,
      )
      .bind(
        extractionId,
        context.caseId,
        context.report.document_id,
        extraction.prompt_version,
        extraction.model,
        extraction.proposal,
        extraction.proposal_reason,
        JSON.stringify(extraction.fields),
        hash,
        occurredAt,
        context.report.text,
      ),
    // The engine reads the report, so the event is the system's; the person who asked
    // for the reading is kept in the payload.
    db
      .prepare(
        `INSERT INTO events (id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload)
         VALUES (?, ?, 'extraction_completed', 'act_system', 'system', ?, ?, ?)`,
      )
      .bind(eventId, context.caseId, occurredAt, recordedAt, JSON.stringify(payload)),
  ];
}

// The model's readings, keyed by sha256 of the text, in `extraction_cache`. A reading is
// the same whichever case the text belongs to; what a case shows is the `extractions` row
// attached to its own document. put() writes the cache entry, the case's reading and its
// event in one batch, so a reading is never stored without its audit line.
function caseExtractionCache(
  db: Db,
  context: { caseId: string; report: ReportView; actor: Actor },
): ExtractionCache {
  return {
    async get(hash) {
      const cached =
        (await db
          .prepare(
            `SELECT prompt_version, model, fields, proposal, proposal_reason
               FROM extraction_cache WHERE text_hash = ?`,
          )
          .get<Omit<ExtractionRow, "id" | "document_id" | "created_at">>(hash)) ??
        // Readings stored before the cache table existed live only in `extractions`.
        (await db
          .prepare(
            `SELECT prompt_version, model, fields, proposal, proposal_reason
               FROM extractions WHERE text_hash = ? ORDER BY rowid LIMIT 1`,
          )
          .get<Omit<ExtractionRow, "id" | "document_id" | "created_at">>(hash));
      if (!cached) return undefined;
      return { ...cached, fields: parseFields(cached.fields) };
    },

    async put(hash, extraction: StoredExtraction) {
      const occurredAt = (await getClock(db)).now;
      await db.batch([
        db
          .prepare(
            `INSERT INTO extraction_cache (
               text_hash, prompt_version, model, fields, proposal, proposal_reason, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(text_hash) DO NOTHING`,
          )
          .bind(
            hash,
            extraction.prompt_version,
            extraction.model,
            JSON.stringify(extraction.fields),
            extraction.proposal,
            extraction.proposal_reason,
            occurredAt,
          ),
        ...extractionStatements(db, context, hash, extraction, occurredAt, "model"),
      ]);
    },
  };
}

// A cache hit for a report this case has no reading of yet (the same text arrived for a
// new document): the reading is attached to that document, with its own audit line. A
// second hit on the same document writes nothing.
async function attachCachedReading(
  db: Db,
  context: { caseId: string; report: ReportView; actor: Actor },
  result: ExtractionResult,
): Promise<void> {
  const existing = await db
    .prepare("SELECT id FROM extractions WHERE document_id = ? AND text_hash = ?")
    .get(context.report.document_id, result.text_hash);
  if (existing) return;
  const stored: StoredExtraction = {
    prompt_version: result.prompt_version,
    model: result.model ?? "unknown",
    fields: result.fields,
    proposal: result.proposal,
    proposal_reason: result.proposal_reason,
  };
  await db.batch(
    extractionStatements(db, context, result.text_hash, stored, (await getClock(db)).now, "cache"),
  );
}

export type VerificationOrigin =
  | ExtractionResult["origin"]
  | "stored"
  | "not_read"
  | "no_report"
  | "pathway_not_verified";

export type CaseVerificationResponse = {
  report: { document_id: string | null; document_ids: string[]; title: string; text: string };
  extraction: {
    extraction_id: string | null;
    prompt_version: string;
    model: string | null;
    fields: (ExtractionField & { read_label: string })[];
    proposal: string;
    proposal_reason: string;
    proposed_outcome: string | null;
    origin: VerificationOrigin;
    read_label: string | null;
  };
};

// TICKET-18: the prompt, the fields and the outcome mapping are written for colonoscopy
// and pathology reports on the FIT pathway. Another pathway's reports are read by a person.
export const VERIFIED_PATHWAY_ID = "fit-colonoscopy";

function labelled(fields: ExtractionField[]) {
  return fields.map((field) => ({ ...field, read_label: formatDue(field.read_at) }));
}

function emptyResponse(
  report: ReportView | undefined,
  origin: VerificationOrigin,
  reason: string,
): CaseVerificationResponse {
  return {
    report: {
      document_id: report?.document_id ?? null,
      document_ids: report?.document_ids ?? [],
      title: report?.title ?? "",
      text: report?.text ?? "",
    },
    extraction: {
      extraction_id: null,
      prompt_version: PROMPT_VERSION,
      model: null,
      fields: [],
      proposal: "needs_human_reading",
      proposal_reason: reason,
      proposed_outcome: null,
      origin,
      read_label: null,
    },
  };
}

async function pathwayOfCase(db: Db, caseId: string): Promise<string> {
  const row = await db
    .prepare("SELECT id, pathway_id FROM cases WHERE id = ?")
    .get<{ id: string; pathway_id: string }>(caseId);
  if (!row) throw new HttpError(404, "not_found", `No case carries the reference ${caseId}.`);
  return row.pathway_id;
}

const notVerified = (pathwayId: string) =>
  `Report verification is not configured for the ${pathwayId} pathway; a person reads its reports.`;

// The reading of the case's latest report, or null when that report has not been read.
// A reading of an earlier report is never returned as the current one: after a repeat
// colonoscopy, the first report's "reopen" is history, not the proposal on the table.
export async function currentReading(
  db: Db,
  caseId: string,
): Promise<{ report: ReportView | undefined; extraction: ExtractionRow | null }> {
  const report = await latestReport(db, caseId);
  if (!report) return { report, extraction: null };
  const extraction = await db
    .prepare(
      `SELECT id, document_id, prompt_version, model, fields, proposal, proposal_reason, created_at
         FROM extractions WHERE case_id = ? AND document_id = ? ORDER BY rowid DESC LIMIT 1`,
    )
    .get<ExtractionRow>(caseId, report.document_id);
  return { report, extraction: extraction ?? null };
}

// GET /api/cases/{case_id}/verification: the stored reading of the latest report, never a
// model call and never a write.
export async function readCaseVerification(db: Db, caseId: string): Promise<CaseVerificationResponse> {
  const pathwayId = await pathwayOfCase(db, caseId);
  if (pathwayId !== VERIFIED_PATHWAY_ID) {
    return emptyResponse(undefined, "pathway_not_verified", notVerified(pathwayId));
  }
  const { report, extraction } = await currentReading(db, caseId);
  if (!report) return emptyResponse(report, "no_report", "No report document is attached to this case.");
  if (!extraction) {
    return emptyResponse(
      report,
      "not_read",
      `The latest report (${report.title}) has not been read yet. Read it to get a proposal.`,
    );
  }
  const fields = parseFields(extraction.fields);
  return {
    report: {
      document_id: report.document_id,
      document_ids: report.document_ids,
      title: report.title,
      text: report.text,
    },
    extraction: {
      extraction_id: extraction.id,
      prompt_version: extraction.prompt_version,
      model: extraction.model,
      fields: labelled(fields),
      proposal: extraction.proposal,
      proposal_reason: extraction.proposal_reason,
      proposed_outcome: proposedOutcomeFor(extraction.proposal, fields),
      origin: "stored",
      read_label: formatDue(extraction.created_at),
    },
  };
}

export async function runCaseVerification(
  db: Db,
  caseId: string,
  options: { actor: Actor; documentId?: string; llm?: LlmConfig | null; fetch?: FetchLike },
): Promise<CaseVerificationResponse> {
  const pathwayId = await pathwayOfCase(db, caseId);
  if (pathwayId !== VERIFIED_PATHWAY_ID) {
    return emptyResponse(undefined, "pathway_not_verified", notVerified(pathwayId));
  }

  const report = await latestReport(db, caseId, options.documentId);
  if (!report || report.text.trim().length === 0) {
    return emptyResponse(
      report,
      "no_report",
      report ? "The report document has no text to read." : "No report document is attached to this case.",
    );
  }

  const context = { caseId, report, actor: options.actor };
  const result = await extractReport(report.text, {
    cache: caseExtractionCache(db, context),
    source: report.title || report.document_id,
    ...(options.llm !== undefined ? { llm: options.llm } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (result.origin === "cache") await attachCachedReading(db, context, result);

  const stored = result.origin === "unavailable" ? null : await currentReading(db, caseId);
  return {
    report: {
      document_id: report.document_id,
      document_ids: report.document_ids,
      title: report.title,
      text: report.text,
    },
    extraction: {
      extraction_id: stored?.extraction?.id ?? null,
      prompt_version: result.prompt_version,
      model: result.model,
      fields: labelled(result.fields),
      proposal: result.proposal,
      proposal_reason: result.proposal_reason,
      proposed_outcome: result.proposed_outcome,
      origin: result.origin,
      read_label: stored?.extraction ? formatDue(stored.extraction.created_at) : null,
    },
  };
}

export { textHash };
