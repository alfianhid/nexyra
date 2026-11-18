import { createHash } from "node:crypto";
import { HL7Message } from "hl7v2";

// TICKET-25. HL7 v2 text -> a plain, typed description of what the message says.
// Parsing is the `hl7v2` library's (BSD-3-Clause, Panates); nothing here splits
// segments or fields itself except to show the raw segments next to the result.
// The mapping of fields to meaning follows GENERIC HL7 v2.5 (REF^I12 with RF1 and PRD,
// ORU^R01 with PID, OBR and OBX). The Malaffi message specification has not been seen,
// so a real feed will need its field map checked (docs/architecture.md, "HL7 v2 ingest").
// This file never touches the database.

export type RefStatus = "pending" | "accepted" | "rejected";
export type RefPriority = "routine" | "asap" | "stat";

export type ParsedRef = {
  kind: "REF";
  control_id: string;
  sending_facility: string | null;
  referral_id: string;
  status: RefStatus;
  patient_identifier: string;
  patient_name: string | null;
  priority: RefPriority | null;
  specialty: { system: string; code: string; display: string } | null;
  referring_provider_id: string | null;
  receiving_provider_id: string | null;
  reason: string | null;
};

export type ParsedOru = {
  kind: "ORU";
  control_id: string;
  sending_facility: string | null;
  patient_identifier: string;
  patient_name: string | null;
  patient_dob: string | null;
  patient_language: string | null;
  accession: string | null;
  test: { code: string; display: string };
  value: string | null;
  // true: positive FIT; false: negative; null: the message does not say clearly.
  positive: boolean | null;
};

export type ParsedMessage = ParsedRef | ParsedOru;

export type SegmentView = { segment: string; text: string };

// A message the parser or the field checks could not accept. `code` is the reason the
// unstitched queue keeps; `partial` is what could still be read, for the queue row.
export type Hl7Partial = {
  control_id?: string;
  sending_facility?: string;
  patient_identifier?: string;
  referral_id?: string;
};

export class Hl7Problem extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly partial: Hl7Partial = {},
  ) {
    super(message);
  }
}

// HL7 separates segments with a carriage return; files and HTTP bodies usually carry
// \n or \r\n. Normalise to \r.
export function normaliseHl7(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n|\n/g, "\r")
    .replace(/\r+/g, "\r")
    .replace(/^\r+|\r+$/g, "");
}

// A file or body may hold several messages: each starts at a line beginning "MSH|".
export function splitMessages(text: string): string[] {
  const normal = normaliseHl7(text);
  if (normal === "") return [];
  return normal
    .split(/\r(?=MSH\|)/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function segmentsOf(raw: string): SegmentView[] {
  return normaliseHl7(raw)
    .split("\r")
    .filter((line) => line.length > 0)
    .map((line) => ({ segment: line.slice(0, 3), text: line }));
}

export function fallbackControlId(raw: string): string {
  return `malformed-${createHash("sha1").update(raw).digest("hex").slice(0, 12)}`;
}

type Reader = (path: string) => string | null;

function readerFor(message: HL7Message): Reader {
  const source = message as unknown as { get(path: string): unknown };
  return (path) => {
    let value: unknown;
    try {
      value = source.get(path);
    } catch {
      return null;
    }
    if (Array.isArray(value)) value = value[0];
    if (typeof value === "number") value = String(value);
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
}

// HL7 table 0283 (referral status) as the three statuses the engine knows. The code
// comes from RF1-1; the display text is a fallback.
function refStatusOf(code: string | null, display: string | null): RefStatus | null {
  const c = (code ?? "").toUpperCase();
  if (c === "P" || c === "N") return "pending";
  if (c === "A") return "accepted";
  if (c === "R") return "rejected";
  const d = (display ?? "").toLowerCase();
  if (/pending|new/.test(d)) return "pending";
  if (/accept/.test(d)) return "accepted";
  if (/reject|declin/.test(d)) return "rejected";
  return null;
}

// HL7 table 0280 (referral priority): A ASAP, R routine, S STAT.
function priorityOf(code: string | null, display: string | null): RefPriority | null {
  const c = (code ?? "").toUpperCase();
  if (c === "R") return "routine";
  if (c === "A") return "asap";
  if (c === "S") return "stat";
  const d = (display ?? "").toLowerCase();
  if (/routine/.test(d)) return "routine";
  if (/asap|urgent/.test(d)) return "asap";
  if (/stat|emergen/.test(d)) return "stat";
  return null;
}

const SNOMED_SYSTEM_NAMES = new Set(["SCT", "SNM", "SNOMEDCT", "SNOMED", "SNOMED-CT", "SNOMED CT", "SNOMED_CT"]);

function readProviders(read: Reader): { referring: string | null; receiving: string | null } {
  let referring: string | null = null;
  let receiving: string | null = null;
  for (let i = 0; i < 6; i++) {
    const role = read(`PRD(${i})-1-1`);
    if (role === null) continue;
    const id = read(`PRD(${i})-7-1`);
    if (role.toUpperCase() === "RP") referring = id;
    if (role.toUpperCase() === "RT") receiving = id;
  }
  return { referring, receiving };
}

function nameOf(read: Reader): string | null {
  const family = read("PID-5-1");
  const given = read("PID-5-2");
  const full = [given, family].filter((p): p is string => p !== null).join(" ");
  return full.length > 0 ? full : null;
}

type Base = { control_id: string; sending_facility: string | null };

function partialOf(base: Base): Hl7Partial {
  return { control_id: base.control_id, ...(base.sending_facility ? { sending_facility: base.sending_facility } : {}) };
}

function parseRef(read: Reader, base: Base): ParsedRef {
  const partial = partialOf(base);
  const patient = read("PID-3-1");
  const referralId = read("RF1-6-1") ?? read("RF1-11-1");
  if (patient === null) throw new Hl7Problem("missing_patient_identifier", "PID-3 carries no patient identifier.", partial);
  if (referralId === null) {
    throw new Hl7Problem("missing_referral_id", "RF1-6 (originating referral identifier) is empty.", {
      ...partial,
      patient_identifier: patient,
    });
  }
  const withIds = { ...partial, patient_identifier: patient, referral_id: referralId };
  const status = refStatusOf(read("RF1-1-1"), read("RF1-1-2"));
  if (status === null) {
    throw new Hl7Problem("unknown_referral_status", `RF1-1 "${read("RF1-1-1") ?? ""}" is not pending, accepted or rejected.`, withIds);
  }

  const providers = readProviders(read);
  const code = read("RF1-3-1");
  const system = read("RF1-3-3");
  let specialty: ParsedRef["specialty"] = null;
  if (code !== null) {
    if (system !== null && !SNOMED_SYSTEM_NAMES.has(system.toUpperCase())) {
      throw new Hl7Problem("specialty_not_snomed", `RF1-3 is coded in "${system}"; the referral specialty must be SNOMED CT.`, withIds);
    }
    specialty = { system: "http://snomed.info/sct", code, display: read("RF1-3-2") ?? code };
  }

  return {
    kind: "REF",
    ...base,
    referral_id: referralId,
    status,
    patient_identifier: patient,
    patient_name: nameOf(read),
    priority: priorityOf(read("RF1-2-1"), read("RF1-2-2")),
    specialty,
    referring_provider_id: providers.referring,
    receiving_provider_id: providers.receiving,
    reason: read("RF1-10-2") ?? read("RF1-10-1") ?? read("NTE-3"),
  };
}

const FIT_LOINC = new Set(["29771-3", "56490-6", "56491-4", "57905-2", "58453-2", "80372-6", "27396-1", "2335-8"]);

// A negative word must win over "positive" inside "non-positive"; "non-reactive" and
// "not detected" are checked first for the same reason.
function positivityOf(value: string | null, flag: string | null, reference: string | null): boolean | null {
  const v = (value ?? "").toLowerCase();
  if (/negative|not detected|non-?reactive|no blood|normal/.test(v)) return false;
  if (/positive|detected|reactive|abnormal/.test(v)) return true;
  const f = (flag ?? "").toUpperCase();
  if (["A", "AA", "H", "HH", "POS", "ABN", ">"].includes(f)) return true;
  if (["N", "NEG", "NEGATIVE"].includes(f)) return false;
  const number = Number(value);
  const limit = /^\s*<\s*=?\s*(\d+(?:\.\d+)?)/.exec(reference ?? "");
  if (value !== null && Number.isFinite(number) && limit) return number > Number(limit[1]);
  return null;
}

function parseOru(read: Reader, base: Base): ParsedOru {
  const partial = partialOf(base);
  const patient = read("PID-3-1");
  if (patient === null) throw new Hl7Problem("missing_patient_identifier", "PID-3 carries no patient identifier.", partial);

  // The first OBX that looks like a FIT; others (haemoglobin, comments) are skipped.
  for (let i = 0; i < 20; i++) {
    const code = read(`OBX(${i})-3-1`);
    const text = read(`OBX(${i})-3-2`);
    if (code === null && text === null) {
      if (i > 0) break;
      continue;
    }
    const looksLikeFit =
      (code !== null && FIT_LOINC.has(code)) || /\bFIT\b|immunochemical|occult blood|\bFOBT\b/i.test(`${text ?? ""} ${code ?? ""}`);
    if (!looksLikeFit) continue;
    const value = read(`OBX(${i})-5`);
    return {
      kind: "ORU",
      ...base,
      patient_identifier: patient,
      patient_name: nameOf(read),
      patient_dob: read("PID-7"),
      patient_language: read("PID-15-1"),
      accession: read("OBR-3-1") ?? read("OBR-2-1"),
      test: { code: code ?? "", display: text ?? "FIT" },
      value,
      positive: positivityOf(value, read(`OBX(${i})-8`), read(`OBX(${i})-7`)),
    };
  }
  throw new Hl7Problem("not_a_fit_result", "The ORU carries no faecal immunochemical test (FIT) observation.", {
    ...partial,
    patient_identifier: patient,
  });
}

// Throws Hl7Problem for anything that is not a usable message. The library's own
// parse error (no MSH, unreadable) becomes `not_hl7v2`.
export function parseHl7(rawText: string): ParsedMessage {
  const raw = normaliseHl7(rawText);
  let message: HL7Message;
  try {
    message = HL7Message.parse(raw);
  } catch (error) {
    throw new Hl7Problem("not_hl7v2", `Not a readable HL7 v2 message: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const read = readerFor(message);
  const controlId = read("MSH-10");
  const facility = read("MSH-4-1");
  if (controlId === null) {
    throw new Hl7Problem("missing_control_id", "MSH-10 (message control id) is empty.", facility ? { sending_facility: facility } : {});
  }
  const base: Base = { control_id: controlId, sending_facility: facility };

  const type = read("MSH-9-1");
  const trigger = read("MSH-9-2");
  if (type === "REF") return parseRef(read, base);
  if (type === "ORU") return parseOru(read, base);
  throw new Hl7Problem(
    "unsupported_message_type",
    `Message type ${type ?? "(none)"}${trigger ? `^${trigger}` : ""} is not handled; this ingest reads REF and ORU.`,
    partialOf(base),
  );
}
