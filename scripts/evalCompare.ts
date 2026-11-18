// TICKET-14: the comparison and the report text, as pure functions so they can be tested
// without a model. scripts/eval.ts does the I/O.

export const LABEL_FIELDS = [
  "complete_exam",
  "adequate_prep",
  "tissue_taken",
  "pathology_available",
  "outcome_category",
  "next_step",
] as const;
export type EvalField = (typeof LABEL_FIELDS)[number];

export type Label = {
  id: string;
  complete_exam: string;
  adequate_prep: string;
  tissue_taken: string;
  pathology_available: string;
  outcome_category: string;
  stated_next_step: string | null;
  may_propose_closure: string;
};

// The part of an ExtractionResult the evaluation reads.
export type EvalResult = {
  origin: "model" | "cache" | "unavailable";
  proposal: string;
  fields: ReadonlyArray<{ key: string; value: string }>;
  rejections: ReadonlyArray<unknown>;
};

export type FieldMismatch = { field: EvalField | "closure"; expected: string; got: string };

export type Evaluated = { id: string; mismatches: FieldMismatch[] };

export type Comparison = {
  total: number;
  unavailable: string[];
  read: number;
  mustNotClose: { total: number; heldBack: string[]; slippedThrough: string[] };
  mayClose: { total: number; proposed: string[]; heldBack: string[] };
  perField: Record<EvalField, { agree: number; of: number }>;
  rejectedCitations: number;
  wrong: Evaluated[];
};

// What the label says, in the module's vocabulary: the module values that count as
// agreement, and the text to show as "expected".
export function expectedFor(label: Label, field: EvalField): { accept: string[]; shown: string } {
  switch (field) {
    case "complete_exam":
    case "adequate_prep":
    case "tissue_taken": {
      const v = label[field];
      return v === "not_stated"
        ? { accept: ["unknown"], shown: "not_stated (= unknown)" }
        : { accept: [v], shown: v };
    }
    case "pathology_available": {
      const v = label.pathology_available;
      // No tissue taken: there is nothing to wait for. The module may say "no" or
      // "unknown"; "yes" would be an invented result.
      return v === "not_applicable"
        ? { accept: ["no", "unknown"], shown: "not_applicable (= no pathology needed: no or unknown)" }
        : { accept: [v === "not_stated" ? "unknown" : v], shown: v };
    }
    case "outcome_category": {
      const v = label.outcome_category;
      return v === "not_stated"
        ? { accept: ["not_stated", "unknown"], shown: "not_stated (= not_stated or unknown)" }
        : { accept: [v], shown: v };
    }
    case "next_step": {
      return label.stated_next_step === null
        ? { accept: ["not_stated", "unknown"], shown: "none stated (= not_stated or unknown)" }
        : { accept: ["stated"], shown: "stated" };
    }
  }
}

function valueOf(result: EvalResult, field: EvalField): string {
  return result.fields.find((f) => f.key === field)?.value ?? "unknown";
}

export function compare(labels: readonly Label[], results: Readonly<Record<string, EvalResult>>): Comparison {
  const cmp: Comparison = {
    total: labels.length,
    unavailable: [],
    read: 0,
    mustNotClose: { total: 0, heldBack: [], slippedThrough: [] },
    mayClose: { total: 0, proposed: [], heldBack: [] },
    perField: Object.fromEntries(LABEL_FIELDS.map((f) => [f, { agree: 0, of: 0 }])) as Comparison["perField"],
    rejectedCitations: 0,
    wrong: [],
  };

  for (const label of labels) {
    const result = results[label.id];
    if (!result || result.origin === "unavailable") {
      cmp.unavailable.push(label.id);
      continue;
    }
    cmp.read += 1;
    cmp.rejectedCitations += result.rejections.length;
    const mismatches: FieldMismatch[] = [];

    for (const field of LABEL_FIELDS) {
      const { accept, shown } = expectedFor(label, field);
      const got = valueOf(result, field);
      cmp.perField[field].of += 1;
      if (accept.includes(got)) cmp.perField[field].agree += 1;
      else mismatches.push({ field, expected: shown, got });
    }

    const proposed = result.proposal === "propose_closure";
    if (label.may_propose_closure === "no") {
      cmp.mustNotClose.total += 1;
      if (proposed) {
        cmp.mustNotClose.slippedThrough.push(label.id);
        mismatches.push({ field: "closure", expected: "must not propose closure", got: result.proposal });
      } else cmp.mustNotClose.heldBack.push(label.id);
    } else if (label.may_propose_closure === "yes") {
      cmp.mayClose.total += 1;
      if (proposed) cmp.mayClose.proposed.push(label.id);
      else {
        cmp.mayClose.heldBack.push(label.id);
        mismatches.push({ field: "closure", expected: "may propose closure", got: result.proposal });
      }
    }
    if (mismatches.length > 0) cmp.wrong.push({ id: label.id, mismatches });
  }
  return cmp;
}

export type RunInfo = {
  date: string;
  model: string;
  promptVersion: string;
  checkedBy: string | null;
  checkedAt: string | null;
  promptChangesAfterResults: number;
};

const frac = (n: number, d: number) => `${n} of ${d}`;

export const MAPPING_LINES = [
  "`complete_exam`, `adequate_prep`, `tissue_taken`: label `yes` / `no` match module `yes` / `no`; label `not_stated` matches module `unknown`.",
  "`pathology_available`: label `yes` / `no` match module `yes` / `no`; label `not_applicable` (no tissue taken, so no pathology needed) matches module `no` or `unknown`, and a module `yes` counts as a disagreement.",
  "`outcome_category`: `normal`, `polyp`, `cancer` match as written; label `not_stated` matches module `not_stated` or `unknown`.",
  "`next_step`: label `stated_next_step` with text matches module `stated`; label `null` matches module `not_stated` or `unknown`. Only whether a next step is stated is compared, not its wording.",
  "\"May propose closure\" means the module proposal is `propose_closure` and nothing else; `reopen`, `wait_for_pathology` and `needs_human_reading` all count as held back.",
  "Reports whose extraction was `unavailable` (no key or model unreachable) are excluded from every count below and listed separately; they are never counted as correct hold-backs.",
];

export function renderResults(cmp: Comparison, run: RunInfo): string {
  const out: string[] = [];
  const list = (ids: string[]) => (ids.length > 0 ? ids.join(", ") : "none");

  if (cmp.mustNotClose.slippedThrough.length > 0) {
    out.push(
      "## DANGEROUS ERROR: reports that must not be closed were proposed for closure",
      "",
      `${frac(cmp.mustNotClose.slippedThrough.length, cmp.mustNotClose.total)} reports labelled \`may_propose_closure: no\` came out as \`propose_closure\`: ${cmp.mustNotClose.slippedThrough.join(", ")}.`,
      "",
      "Bring this to the team before anything is demonstrated.",
      "",
    );
  }

  out.push(
    "# Closure verification evaluation (TICKET-14)",
    "",
    `- Date: ${run.date}`,
    `- Model: ${run.model}`,
    `- Prompt version: ${run.promptVersion}`,
    `- Reports: ${cmp.total}; read by the model: ${cmp.read}; unavailable: ${cmp.unavailable.length}${cmp.unavailable.length ? ` (${cmp.unavailable.join(", ")})` : ""}`,
    "- No cache: every report was read fresh.",
    "",
    "## Closure proposals",
    "",
    `- Must not be closed: held back correctly ${frac(cmp.mustNotClose.heldBack.length, cmp.mustNotClose.total)}; proposed for closure anyway (dangerous) ${frac(cmp.mustNotClose.slippedThrough.length, cmp.mustNotClose.total)}. Slipped through: ${list(cmp.mustNotClose.slippedThrough)}.`,
    `- May be closed: correctly proposed ${frac(cmp.mayClose.proposed.length, cmp.mayClose.total)}; held back (false alarm) ${frac(cmp.mayClose.heldBack.length, cmp.mayClose.total)}. Held back: ${list(cmp.mayClose.heldBack)}.`,
    "",
    "## Agreement per field",
    "",
    "| Field | Agreement |",
    "|---|---|",
    ...LABEL_FIELDS.map((f) => `| ${f} | ${frac(cmp.perField[f].agree, cmp.perField[f].of)} |`),
    "",
    "## Citations that failed validation",
    "",
    `${cmp.rejectedCitations} rejected across ${cmp.read} read reports.`,
    "",
    "## Reports with any disagreement",
    "",
  );

  if (cmp.wrong.length === 0) out.push("None.", "");
  else {
    out.push("| Report | Field | Expected | Got |", "|---|---|---|---|");
    for (const w of cmp.wrong) {
      for (const m of w.mismatches) out.push(`| ${w.id} | ${m.field} | ${m.expected} | ${m.got} |`);
    }
    out.push("");
  }

  out.push("## Label to module mapping", "", ...MAPPING_LINES.map((l) => `- ${l}`), "");

  const checked = run.checkedBy
    ? `The labels were checked by ${run.checkedBy}${run.checkedAt ? ` on ${run.checkedAt}` : ""}.`
    : "The labels have not yet been checked by a clinician (`checked_by` in `data/test-reports/labels.json` is null).";
  out.push(
    "## Limitations",
    "",
    `The test reports are synthetic and were written by the team with AI help. ${cmp.total} reports is a small set, so a fraction here says little about how the system would do on real hospital reports. ${checked} The prompt was not tuned on this set: ${run.promptChangesAfterResults} prompt change${run.promptChangesAfterResults === 1 ? "" : "s"} made after seeing results (0 at first run; update this number if the prompt is changed and the evaluation is rerun).`,
    "",
  );
  return out.join("\n");
}
