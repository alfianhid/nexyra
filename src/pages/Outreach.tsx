import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Page, useRole } from "../components/Shell";
import { api, ApiError } from "../api";
import { roleFor } from "../api/roles";
import type { OutreachAttempt, Role, Actor } from "../api/types";
import { useAsync } from "../hooks/useAsync";

const channels: OutreachAttempt["channel"][] = ["call", "sms", "letter"];

// Enough of an actor to satisfy the write's header until Phase 6 sends the real one.
function actorFor(role: Role): Actor {
  return { actor_id: `act_${role}`, role, display_name: role };
}

export default function Outreach() {
  const { ref = "" } = useParams();
  const { role } = useRole();
  const detail = useAsync(() => api.getCase(ref, roleFor[role]), [ref, role]);
  const [logged, setLogged] = useState<OutreachAttempt[] | null>(null);
  const [channel, setChannel] = useState<OutreachAttempt["channel"]>("call");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

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

  if (detail.loading || !detail.data) {
    return (
      <Page>
        <p className="notice">Reading the case…</p>
      </Page>
    );
  }

  const c = detail.data;
  const attempts = logged ?? c.outreach_attempts;

  const totalMinutes = attempts.reduce((sum, a) => sum + a.minutes, 0);
  const nextStep =
    attempts.length < 2
      ? "Second call before the SMS step"
      : attempts.length === 2
        ? "SMS to the registered number"
        : "Letter, then escalate to the program manager";

  async function log() {
    if (result.trim().length < 3) {
      setError("Write what happened on the attempt — at least a few words.");
      return;
    }
    try {
      await api.logOutreach(
        c.case.case_id,
        { outcome: result.trim() },
        actorFor(roleFor[role]),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The attempt could not be recorded.");
      return;
    }
    setError("");
    setLogged([
      ...attempts,
      {
        n: attempts.length + 1,
        at: "17 Nov 11:42",
        channel,
        result: result.trim(),
        minutes: channel === "call" ? 3 : 1,
      },
    ]);
    setResult("");
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
          Attempts <b>{attempts.length}</b>
          <br />
          Contact minutes <b>{totalMinutes}</b>
        </div>
      </div>

      <section className="section">
        <h2>Ladder</h2>
        <p className="note">
          Each attempt is timed against the deadline. The ladder stops when the patient answers, and
          the next step is named rather than implied.
        </p>
        <ul className="ladder">
          {[1, 2, 3, 4].map((n) => {
            const a = attempts.find((x) => x.n === n);
            return (
              <li key={n} data-done={Boolean(a)}>
                <span className="n">{String(n).padStart(2, "0")}</span>
                <span className="ch">{a ? a.channel : n < 3 ? "call" : n === 3 ? "sms" : "letter"}</span>
                <span className="m">{a ? a.at : "not logged"}</span>
                <span>{a ? a.result : "expected step"}</span>
                <span className="m">{a ? `${a.minutes} min` : ""}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section">
        <h2>Log an attempt</h2>
        <p className="note">
          Next step: {nextStep}. Logging writes an audit line and moves the deadline only if the
          pathway template says so.
        </p>
        <div className="field">
          <label htmlFor="channel">Channel</label>
          <select id="channel" value={channel} onChange={(e) => setChannel(e.target.value as OutreachAttempt["channel"])}>
            {channels.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="result">What happened</label>
          <textarea
            id="result"
            value={result}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "result-error" : undefined}
            placeholder="No answer after two rings; voicemail left in Arabic."
            onChange={(e) => setResult(e.target.value)}
          />
        </div>
        {error && (
          <p id="result-error" className="notice alarm" style={{ marginBottom: 14 }}>
            <strong>Attempt not logged</strong>
            {error}
          </p>
        )}
        <div className="actions">
          <button className="btn primary" type="button" onClick={log}>
            Log attempt
          </button>
          <Link className="btn" to={`/cases/${c.case.case_id}`}>
            Back to case
          </Link>
        </div>
      </section>
    </Page>
  );
}
