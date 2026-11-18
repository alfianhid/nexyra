import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Page, useRole } from "../components/Shell";
import { api, ApiError } from "../api";
import { getOutreachLadder, recordPatientNotified } from "../api/outreach";
import { roleFor } from "../api/roles";
import type { Actor, DelayReason, OutreachAttempt, OutreachLadder } from "../api/types";
import { useAsync } from "../hooks/useAsync";

const channels: OutreachAttempt["channel"][] = ["call", "sms", "letter"];

// TICKET-10: the navigator has no screen (the picker keeps three roles, tickets/README.md).
// The form records the call as the navigator task's owner; this is only the fallback.
// Their task shows on this screen and in the program manager's register; the form below
// records the navigator's call with the navigator's own actor, so the audit line names them.
const NAVIGATOR: Actor = { actor_id: "act_002", role: "navigator", display_name: "Nur H." };

const stateWords: Record<string, string> = {
  done: "done",
  scheduled: "scheduled",
  not_needed: "not needed",
  stopped: "stopped",
};

function CallForm({
  id,
  caseId,
  actor,
  ladder,
  disabledReason,
  onLogged,
}: {
  id: string;
  caseId: string;
  actor: Actor;
  ladder: OutreachLadder;
  disabledReason: string | null;
  onLogged: () => void;
}) {
  const [channel, setChannel] = useState<OutreachAttempt["channel"]>("call");
  const [connected, setConnected] = useState<"yes" | "no">("no");
  const [reason, setReason] = useState<DelayReason | "">("");
  const [result, setResult] = useState("");
  const [notified, setNotified] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function log() {
    if (result.trim().length < 3) {
      setError("Write what happened on the attempt — at least a few words.");
      return;
    }
    setBusy(true);
    try {
      await api.logOutreach(
        caseId,
        {
          outcome: result.trim(),
          channel,
          minutes: channel === "call" ? 3 : 1,
          connected: connected === "yes",
          ...(reason ? { delay_reason: reason } : {}),
        },
        actor,
      );
      if (notified) await recordPatientNotified(caseId, actor, channel === "call" ? "phone" : channel);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The attempt could not be recorded.");
      setBusy(false);
      return;
    }
    setBusy(false);
    setError("");
    setResult("");
    setReason("");
    setNotified(false);
    // Re-read: the ladder, the tasks and the timeline come back from the server.
    onLogged();
  }

  const disabled = disabledReason !== null || busy;

  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-channel`}>Channel</label>
        <select
          id={`${id}-channel`}
          value={channel}
          disabled={disabled}
          onChange={(e) => setChannel(e.target.value as OutreachAttempt["channel"])}
        >
          {channels.map((ch) => (
            <option key={ch} value={ch}>
              {ch}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-connected`}>Reached the patient</label>
        <select
          id={`${id}-connected`}
          value={connected}
          disabled={disabled}
          onChange={(e) => setConnected(e.target.value as "yes" | "no")}
        >
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-reason`}>Reason for delay</label>
        <select
          id={`${id}-reason`}
          value={reason}
          disabled={disabled}
          onChange={(e) => setReason(e.target.value as DelayReason | "")}
        >
          <option value="">None recorded</option>
          {ladder.delay_reasons.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-result`}>What happened</label>
        <textarea
          id={`${id}-result`}
          value={result}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder="No answer after two rings; voicemail left in Arabic."
          onChange={(e) => setResult(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-notified`}>
          <input
            id={`${id}-notified`}
            type="checkbox"
            checked={notified}
            disabled={disabled}
            onChange={(e) => setNotified(e.target.checked)}
            style={{ width: "auto", marginInlineEnd: 8 }}
          />
          Patient understood the result and the next step
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} className="notice alarm" style={{ marginBottom: 14 }}>
          <strong>Attempt not logged</strong>
          {error}
        </p>
      )}
      <div className="actions">
        <button className="btn primary" type="button" onClick={log} disabled={disabled}>
          Log attempt as {actor.display_name}
        </button>
        {disabledReason && <p>{disabledReason}</p>}
      </div>
    </>
  );
}

export default function Outreach() {
  const { ref = "" } = useParams();
  const { role, actor, clockVersion } = useRole();
  const detail = useAsync(() => api.getCase(ref, roleFor[role]), [ref, role, clockVersion]);
  const ladderState = useAsync(
    () => getOutreachLadder(ref, roleFor[role]),
    [ref, role, clockVersion],
  );

  if (detail.error) {
    if (detail.error instanceof ApiError && detail.error.code === "not_found") {
      return (
        <Page>
          <h1 style={{ fontSize: 30 }}>Case not found</h1>
          <p style={{ marginTop: 8 }}>
            <Link to="/cases">Back to the register</Link>.
          </p>
        </Page>
      );
    }
    return (
      <Page>
        <p className="notice alarm">
          <strong>Case could not be read</strong>
          {detail.error.message}
        </p>
      </Page>
    );
  }

  // A case on a pathway with no outreach ladder (the mammography demo pathway) has no
  // screen here; the case page hides the link, and a typed URL lands on this notice.
  if (detail.data && detail.data.case.has_outreach === false) {
    return (
      <Page>
        <p className="notice">
          <strong>No outreach ladder on this pathway</strong>
          {detail.data.case.case_id} runs {detail.data.case.pathway?.short_label ?? "another pathway"}, which has no
          patient message templates or outreach ladder. <Link to={`/cases/${detail.data.case.case_id}`}>Back to the case</Link>.
        </p>
      </Page>
    );
  }

  if (detail.loading || !detail.data || !ladderState.data) {
    return (
      <Page>
        {ladderState.error ? (
          <p className="notice alarm">
            <strong>Outreach ladder could not be read</strong>
            {ladderState.error.message}
          </p>
        ) : (
          <p className="notice">Reading the case…</p>
        )}
      </Page>
    );
  }

  const c = detail.data;
  const ladder = ladderState.data;
  // The attempts are a projection of the timeline, so the server's array is the only copy.
  const attempts = c.outreach_attempts;
  const totalMinutes = attempts.reduce((sum, a) => sum + a.minutes, 0);

  const canLog = c.available_actions.includes("log_outreach");
  const navigatorStep = ladder.ladder.find((step) => step.key === "navigator");
  const navigatorTaskOpen = navigatorStep?.task?.status === "open";
  // The call is recorded as the person the server gave the navigator task to.
  const taskOwner = navigatorStep?.task?.owner;
  const navigator: Actor = taskOwner
    ? { actor_id: taskOwner.actor_id, role: taskOwner.role as Actor["role"], display_name: taskOwner.display_name }
    : NAVIGATOR;

  function reload() {
    detail.reload();
    ladderState.reload();
  }

  return (
    <Page>
      <div className="sheet-head">
        <h1>
          <span>{c.case.case_id} · outreach</span>
          {c.case.patient.display_name}, {c.case.patient.age}
        </h1>
        <div className="meta">
          Owner <b>{c.case.owner?.display_name ?? "unowned"}</b>
          <br />
          Deadline <b>{c.case.stage_due_label}</b>
          <br />
          Ladder <b>{ladder.status_label}</b>
          <br />
          Attempts <b>{attempts.length}</b> · minutes <b>{totalMinutes}</b>
        </div>
      </div>

      <section className="section">
        <h2>Ladder</h2>
        <p className="note">
          Automated message first, then a staff call, then the navigator. Each step fires on the
          demo clock when its deadline passes; a delay reason recorded by staff sends the case to
          the navigator at once. The ladder stops when the patient confirms or the case moves on.
          {ladder.stopped_reason ? ` ${ladder.stopped_reason}` : ""}
        </p>
        <ul className="ladder">
          {ladder.ladder.map((step) => (
            <li key={step.key} data-done={step.state === "done"}>
              <span className="n">{String(step.n).padStart(2, "0")}</span>
              <span className="ch">{step.label}</span>
              <span className="m">{step.at_label ?? (step.due_label ? `due ${step.due_label}` : "")}</span>
              <span>
                {step.detail}
                {step.task && (
                  <>
                    {" "}
                    · task for {step.task.owner?.display_name ?? "nobody"}, due {step.task.due_label} (
                    {step.task.status})
                  </>
                )}
              </span>
              <span className="m">{stateWords[step.state] ?? step.state}</span>
            </li>
          ))}
        </ul>
        <p className="note" style={{ marginTop: 12, marginBottom: 0 }}>
          Step deadlines:{" "}
          {ladder.parameters.map((p) => `${p.label.toLowerCase()} ${p.hours}h`).join("; ")}. Source:{" "}
          {ladder.parameters[0]?.source ?? "unsourced"}.
        </p>
      </section>

      <section className="section">
        <h2>Message</h2>
        <p className="note">
          {ladder.message.sent
            ? `Sent ${ladder.message.sent_label} as ${ladder.message.channel.toUpperCase()} (simulated delivery). `
            : "Not sent yet. This is the text step 1 will send. "}
          Fixed template text with the name, date, place and phone filled in; no wording is
          generated when it is sent. {ladder.message.review_note}
        </p>
        <p className="notice" dir={ladder.message.dir} lang={ladder.message.language}>
          {ladder.message.text}
        </p>
        <div className="actions" style={{ marginTop: 14 }}>
          {ladder.link ? (
            <Link className="btn" to={ladder.link.path} target="_blank" rel="noopener">
              Open the patient page (simulated link)
            </Link>
          ) : (
            <p>The patient link is created with the message.</p>
          )}
          {ladder.patient_response && (
            <p>
              Patient answered {ladder.patient_response.at_label}:{" "}
              {ladder.patient_response.response === "understood"
                ? "understood and will come"
                : "asked for a phone call"}
              .
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <h2>Attempts</h2>
        <p className="note">Every call, SMS or letter logged by a person, oldest first.</p>
        <ul className="ladder">
          {attempts.length === 0 && (
            <li data-done={false}>
              <span className="n">—</span>
              <span className="ch">none</span>
              <span className="m"></span>
              <span>No attempt logged yet</span>
              <span className="m"></span>
            </li>
          )}
          {attempts.map((a) => (
            <li key={a.n} data-done>
              <span className="n">{String(a.n).padStart(2, "0")}</span>
              <span className="ch">{a.channel}</span>
              <span className="m">{a.at}</span>
              <span>{a.result}</span>
              <span className="m">{a.minutes} min</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>Log an attempt</h2>
        <p className="note">
          Logging writes an audit line and does not move the stage. A reason for delay is a fixed
          choice, not free text, and escalates the case to the navigator.
        </p>
        <CallForm
          id="staff"
          caseId={c.case.case_id}
          actor={actor}
          ladder={ladder}
          disabledReason={
            canLog ? null : "Your role does not log patient outreach (coordination staff and navigators do)."
          }
          onLogged={reload}
        />
        <div className="actions" style={{ marginTop: 14 }}>
          <Link className="btn" to={`/cases/${c.case.case_id}`}>
            Back to case
          </Link>
        </div>
      </section>

      {navigatorTaskOpen && navigatorStep?.task && (
        <section className="section">
          <h2>Navigator call</h2>
          <p className="note">
            Task for {navigatorStep.task.owner?.display_name ?? "the navigator"}, due{" "}
            {navigatorStep.task.due_label}. The navigator has no screen in this prototype (the role
            picker keeps three roles); the program manager sees this task in the register, and this
            form records the navigator&apos;s call as {navigator.display_name}.
          </p>
          <CallForm
            id="navigator"
            caseId={c.case.case_id}
            actor={navigator}
            ladder={ladder}
            disabledReason={null}
            onLogged={reload}
          />
        </section>
      )}
    </Page>
  );
}
