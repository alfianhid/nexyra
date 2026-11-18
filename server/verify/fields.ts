// The extraction vocabulary for TICKET-13. One place, so the prompt, the validator, the
// proposal rules and the evaluation (TICKET-14) cannot drift apart.

export const FIELD_KEYS = [
  "complete_exam",
  "adequate_prep",
  "tissue_taken",
  "pathology_available",
  "outcome_category",
  "next_step",
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

// The values each field may take. "unknown" is always allowed and is what a field
// becomes when its citation does not check out.
export const FIELD_VALUES: Readonly<Record<FieldKey, readonly string[]>> = {
  complete_exam: ["yes", "no", "unknown"],
  adequate_prep: ["yes", "no", "unknown"],
  tissue_taken: ["yes", "no", "unknown"],
  pathology_available: ["yes", "no", "unknown"],
  outcome_category: ["normal", "polyp", "cancer", "not_stated", "unknown"],
  next_step: ["stated", "not_stated", "unknown"],
};

// Values that say "the report does not tell us". They carry no quote, because there is
// nothing to quote, and they are never validated.
export const ABSENT_VALUES: readonly string[] = ["unknown", "not_stated"];

export const FIELD_LABELS: Readonly<Record<FieldKey, string>> = {
  complete_exam: "complete exam",
  adequate_prep: "adequate bowel prep",
  tissue_taken: "tissue taken",
  pathology_available: "pathology available",
  outcome_category: "outcome category",
  next_step: "stated next step",
};

// The shape docs/api.md fixes for GET /api/cases/{case_id}/verification.
export type ExtractionField = {
  key: FieldKey;
  value: string;
  quote: string | null;
  quote_offset: [number, number];
  source: string;
  read_at: string;
  validated: boolean;
};

export function isFieldKey(key: unknown): key is FieldKey {
  return typeof key === "string" && (FIELD_KEYS as readonly string[]).includes(key);
}
