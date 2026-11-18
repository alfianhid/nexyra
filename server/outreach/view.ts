import { addHours, formatDue, getClock } from "../clock.js";
import type { Db } from "../db.js";
import { DELAY_REASONS } from "../events.js";
import {
  OUTREACH_EVENTS,
  TASK_KINDS,
  caseIdForToken,
  composeMessage,
  isLadderActive,
  loadLadderCase,
  runFacts,
  runIdOf,
  stepsFor,
  tokenFor,
  type StepRow,
} from "./ladder.js";
import {
  LADDER,
  TEMPLATES,
  clinicPlace,
  parameterHours,
  patientDate,
  patientPath,
  renderAll,
  templateFor,
  writtenTemplateFor,
  type LadderParameterKey,
} from "./templates.js";

// Reads only. The staff view of the ladder (GET /api/cases/{id}/outreach) and the
// patient page (GET /api/patient/{token}). Labels are formatted here, as elsewhere on the
// server, so the client prints strings and never derives a date.

type TaskRow = {
  id: string;
  kind: string;
  owner_actor_id: string | null;
  owner_name: string | null;
  owner_role: string | null;
  due_at: string;
  status: string;
};

function parse(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function eventPayload(db: Db, id: string | null): Promise<Record<string, unknown>> {
  if (!id) return {};
  const row = await db.prepare("SELECT payload FROM events WHERE id = ?").get<{ payload: string }>(id);
  return parse(row?.payload);
}

async function task(db: Db, id: string | null): Promise<TaskRow | null> {
  if (!id) return null;
  const row = await db
    .prepare(
      `SELECT t.id, t.kind, t.owner_actor_id, t.due_at, t.status,
              a.display_name AS owner_name, a.role AS owner_role
         FROM tasks t LEFT JOIN actors a ON a.id = t.owner_actor_id
        WHERE t.id = ?`,
    )
    .get<TaskRow>(id);
  return row ?? null;
}

function taskView(row: TaskRow | null) {
  if (!row) return null;
  return {
    task_id: row.id,
    kind: row.kind,
    owner:
      row.owner_actor_id === null
        ? null
        : {
            actor_id: row.owner_actor_id,
            role: row.owner_role ?? "coordination_staff",
            display_name: row.owner_name ?? row.owner_actor_id,
          },
    due_at: row.due_at,
    due_label: formatDue(row.due_at),
    status: row.status,
  };
}

type StepState = "done" | "scheduled" | "not_needed" | "stopped";

const DELAY_REASON_LABELS: Record<string, string> = {
  fear: "Fear (of the test, the preparation or the result)",
  transport: "Transport",
  cost: "Cost",
  language: "Language",
  other: "Other",
};

function parameters() {
  return (Object.keys(LADDER.parameters) as LadderParameterKey[]).map((key) => ({
    key,
    hours: LADDER.parameters[key].hours,
    label: LADDER.parameters[key].label,
    source: LADDER.parameters[key].source,
  }));
}

// The run the staff screen shows: the current one while the ladder is active, otherwise
// the most recent run that has any step (so a finished ladder stays readable).
function displayedRun(currentRun: string, all: readonly StepRow[], active: boolean): string {
  if (active || all.some((row) => row.run_id === currentRun)) return currentRun;
  return all.at(-1)?.run_id ?? currentRun;
}

export async function getOutreachLadder(db: Db, caseId: string) {
  const now = (await getClock(db)).now;
  const c = await loadLadderCase(db, caseId);
  const active = isLadderActive(c);
  const allSteps = await stepsFor(db, caseId);
  const runId = displayedRun(runIdOf(c), allSteps, active);
  const steps = allSteps.filter((row) => row.run_id === runId);
  const byStep = (name: string) => steps.find((row) => row.step === name);

  const message = byStep("message");
  const staffCall = byStep("staff_call");
  const callback = byStep("callback");
  const navigator = byStep("navigator");
  const facts = await runFacts(db, caseId, runId, message?.fired_at ?? null);
  const token = await tokenFor(db, caseId);

  const stoppedReason = facts.acknowledged
    ? "The patient confirmed on the patient page."
    : !active && (message || steps.length > 0)
      ? c.status === "closed"
        ? "The case is closed."
        : `The case moved on to ${c.stage.replace(/_/g, " ")}.`
      : null;
  const stopped = stoppedReason !== null;

  // The message as sent (its stored payload), or a preview of what step 1 will send.
  const sentPayload = await eventPayload(db, message?.event_id ?? null);
  const preview = composeMessage(c, token ?? "<token>", now);
  const messageView = message
    ? {
        sent: true,
        sent_at: message.fired_at,
        sent_label: formatDue(message.fired_at),
        channel: String(sentPayload.channel ?? "sms"),
        delivery: "simulated",
        language: String(sentPayload.language ?? preview.language),
        dir: sentPayload.dir === "rtl" ? "rtl" : "ltr",
        text: String(sentPayload.text ?? ""),
        language_fallback: sentPayload.language_fallback === true,
        review_status: String(sentPayload.review_status ?? preview.review_status),
        review_note: templateFor(String(sentPayload.language ?? preview.language))?.review_note ?? "",
      }
    : {
        sent: false,
        sent_at: null,
        sent_label: null,
        channel: preview.channel,
        delivery: "simulated",
        language: preview.language,
        dir: preview.dir,
        text: preview.text,
        language_fallback: preview.language_fallback,
        review_status: preview.review_status,
        review_note: templateFor(preview.language)?.review_note ?? "",
      };

  const staffTask = taskView(await task(db, staffCall?.task_id ?? null));
  const callbackTask = taskView(await task(db, callback?.task_id ?? null));
  const navigatorTask = taskView(await task(db, navigator?.task_id ?? null));
  const navigatorPayload = await eventPayload(db, navigator?.event_id ?? null);

  const firstCall = [staffCall, callback]
    .filter((row): row is StepRow => row !== undefined)
    .sort((a, b) => Date.parse(a.fired_at) - Date.parse(b.fired_at))[0];

  const staffDue = message ? addHours(message.fired_at, parameterHours("staff_call_after_hours")) : null;
  const navigatorDue = firstCall
    ? addHours(firstCall.fired_at, parameterHours("navigator_after_hours"))
    : null;

  const state = (fired: StepRow | undefined, skipped: boolean): StepState =>
    fired ? "done" : stopped ? "stopped" : skipped ? "not_needed" : "scheduled";

  const ladder = [
    {
      key: "message",
      n: 1,
      label: "Automated message",
      role: "system",
      state: state(message, false),
      at_label: message ? formatDue(message.fired_at) : null,
      due_label: message ? null : active ? "on the next clock tick" : null,
      detail: message
        ? `${messageView.channel.toUpperCase()} in ${messageView.language}, link to the patient page (simulated)`
        : "Sent when the case is at Result received",
      task: null,
    },
    {
      key: "staff_call",
      n: 2,
      label: "Staff call",
      role: "coordination_staff",
      state: state(staffCall, callback !== undefined || navigator !== undefined),
      at_label: staffCall ? formatDue(staffCall.fired_at) : null,
      due_label: staffCall || callback || navigator || stopped || !staffDue ? null : formatDue(staffDue),
      detail: staffCall
        ? `No answer within ${parameterHours("staff_call_after_hours")}h of the message`
        : callback
          ? "Not needed: the patient asked for a call"
          : navigator
            ? "Not needed: escalated to the navigator on a barrier"
            : `If the patient does not answer within ${parameterHours("staff_call_after_hours")}h`,
      task: staffTask,
    },
    ...(callback
      ? [
          {
            key: "callback",
            n: 2,
            label: "Call the patient asked for",
            role: "coordination_staff",
            state: "done" as StepState,
            at_label: formatDue(callback.fired_at),
            due_label: null,
            detail: "The patient pressed “I would like a phone call”",
            task: callbackTask,
          },
        ]
      : []),
    {
      key: "navigator",
      n: 3,
      label: "Navigator",
      role: "navigator",
      state: state(navigator, false),
      at_label: navigator ? formatDue(navigator.fired_at) : null,
      due_label: navigator || stopped || !navigatorDue ? null : formatDue(navigatorDue),
      detail: navigator
        ? navigator.reason === "barrier"
          ? `Staff recorded a barrier: ${String(navigatorPayload.delay_reason ?? "")}`
          : `No movement ${parameterHours("navigator_after_hours")}h after the call step`
        : `If the case has not moved ${parameterHours("navigator_after_hours")}h after the call step, ` +
          "or at once when staff record a delay reason",
      task: navigatorTask,
    },
  ];

  const status = facts.acknowledged
    ? "acknowledged"
    : stopped
      ? "stopped"
      : navigator
        ? "navigator"
        : staffCall || callback
          ? "staff_call"
          : message
            ? "waiting_for_patient"
            : "not_started";

  const STATUS_LABELS: Record<string, string> = {
    acknowledged: "Stopped: the patient confirmed",
    stopped: "Stopped",
    navigator: "With the navigator",
    staff_call: "Staff call",
    waiting_for_patient: "Waiting for the patient",
    not_started: active ? "Message goes out on the next clock tick" : "Not started",
  };

  return {
    case_id: c.id,
    patient_language: c.patient_language,
    active,
    status,
    status_label: STATUS_LABELS[status] ?? status,
    stopped_reason: stoppedReason,
    link: token ? { token, path: patientPath(token) } : null,
    message: messageView,
    ladder,
    patient_response: facts.acknowledged
      ? { response: "understood", at_label: formatDue(facts.acknowledged.at) }
      : facts.callback
        ? { response: "request_call", at_label: formatDue(facts.callback.at) }
        : null,
    delay_reasons: DELAY_REASONS.map((key) => ({ key, label: DELAY_REASON_LABELS[key] ?? key })),
    parameters: parameters(),
    template_note: LADDER.notes,
    navigator_task_kind: TASK_KINDS.navigator,
  };
}

// GET /api/patient/{token}. The page in the patient's language, or in the language they
// picked on the page; a draft slot falls back to English and says so.
export async function getPatientPage(db: Db, token: string, requestedLanguage?: unknown) {
  const caseId = await caseIdForToken(db, token);
  const c = await loadLadderCase(db, caseId);
  const now = (await getClock(db)).now;

  const language =
    typeof requestedLanguage === "string" && LADDER.languages.includes(requestedLanguage)
      ? requestedLanguage
      : LADDER.languages.includes(c.patient_language)
        ? c.patient_language
        : LADDER.default_language;
  const { template, requested, fallback } = writtenTemplateFor(language);

  const allSteps = await stepsFor(db, caseId);
  const message = allSteps.filter((row) => row.step === "message").at(-1);
  // The patient's last answer on this link, whichever run it belonged to.
  const lastResponse = await db
    .prepare(
      `SELECT type, occurred_at, payload FROM events
        WHERE case_id = ? AND type IN (?, ?) ORDER BY rowid DESC LIMIT 1`,
    )
    .get<{ type: string; occurred_at: string; payload: string }>(
      caseId,
      OUTREACH_EVENTS.acknowledged,
      OUTREACH_EVENTS.callback_requested,
    );

  const callbackPayload =
    lastResponse?.type === OUTREACH_EVENTS.callback_requested ? parse(lastResponse.payload) : {};
  const callbackDue =
    typeof callbackPayload.due_at === "string"
      ? callbackPayload.due_at
      : addHours(now, parameterHours("callback_due_hours"));
  const replyBy = addHours(message?.fired_at ?? now, parameterHours("staff_call_after_hours"));

  const content = renderAll(template, {
    name: c.patient_name,
    date: patientDate(replyBy, template.date_locale),
    place: clinicPlace(template.language),
    phone: LADDER.clinic.phone,
    link: patientPath(token),
    callback_date: patientDate(callbackDue, template.date_locale),
  });

  const response =
    lastResponse?.type === OUTREACH_EVENTS.acknowledged
      ? "understood"
      : lastResponse?.type === OUTREACH_EVENTS.callback_requested
        ? "request_call"
        : null;

  return {
    // Already in the greeting; sent apart so the page can isolate it inside Arabic text.
    patient_name: c.patient_name,
    language,
    language_name: requested?.language_name ?? language,
    // The text is in content_language; lang and dir on the page follow the text, not the
    // choice, so an English fallback is never laid out right-to-left.
    content_language: template.language,
    dir: template.dir,
    fallback,
    fallback_notice: fallback ? content.draft_notice : null,
    review_status: template.review_status,
    review_note: template.review_note,
    languages: LADDER.languages.map((code) => {
      const t = TEMPLATES.find((item) => item.language === code);
      return {
        code,
        name: t?.language_name ?? code,
        dir: t?.dir ?? "ltr",
        review_status: t?.review_status ?? "draft_slot",
        label:
          t?.review_status === "draft_slot"
            ? "draft, not reviewed by a native speaker"
            : t?.review_status === "written_not_reviewed"
              ? "not yet reviewed by a native speaker"
              : null,
      };
    }),
    content,
    response,
    response_text:
      response === "understood"
        ? content.acknowledged
        : response === "request_call"
          ? content.callback_requested
          : null,
    phone: LADDER.clinic.phone,
  };
}
