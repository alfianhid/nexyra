import {
  ABSENT_VALUES,
  FIELD_KEYS,
  FIELD_VALUES,
  type ExtractionField,
  type FieldKey,
} from "./fields.js";

// Citation validation (TICKET-13). The model's word is never taken for where a quote is,
// or whether it exists: both are decided here, from the report text alone.

// A quote shorter than this proves nothing ("no", "yes", "pt") even when it matches.
export const MIN_QUOTE_CHARS = 8;

export const NO_OFFSET: [number, number] = [0, 0];

// Finds `quote` in `text` treating every run of whitespace as one space, and nothing
// else as equal: case, punctuation and spelling must match exactly. Returns offsets
// into the original text, as UTF-16 indices (what String.prototype.slice takes), or
// null when the quote is absent or too short to count as evidence.
export function locateQuote(text: string, quote: string): [number, number] | null {
  const needle = quote.replace(/\s+/g, " ").trim();
  if (needle.length < MIN_QUOTE_CHARS) return null;

  let collapsed = "";
  const origin: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      if (!inSpace) {
        collapsed += " ";
        origin.push(i);
      }
      inSpace = true;
    } else {
      collapsed += ch;
      origin.push(i);
      inSpace = false;
    }
  }

  const at = collapsed.indexOf(needle);
  if (at < 0) return null;
  // The needle is trimmed, so both ends sit on non-space characters of the original.
  const start = origin[at] as number;
  const last = origin[at + needle.length - 1] as number;
  return [start, last + 1];
}

export type Rejection = {
  key: FieldKey;
  claimed_value: string;
  claimed_quote: string | null;
  reason: "value_not_allowed" | "quote_missing" | "quote_not_in_report";
};

export type Provenance = { source: string; read_at: string };

// Turns the model's raw answer into contract fields. Anything the model said that the
// text does not back up becomes `unknown` with `validated: false`, and is listed in
// `rejections` so the evaluation can count failed citations.
export function validateFields(
  text: string,
  raw: Record<string, unknown>,
  provenance: Provenance,
): { fields: ExtractionField[]; rejections: Rejection[] } {
  const fields: ExtractionField[] = [];
  const rejections: Rejection[] = [];

  for (const key of FIELD_KEYS) {
    const answer = readAnswer(raw[key]);
    const unknown = (): ExtractionField => ({
      key,
      value: "unknown",
      quote: null,
      quote_offset: [...NO_OFFSET],
      ...provenance,
      validated: false,
    });

    if (!FIELD_VALUES[key].includes(answer.value)) {
      rejections.push({
        key,
        claimed_value: answer.value,
        claimed_quote: answer.quote,
        reason: "value_not_allowed",
      });
      fields.push(unknown());
      continue;
    }

    if (ABSENT_VALUES.includes(answer.value)) {
      fields.push({ ...unknown(), value: answer.value });
      continue;
    }

    if (answer.quote === null) {
      rejections.push({ key, claimed_value: answer.value, claimed_quote: null, reason: "quote_missing" });
      fields.push(unknown());
      continue;
    }

    const offset = locateQuote(text, answer.quote);
    if (!offset) {
      rejections.push({
        key,
        claimed_value: answer.value,
        claimed_quote: answer.quote,
        reason: "quote_not_in_report",
      });
      fields.push(unknown());
      continue;
    }

    fields.push({
      key,
      value: answer.value,
      // The report's own characters, so the highlighted span and the quote are identical.
      quote: text.slice(offset[0], offset[1]),
      quote_offset: offset,
      ...provenance,
      validated: true,
    });
  }

  return { fields, rejections };
}

// The model is asked for { value, quote }; a bare string value is tolerated and treated
// as an answer with no quote, which then fails validation unless it is an absent value.
function readAnswer(entry: unknown): { value: string; quote: string | null } {
  if (typeof entry === "string") return { value: entry.trim().toLowerCase(), quote: null };
  if (typeof entry !== "object" || entry === null) return { value: "unknown", quote: null };

  const record = entry as Record<string, unknown>;
  const value =
    typeof record.value === "string" ? record.value.trim().toLowerCase() : "unknown";
  const quote =
    typeof record.quote === "string" && record.quote.trim().length > 0 ? record.quote : null;
  return { value, quote };
}
