import { FIELD_LABELS, type ExtractionField, type FieldKey } from "./fields.js";

// TICKET-13 proposal rules, in plain code. The model never chooses the proposal: it only
// copies what the report says, and these rules read the validated fields. A proposal is
// never a decision; closing a case stays a responsible physician's act (TICKET-05).

export const PROPOSALS = [
  "reopen",
  "wait_for_pathology",
  "needs_human_reading",
  "propose_closure",
] as const;

export type Proposal = (typeof PROPOSALS)[number];

// The outcome keys from docs/api.md (`outcomes` on the case view).
export type ProposedOutcome = "returned_to_routine_screening" | "surveillance_scheduled";

export type ProposalDecision = {
  proposal: Proposal;
  proposal_reason: string;
  // Set only with propose_closure: the outcome the physician is asked to confirm.
  proposed_outcome: ProposedOutcome | null;
};

// Category → outcome for a closure proposal. Cancer has no entry on purpose: the outcome
// `oncology_accepted_therapy_started` needs evidence that oncology accepted the patient
// and therapy started, and a colonoscopy or pathology report cannot contain that.
const OUTCOME_FOR_CATEGORY: Readonly<Record<string, ProposedOutcome>> = {
  normal: "returned_to_routine_screening",
  polyp: "surveillance_scheduled",
};

function valueOf(fields: readonly ExtractionField[], key: FieldKey): string {
  return fields.find((field) => field.key === key)?.value ?? "unknown";
}

function sentence(parts: string[]): string {
  const text = parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
    : (parts[0] ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function decideProposal(fields: readonly ExtractionField[]): ProposalDecision {
  const exam = valueOf(fields, "complete_exam");
  const prep = valueOf(fields, "adequate_prep");
  const tissue = valueOf(fields, "tissue_taken");
  const pathology = valueOf(fields, "pathology_available");
  const category = valueOf(fields, "outcome_category");

  // 1. The examination itself has to be repeated. Wins over everything else, because it
  //    keeps the case open whatever the rest of the report says.
  const failed: string[] = [];
  if (exam === "no") failed.push("incomplete exam");
  if (prep === "no") failed.push("inadequate prep");
  if (failed.length > 0) {
    return { proposal: "reopen", proposal_reason: sentence(failed), proposed_outcome: null };
  }

  // 2. Tissue went to the lab and the result is not back.
  if (tissue === "yes" && pathology === "no") {
    return {
      proposal: "wait_for_pathology",
      proposal_reason: "Tissue taken; pathology not yet available",
      proposed_outcome: null,
    };
  }

  // 3. Anything the closure depends on that the report does not state (or that failed
  //    citation validation). Pathology only matters when tissue was taken.
  const keys: FieldKey[] = ["complete_exam", "adequate_prep", "tissue_taken", "outcome_category"];
  if (tissue === "yes") keys.push("pathology_available");
  const missing = keys.filter((key) => {
    const value = valueOf(fields, key);
    return value === "unknown" || value === "not_stated";
  });
  if (missing.length > 0) {
    return {
      proposal: "needs_human_reading",
      proposal_reason: `Not found in the report: ${missing.map((key) => FIELD_LABELS[key]).join(", ")}`,
      proposed_outcome: null,
    };
  }

  // 4. Cancer never produces a closure proposal (see OUTCOME_FOR_CATEGORY).
  const outcome = OUTCOME_FOR_CATEGORY[category];
  if (!outcome) {
    return {
      proposal: "needs_human_reading",
      proposal_reason:
        category === "cancer"
          ? "Cancer reported; closure needs evidence that oncology accepted the patient and therapy started, which a report does not contain"
          : `Outcome category "${category}" has no closure outcome`,
      proposed_outcome: null,
    };
  }

  // 5. A polyp that was seen but not removed or sampled is a contradiction a human has to
  //    read, not a surveillance closure.
  if (category === "polyp" && tissue !== "yes") {
    return {
      proposal: "needs_human_reading",
      proposal_reason: "Polyp reported but the report does not say tissue was taken",
      proposed_outcome: null,
    };
  }

  // 6. Everything checks out: propose, and let the physician decide.
  return {
    proposal: "propose_closure",
    proposal_reason:
      outcome === "returned_to_routine_screening"
        ? "Complete exam, adequate prep, no abnormality reported; proposed outcome: returned to routine screening"
        : "Complete exam, adequate prep, polyp with pathology available; proposed outcome: surveillance scheduled",
    proposed_outcome: outcome,
  };
}

// For a stored extraction (cache hit) whose proposal was decided when it was read.
export function proposedOutcomeFor(
  proposal: string,
  fields: readonly ExtractionField[],
): ProposedOutcome | null {
  if (proposal !== "propose_closure") return null;
  return OUTCOME_FOR_CATEGORY[valueOf(fields, "outcome_category")] ?? null;
}
