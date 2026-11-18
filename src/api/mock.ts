import {
  cases,
  outcomeLabels,
  programme,
  stageIndex,
  stages,
  type Case,
  type Outcome,
  type StageId,
} from "../data";
import { ApiError, type NexyraApi } from "./client";
import type {
  Actor,
  AdvanceResult,
  CaseDetailResponse,
  CaseFilter,
  CaseListResponse,
  CaseSummary,
  Clock,
  MutationResult,
  OutreachInput,
  ProgramSummary,
  Role,
  Verification,
} from "./types";

// Adapter only: src/data.ts stays the single source of synthetic records, and every
// shape below is built from it. Nothing here writes back into src/data.ts.

const MODEL = "deepseek/deepseek-v4.1-flash-1017";
const REFERRAL_LIMIT_DAYS = 31;

const clock: Clock = {
  now: "2026-11-17T11:42:00+07:00",
  is_demo: true,
  day: 0,
  referral_limit_days: REFERRAL_LIMIT_DAYS,
  label: "17 Nov 2026 · 11:42",
};

// Loading states should be real, so every call costs a short round trip.
function respond<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), 150);
  });
}

function actorId(name: string): string {
  return `act_${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")}`;
}

function ownerActor(name: string): Actor {
  return {
    actor_id: actorId(name),
    role: name.startsWith("Dr.") ? "responsible_physician" : "coordination_staff",
    display_name: name,
  };
}

// flags carry the states the contract lets the server send; the worklist derives its
// data-state attribute from them rather than from a field the contract does not have.
function flagsFor(c: Case): string[] {
  const flags: string[] = [];
  if (c.state === "closed") flags.push("closed");
  if (c.state === "late") flags.push("late");
  if (c.hoursLeft !== null && c.hoursLeft < 48) flags.push("due");
  if (c.owner === null && c.state !== "closed") flags.push("unowned");
  return flags;
}

function renderableFor(c: Case): string[] {
  const renderable: string[] = [];
  if (c.state === "late") {
    renderable.push(`LATE — ${Math.abs(c.hoursLeft ?? 0)} hours over`);
  }
  if (c.owner === null && c.state !== "closed") renderable.push("Unowned");
  renderable.push(
    c.citations > 0
      ? `${c.citations} ${c.citations === 1 ? "citation" : "citations"}`
      : c.dueLabel,
  );
  return renderable;
}

function toSummary(c: Case): CaseSummary {
  const stage = stages.find((s) => s.id === c.stage);

  return {
    case_id: c.ref,
    patient: { display_name: c.patient, age: c.age, language: "en" },
    stage: c.stage,
    stage_label: stage?.label ?? c.stage,
    owner: c.owner === null ? null : ownerActor(c.owner),
    hours_left_stage: c.hoursLeft,
    days_left_stage: c.hoursLeft === null ? 0 : Math.round(c.hoursLeft / 24),
    // The fixtures carry no ingest timestamp, so the referral limit is reported as
    // the full limit for an open case rather than invented from the stage deadline.
    days_left_referral_limit: c.hoursLeft === null ? 0 : REFERRAL_LIMIT_DAYS,
    flags: flagsFor(c),
    flags_renderable: renderableFor(c),
  };
}

function passesFilter(c: Case, filter?: CaseFilter): boolean {
  if (!filter) return true;
  if (filter === "late") return c.state === "late";
  if (filter === "unowned") return c.owner === null && c.state !== "closed";
  return c.stage === "closure_proposed";
}

function actionsFor(stage: StageId, role: Role): string[] {
  const actions: string[] = [];
  const closed = stage === "closed";

  if (!closed && (role === "coordination_staff" || role === "navigator")) {
    actions.push("log_outreach");
  }
  if (role === "responsible_physician") {
    if (stage === "closure_proposed") actions.push("confirm_closure", "reject_proposal");
    if (closed) actions.push("reopen_case");
  }
  return actions;
}

function toDetail(c: Case, role: Role, stageOverride?: StageId): CaseDetailResponse {
  const stage = stageOverride ?? c.stage;
  const current = stageIndex(stage);
  const stageLabel = stages.find((s) => s.id === stage)?.label ?? stage;

  return {
    case: {
      case_id: c.ref,
      patient: { display_name: c.patient, age: c.age, language: "en" },
      stage,
      stage_label: stageLabel,
      owner: c.owner === null ? null : ownerActor(c.owner),
      status: stage === "closed" ? "closed" : "open",
      stage_due_label: c.dueLabel,
      final_outcome: c.outcome ?? null,
      outcomes: (Object.keys(outcomeLabels) as Outcome[]).map((o) => ({
        key: o,
        label: outcomeLabels[o],
      })),
    },
    stages: stages.map((s, i) => ({
      key: s.id,
      label: s.label,
      short_label: s.short,
      state: i < current ? "passed" : i === current ? "current" : "ahead",
    })),
    timeline: c.events.map((e, i) => ({
      event_id: `e_${c.ref}_${i}`,
      type: "event",
      actor: e.actor === "system" ? null : ownerActor(e.actor),
      occurred_at: e.at,
      recorded_at: e.at,
      summary: e.what,
      payload: { audit: e.audit },
    })),
    documents: [],
    tasks:
      stage === "closure_proposed"
        ? [
            {
              task_id: `t_${c.ref}_closure`,
              kind: "confirm_closure",
              owner: null,
              due_at: c.dueLabel,
              status: "open",
            },
          ]
        : [],
    outreach_attempts: c.attempts.map((a) => ({
      n: a.n,
      at: a.at,
      channel: a.channel,
      result: a.result,
      minutes: a.minutes,
    })),
    available_actions: actionsFor(stage, role),
    verification: {
      status: c.evidence.length > 0 ? "ready" : "pending",
      proposal: stage === "closure_proposed" ? "propose_closure" : "needs_human_reading",
    },
  };
}

// Offsets are computed here, never searched for in the client, as docs/api.md requires.
function toVerification(c: Case): Verification {
  const parts: string[] = [];
  let cursor = 0;

  const fields = c.evidence.map((e) => {
    const start = cursor;
    parts.push(e.quote);
    cursor += e.quote.length + 1;
    return {
      key: e.field,
      value: e.value,
      quote: e.quote,
      quote_offset: [start, start + e.quote.length] as [number, number],
      source: e.source,
      read_at: e.readAt,
      validated: true,
    };
  });

  return {
    report: { document_id: `d_${c.ref}`, text: parts.join("\n") },
    extraction: {
      prompt_version: "v1",
      model: MODEL,
      fields,
      proposal: fields.length > 0 ? "propose_closure" : "needs_human_reading",
      proposal_reason:
        fields.length > 0
          ? `${fields.length} extracted field(s) from ${c.evidence[0].source}`
          : "No report text was available for extraction.",
    },
  };
}

function findCase(caseId: string): Case {
  const found = cases.find((c) => c.ref === caseId);
  if (!found) throw new ApiError("not_found", `No case carries the reference ${caseId}.`);
  return found;
}

export const mockApi: NexyraApi = {
  async getClock() {
    return respond(clock);
  },

  // The fixtures carry no timers, so advancing the mock clock only moves the number.
  async advanceClock(days) {
    const next: Clock = {
      ...clock,
      day: days === "next_deadline" ? clock.day + 5 : clock.day + days,
    };
    return respond<AdvanceResult>({
      clock: next,
      escalations: 0,
      cases_advanced: 0,
      escalations_per_role: [],
    });
  },

  // Every role sees the same synthetic register in the prototype.
  async listCases(_role, filter) {
    const rows = cases.filter((c) => passesFilter(c, filter)).map(toSummary);
    return respond<CaseListResponse>({
      clock,
      // The twelve fixtures are a sample of a larger synthetic register, so the counters
      // are the fixture programme's own totals rather than a count of the rows below.
      counts: {
        open: programme.open,
        unowned: programme.unowned,
        past_deadline: programme.pastDeadline,
        awaiting_clinician: programme.awaitingClinician,
        closed_this_week: programme.closedThisWeek,
      },
      cases: rows,
    });
  },

  async getCase(caseId, role) {
    return respond(toDetail(findCase(caseId), role));
  },

  async getVerification(caseId) {
    return respond(toVerification(findCase(caseId)));
  },

  async getProgramme(role) {
    if (role !== "responsible_physician" && role !== "program_manager") {
      throw new ApiError("role_not_permitted", `The ${role} role may not read the program view.`);
    }
    // The fixture predates the endpoint, so the sections it has no numbers for are empty
    // rather than invented. The real figures come from GET /api/program/summary.
    const total = programme.open + programme.closedThisWeek;
    return respond<ProgramSummary>({
      clock: { now: clock.now, is_demo: clock.is_demo, day: clock.day },
      synthetic_data_label:
        "Synthetic data. Drop-off rates are input assumptions, not results.",
      counts: {
        total,
        open: programme.open,
        unowned: programme.unowned,
        due_today: programme.dueToday,
        due_today_unowned: 1,
        closed_this_week: programme.closedThisWeek,
        past_referral_limit: 0,
        closures_held: 0,
      },
      exceptions: programme.exceptions.map((e) => ({
        case_id: e.ref,
        kind: "unowned" as const,
        reason: e.reason,
        owner: e.owner,
        stage_label: "",
        due_at: null,
        due_label: e.due,
      })),
      unstitched: { available: false, count: 0, rows: [] },
      funnel: programme.byStage.map((s) => ({
        key: s.stage.toLowerCase().replace(/\s+/g, "_"),
        stage: s.stage,
        reached: s.open,
        open: s.open,
        unowned: s.unowned,
        median_days_from_previous: null,
        terminal: false,
      })),
      referral_to_colonoscopy: null,
      delay_reasons: [],
      escalations_per_role_per_day: [
        {
          role: "responsible_physician",
          role_label: "Responsible physician",
          total: programme.pastDeadline,
          per_day: programme.pastDeadline,
        },
      ],
      escalations_by_day: [],
      scenario: {
        title: "Scenario based on assumptions",
        cohort_cases: total,
        baseline_rate: 0.229,
        outreach_rate: 0.31,
        additional_completed: Math.round(total * (0.31 - 0.229)),
        source:
          "Atlas et al., JAMA 2023: follow-up completed 22.9% with usual care, 31.0% with reminder, letter and phone outreach",
        caveat:
          "One trial in one US health system. It does not say what would happen in Abu Dhabi, and it is not a result of Nexyra.",
      },
      pathway: { id: "fit-colonoscopy", label: "Positive FIT to colonoscopy, pathology and follow-up" },
    });
  },

  async confirmClosure(caseId, actor, _finalOutcome) {
    const c = findCase(caseId);
    if (actor.role !== "responsible_physician") {
      throw new ApiError("role_not_permitted", "Only the responsible physician confirms closure.");
    }
    if (c.stage !== "closure_proposed") {
      throw new ApiError(
        "closure_conditions_unmet",
        "Closure requires all three conditions: final outcome, attached evidence, physician confirmation.",
      );
    }
    return respond(toDetail(c, actor.role, "closure_confirmed"));
  },

  async reopenCase(caseId, actor) {
    const c = findCase(caseId);
    if (actor.role !== "responsible_physician") {
      throw new ApiError("role_not_permitted", "Only the responsible physician reopens a case.");
    }
    if (c.stage !== "closed") {
      throw new ApiError("invalid_transition", "Only a closed case can be reopened.");
    }
    const reopened: Case = {
      ...c,
      stage: "result_received",
      state: "normal",
      hoursLeft: 48,
      owner: c.owner ?? "R. Haddad",
    };
    return respond(toDetail(reopened, actor.role));
  },

  async logOutreach(caseId, input: OutreachInput, actor) {
    const c = findCase(caseId);
    if (actor.role !== "coordination_staff" && actor.role !== "navigator") {
      throw new ApiError("role_not_permitted", "Only coordination staff log outreach outcomes.");
    }
    if (!input.outcome) {
      throw new ApiError("validation_failed", "An outreach outcome is required.");
    }
    return respond<MutationResult>({ recorded: `e_${c.ref}_outreach` });
  },
};
