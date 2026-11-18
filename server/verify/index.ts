// What other modules (the TICKET-14 evaluation, the case view) import from TICKET-13.
export {
  extractReport,
  memoryCache,
  textHash,
  type ExtractionCache,
  type ExtractionResult,
  type ExtractOptions,
  type StoredExtraction,
} from "./extract.js";
export {
  ABSENT_VALUES,
  FIELD_KEYS,
  FIELD_LABELS,
  FIELD_VALUES,
  isFieldKey,
  type ExtractionField,
  type FieldKey,
} from "./fields.js";
export {
  DEFAULT_MODEL,
  llmConfigFromEnv,
  parseModelJson,
  type FetchLike,
  type LlmConfig,
} from "./llm.js";
export {
  decideProposal,
  PROPOSALS,
  proposedOutcomeFor,
  type Proposal,
  type ProposalDecision,
  type ProposedOutcome,
} from "./proposal.js";
export { buildMessages, PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt.js";
export { locateQuote, MIN_QUOTE_CHARS, validateFields, type Rejection } from "./quotes.js";
export { runCaseVerification, type CaseVerificationResponse } from "./caseVerification.js";
