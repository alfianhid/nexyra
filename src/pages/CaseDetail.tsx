import { Link, useParams } from "react-router-dom";
import { Page, useRole, roleLabels } from "../components/Shell";
import { api, ApiError } from "../api";
import { roleFor } from "../api/roles";
import { useAsync } from "../hooks/useAsync";

export default function CaseDetail() {
  const { ref = "" } = useParams();
  const { role, clockVersion } = useRole();
  const detail = useAsync(() => api.getCase(ref, roleFor[role]), [ref, role, clockVersion]);
  const verification = useAsync(() => api.getVerification(ref, roleFor[role]), [
    ref,
    role,
    clockVersion,
  ]);

  if (detail.error) {
    if (detail.error instanceof ApiError && detail.error.code === "not_found") {
      return (
        <Page>
          <h1 style={{ fontSize: 30 }}>Case not found</h1>
          <p style={{ marginTop: 8, color: "var(--muted)" }}>
            No case carries the reference {ref}. <Link to="/cases">Back to the register</Link>.
          </p>
        </Page>
      );
    }
    return (
      <Page>
        <h1 style={{ fontSize: 30 }}>Case not found</h1>
        <p className="notice alarm" style={{ marginTop: 8 }}>
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
  const fields = verification.data?.extraction.fields ?? [];

  return (
    <Page>
      <div className="sheet-head">
        <h1>
          <span>{c.case.case_id}</span>
          {c.case.patient.display_name}, {c.case.patient.age}
        </h1>
        <div className="meta">
          Owner <b>{c.case.owner?.display_name ?? "unowned"}</b>
          <br />
          Deadline <b>{c.case.stage_due_label}</b>
          <br />
          Stage <b>{c.case.stage_label}</b>
          <br />
          Acting as <b>{roleLabels[role]}</b>
        </div>
      </div>

      <section className="section">
        <h2>Stage</h2>
        <p className="note">
          One case read across all seven stages at the same scale, so two cases compare without
          opening anything.
        </p>
        <div className="strip">
          {c.stages.map((s, i) => (
            <div
              key={s.key}
              data-done={s.state === "passed"}
              data-current={s.state === "current"}
              aria-current={s.state === "current" ? "step" : undefined}
            >
              <em>{String(i + 1).padStart(2, "0")}</em>
              <strong>{s.short_label}</strong>
              <small>{s.state === "passed" ? "done" : s.state === "current" ? "here" : "ahead"}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Evidence</h2>
        <p className="note">
          Extracted values carry the source quote and its character offset. The engine proposes;
          it does not close a case.
        </p>
        {fields.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            No result has been read for this case yet. Evidence appears once a report arrives.
          </p>
        ) : (
          <dl className="evidence">
            {fields.map((e) => (
              <div key={e.key}>
                <dt>{e.key}</dt>
                <dd>
                  <span className="value">{e.value}</span>
                  {e.validated ? (
                    <blockquote>{e.quote}</blockquote>
                  ) : (
                    <p className="note">Not found in the report</p>
                  )}
                  <div className="provenance">
                    {e.validated && <span>offset {e.quote_offset[0]}</span>}
                    <span>{e.source}</span>
                    <span>read {e.read_at}</span>
                  </div>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="section">
        <h2>Audit trail</h2>
        <p className="note">Append-only. Every entry names the actor and the system that wrote it.</p>
        <ul className="events">
          {c.timeline.map((e) => (
            <li key={e.event_id}>
              <span className="at">{e.occurred_at}</span>
              <span className="actor">{e.actor?.display_name ?? "system"}</span>
              <span>{e.summary}</span>
              <span className="audit">{String(e.payload.audit ?? "")}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>Next action</h2>
        <p className="note">
          Available actions come from the engine for this stage and this role, not from the screen.
        </p>
        <div className="actions">
          <Link className="btn" to={`/cases/${c.case.case_id}/outreach`}>
            Outreach ladder
          </Link>
          <Link className="btn primary" to={`/cases/${c.case.case_id}/closure`}>
            Closure review
          </Link>
          <Link className="btn" to="/cases">
            Back to register
          </Link>
        </div>
      </section>
    </Page>
  );
}
