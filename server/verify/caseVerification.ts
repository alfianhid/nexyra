import { randomUUID } from "node:crypto";
import type { Actor } from "../actor.js";
import { getClock } from "../clock.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import type { ExtractionField } from "./fields.js";
import {
  extractReport,
  type ExtractionCache,
  type ExtractionResult,
  type StoredExtraction,
} from "./extract.js";
import type { FetchLike, LlmConfig } from "./llm.js";
import { PROMPT_VERSION } from "./prompt.js";

// POST /api/cases/{case_id}/verification. Reads one report document, extracts it (or
// returns the cached reading), and records the reading on the case. It writes only the
// `extractions` row and one `extraction_completed` event: it never touches the `cases`
// row, so no extraction result can move, propose or close a case (TICKET-05).

// Report kinds an extraction reads, in the engine's CLOSURE_EVIDENCE_KINDS spirit.
const REPORT_KINDS = ["colonoscopy", "pathology"];

type DocumentRow = { id: string; kind: string; title: string; text: string };

async function reportDocument(
  db: Db,
  caseId: string,
  documentId: string | undefined,
): Promise<DocumentRow | undefined> {
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
    return row;
  }
  // The most recently attached report wins; one document is read per extraction because
  // the stored offsets are offsets into that one document's text.
  const rows = await db
    .prepare("SELECT id, kind, title, text FROM documents WHERE case_id = ? ORDER BY rowid DESC")
    .all<DocumentRow>(caseId);
  return rows.find((row) => REPORT_KINDS.includes(row.kind)) ?? rows[0];
}

// The `extractions` table as an ExtractionCache. put() writes the extraction and its
// event in one batch, so a reading is never stored without its audit line.
function caseExtractionCache(
  db: Db,
  context: { caseId: string; documentId: string; actor: Actor },
): ExtractionCache {
  return {
    async get(hash) {
      const row = await db
        .prepare(
          `SELECT prompt_version, model, fields, proposal, proposal_reason
             FROM extractions WHERE text_hash = ?`,
        )
        .get<{
          prompt_version: string;
          model: string;
          fields: string;
          proposal: string;
          proposal_reason: string;
        }>(hash);
      if (!row) return undefined;
      let fields: ExtractionField[] = [];
      try {
        const parsed: unknown = JSON.parse(row.fields);
        if (Array.isArray(parsed)) fields = parsed as ExtractionField[];
      } catch {
        fields = [];
      }
      return { ...row, fields };
    },

    async put(hash, extraction: StoredExtraction) {
      const extractionId = `x_${randomUUID().slice(0, 8)}`;
      const eventId = `e_${randomUUID().slice(0, 8)}`;
      const recordedAt = new Date().toISOString();
      const occurredAt = (await getClock(db)).now;
      const validated = extraction.fields.filter((field) => field.validated).length;

      const payload = {
        summary: `${validated} findings extracted with citations; proposal ${extraction.proposal}`,
        extraction_id: extractionId,
        document_id: context.documentId,
        text_hash: hash,
        prompt_version: extraction.prompt_version,
        model: extraction.model,
        proposal: extraction.proposal,
        proposal_reason: extraction.proposal_reason,
        requested_by: context.actor.actor_id,
      };

      await db.batch([
        db
          .prepare(
            `INSERT INTO extractions (
               id, case_id, document_id, prompt_version, model, proposal,
               proposal_reason, fields, text_hash, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(text_hash) DO NOTHING`,
          )
          .bind(
            extractionId,
            context.caseId,
            context.documentId,
            extraction.prompt_version,
            extraction.model,
            extraction.proposal,
            extraction.proposal_reason,
            JSON.stringify(extraction.fields),
            hash,
            recordedAt,
          ),
        // The engine reads the report, so the event is the system's; the person who
        // asked for the reading is kept in the payload.
        db
          .prepare(
            `INSERT INTO events (id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload)
             VALUES (?, ?, 'extraction_completed', 'act_system', 'system', ?, ?, ?)`,
          )
          .bind(eventId, context.caseId, occurredAt, recordedAt, JSON.stringify(payload)),
      ]);
    },
  };
}

export type CaseVerificationResponse = {
  report: { document_id: string | null; text: string };
  extraction: {
    prompt_version: string;
    model: string | null;
    fields: ExtractionField[];
    proposal: string;
    proposal_reason: string;
    proposed_outcome: string | null;
    origin: ExtractionResult["origin"] | "no_report";
  };
};

export async function runCaseVerification(
  db: Db,
  caseId: string,
  options: { actor: Actor; documentId?: string; llm?: LlmConfig | null; fetch?: FetchLike },
): Promise<CaseVerificationResponse> {
  const exists = await db.prepare("SELECT id FROM cases WHERE id = ?").get(caseId);
  if (!exists) throw new HttpError(404, "not_found", `No case carries the reference ${caseId}.`);

  const document = await reportDocument(db, caseId, options.documentId);
  if (!document || document.text.trim().length === 0) {
    return {
      report: { document_id: document?.id ?? null, text: document?.text ?? "" },
      extraction: {
        prompt_version: PROMPT_VERSION,
        model: null,
        fields: [],
        proposal: "needs_human_reading",
        proposal_reason: document
          ? "The report document has no text to read."
          : "No report document is attached to this case.",
        proposed_outcome: null,
        origin: "no_report",
      },
    };
  }

  const result = await extractReport(document.text, {
    cache: caseExtractionCache(db, { caseId, documentId: document.id, actor: options.actor }),
    source: document.title || document.id,
    ...(options.llm !== undefined ? { llm: options.llm } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    report: { document_id: document.id, text: document.text },
    extraction: {
      prompt_version: result.prompt_version,
      model: result.model,
      fields: result.fields,
      proposal: result.proposal,
      proposal_reason: result.proposal_reason,
      proposed_outcome: result.proposed_outcome,
      origin: result.origin,
    },
  };
}
