import { createHash } from "node:crypto";
import { FIELD_KEYS, type ExtractionField } from "./fields.js";
import { llmConfigFromEnv, LlmError, requestJson, type FetchLike, type LlmConfig } from "./llm.js";
import {
  decideProposal,
  proposedOutcomeFor,
  type Proposal,
  type ProposedOutcome,
} from "./proposal.js";
import { buildMessages, PROMPT_VERSION } from "./prompt.js";
import { validateFields, type Rejection } from "./quotes.js";

// TICKET-13 entry point: report text in, validated fields and a rule-based proposal out.
// The evaluation (TICKET-14) imports extractReport() directly.

export type StoredExtraction = {
  prompt_version: string;
  model: string;
  fields: ExtractionField[];
  proposal: string;
  proposal_reason: string;
};

// Keyed by sha256 of the report text. `put` is called only for a fresh model reading,
// never for an unavailable result, so adding a key later still gets the report read.
export type ExtractionCache = {
  get(textHash: string): Promise<StoredExtraction | undefined>;
  put(textHash: string, extraction: StoredExtraction): Promise<void>;
};

export type ExtractionResult = Omit<StoredExtraction, "model"> & {
  // Null when no model was configured and nothing was cached.
  model: string | null;
  proposed_outcome: ProposedOutcome | null;
  // Where the result came from: a model call just now, the cache, or neither.
  origin: "model" | "cache" | "unavailable";
  text_hash: string;
  // Citations the validator refused (only for origin "model").
  rejections: Rejection[];
  // Why no reading exists (only for origin "unavailable"). Never contains the key.
  error: string | null;
  // The model's reply as received (only for origin "model"), for debugging the eval.
  raw_response: string | null;
};

export type ExtractOptions = {
  // Default: llmConfigFromEnv(). Pass null to forbid a model call.
  llm?: LlmConfig | null;
  fetch?: FetchLike;
  cache?: ExtractionCache;
  // Provenance printed on every field (docs/api.md `source`).
  source?: string;
  now?: () => Date;
};

export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function extractReport(
  text: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const hash = textHash(text);

  const cached = await options.cache?.get(hash);
  if (cached) {
    return {
      ...cached,
      proposed_outcome: proposedOutcomeFor(cached.proposal, cached.fields),
      origin: "cache",
      text_hash: hash,
      rejections: [],
      error: null,
      raw_response: null,
    };
  }

  const llm = options.llm === undefined ? llmConfigFromEnv() : options.llm;
  const unavailable = (reason: string, model: string | null): ExtractionResult => ({
    prompt_version: PROMPT_VERSION,
    model,
    fields: [],
    proposal: "needs_human_reading" satisfies Proposal,
    proposal_reason: reason,
    proposed_outcome: null,
    origin: "unavailable",
    text_hash: hash,
    rejections: [],
    error: reason,
    raw_response: null,
  });

  if (!llm) {
    return unavailable(
      "No model is configured (LLM_API_KEY or LLM_BASE_URL is empty) and this report has no cached reading.",
      null,
    );
  }
  if (text.trim().length === 0) {
    return unavailable("The report text is empty.", llm.model);
  }

  let reply;
  try {
    reply = await requestJson(llm, buildMessages(text), options.fetch);
  } catch (error) {
    const message = error instanceof LlmError ? error.message : "Model call failed";
    return unavailable(`The report could not be read by the model: ${message}.`, llm.model);
  }

  // A reply nested as { "fields": { ... } } is accepted too.
  const answer =
    !FIELD_KEYS.some((key) => key in reply.parsed) &&
    typeof reply.parsed.fields === "object" &&
    reply.parsed.fields !== null &&
    !Array.isArray(reply.parsed.fields)
      ? (reply.parsed.fields as Record<string, unknown>)
      : reply.parsed;

  const readAt = (options.now?.() ?? new Date()).toISOString();
  const { fields, rejections } = validateFields(text, answer, {
    source: options.source ?? "report",
    read_at: readAt,
  });
  const decision = decideProposal(fields);

  const stored: StoredExtraction = {
    prompt_version: PROMPT_VERSION,
    model: llm.model,
    fields,
    proposal: decision.proposal,
    proposal_reason: decision.proposal_reason,
  };
  await options.cache?.put(hash, stored);

  return {
    ...stored,
    proposed_outcome: decision.proposed_outcome,
    origin: "model",
    text_hash: hash,
    rejections,
    error: null,
    raw_response: reply.raw,
  };
}

// A process-local cache, for scripts and tests that have no database.
export function memoryCache(): ExtractionCache & { size(): number } {
  const entries = new Map<string, StoredExtraction>();
  return {
    async get(hash) {
      return entries.get(hash);
    },
    async put(hash, extraction) {
      entries.set(hash, extraction);
    },
    size() {
      return entries.size;
    },
  };
}
