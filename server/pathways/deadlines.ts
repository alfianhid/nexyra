import { DEFAULT_PATHWAY, type Pathway } from "./index.js";

// `npm run pathway:deadlines`: every deadline in the template with its owner and its
// source, printed for the clinical review (TICKET-19). It reads the same validated
// template the engine runs, so the printout cannot drift from the code.

export type DeadlineRow = {
  kind: "stage" | "limit" | "outcome";
  item: string;
  label: string;
  deadline: string;
  owner: string;
  escalation: string;
  source: string;
};

function hoursText(hours: number | null): string {
  if (hours === null) return "none";
  if (hours % 24 !== 0) return `${hours} h`;
  const days = hours / 24;
  return `${hours} h (${days} ${days === 1 ? "day" : "days"})`;
}

export function deadlineRows(pathway: Pathway): DeadlineRow[] {
  const stages: DeadlineRow[] = pathway.stages.map((stage) => ({
    kind: "stage",
    item: stage.key,
    label: stage.label,
    deadline: hoursText(stage.sla_hours),
    owner: stage.owner_role,
    escalation: stage.escalation.join(" > ") || "-",
    source: stage.source,
  }));

  const limits: DeadlineRow[] = pathway.limits.map((limit) => ({
    kind: "limit",
    item: limit.label,
    label: `${limit.from_stage} to ${limit.to_stage}`,
    deadline: `${limit.max_days} days`,
    owner: "-",
    escalation: "-",
    source: limit.source,
  }));

  const outcomes: DeadlineRow[] = pathway.outcomes.map((outcome) => {
    const parts = [
      outcome.evidence.all_of.length > 0 ? `all of ${outcome.evidence.all_of.join(", ")}` : "",
      outcome.evidence.any_of.length > 0 ? `any of ${outcome.evidence.any_of.join(", ")}` : "",
    ].filter(Boolean);
    return {
      kind: "outcome",
      item: outcome.key,
      label: `evidence: ${parts.join("; ")}`,
      deadline: "-",
      owner: "responsible_physician confirms",
      escalation: "-",
      source: outcome.source,
    };
  });

  return [...stages, ...limits, ...outcomes];
}

function table(rows: DeadlineRow[], columns: (keyof DeadlineRow)[]): string {
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column]).length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  return [
    line(columns.map(String)),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => line(columns.map((column) => String(row[column])))),
  ].join("\n");
}

export function deadlineReport(pathway: Pathway): string {
  const rows = deadlineRows(pathway);
  const byKind = (kind: DeadlineRow["kind"]) => rows.filter((row) => row.kind === kind);
  return [
    `${pathway.label} (${pathway.id}, template version ${pathway.version})`,
    `Trigger: ${pathway.trigger.description}`,
    "",
    "Stage deadlines (from entering the stage)",
    table(byKind("stage"), ["item", "label", "deadline", "owner", "escalation", "source"]),
    "",
    "Limits across stages",
    table(byKind("limit"), ["item", "label", "deadline", "source"]),
    "",
    "Closure outcomes and the evidence each requires",
    table(byKind("outcome"), ["item", "label", "owner", "source"]),
    "",
    `Escalation levels fire at most once per ${pathway.escalation_spacing_hours} h of demo-clock time.`,
  ].join("\n");
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("server/pathways/deadlines.ts")) {
  console.log(deadlineReport(DEFAULT_PATHWAY));
}
