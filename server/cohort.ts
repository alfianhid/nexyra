// TICKET-17: the synthetic cohort (`scripts/generate/`, about 1,000 cases with ids
// starting SY-) is loaded by `npm run demo:reset` as the programme's history.
//
// - The programme view counts it: that is what it is for.
// - The worklist and the unowned queue hide it unless asked (`?cohort=include`), so the
//   three demo cases are what a user sees first.
// - The demo clock does not escalate it. The cohort was generated as finished history
//   with no timers, so a tick over it would not show what Nexyra does day to day; it
//   would replay a backlog at once (measured: 753 escalations, 120 referrals expired and
//   128 automated messages on the first "+1 day").
//
// Ids are the only marker: no column, so nothing in the schema changes.

export const COHORT_PREFIX = "SY-";

export function isCohortCase(caseId: string): boolean {
  return caseId.startsWith(COHORT_PREFIX);
}

// For a WHERE clause on a case id column. The prefix is a constant, never user input.
export function notCohortSql(column: string): string {
  return `${column} NOT LIKE '${COHORT_PREFIX}%'`;
}

// The same, or no restriction when the caller includes the cohort.
export function cohortFilterSql(column: string, includeCohort: boolean): string {
  return includeCohort ? "1 = 1" : notCohortSql(column);
}

// Options for the clock's tick. `includeCohort` exists for the performance check
// (scripts/perf.ts runs one tick over all 1,003 cases); the API never sets it.
export type TickOptions = { includeCohort?: boolean };
