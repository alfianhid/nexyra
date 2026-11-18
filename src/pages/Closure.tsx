import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Page, useRole } from "../components/Shell";
import { api, ApiError } from "../api";
import { readLatestReport, rejectProposal, reopenWithReason } from "../api/caseSteps";
import { roleFor } from "../api/roles";
import { useAsync } from "../hooks/useAsync";
import type { CaseDetailResponse, Proposal, TimelineEvent } from "../api/types";

// The AI's proposal in words. It is printed as a proposal, never as a decision: the
// decision is the clinician's, below.
const PROPOSAL_LABEL: Record<Proposal, string> = {
  reopen: "Reopen the case",
  wait_for_pathology: "Wait for pathology",
  needs_human_reading: "Needs a human reading",
  propose_closure: "Propose closure",
};

type Decision = { kind: "confirmed" | "reopened" | "rejected"; event: TimelineEvent | undefined };

function recordedEvent(written: CaseDetailResponse & { recorded: string }): TimelineEvent | undefined {
  return written.timeline.find((e) => e.event_id === written.recorded);
}

export default function Closure() {
  const { ref = "" } = useParams();
  const { role, actor, clockVersion } = useRole();
  const detail = useAsync(() => api.getCase(ref, roleFor[role]), [ref, role, clockVersion]);
  const verification = useAsync(() => api.getVerification(ref, roleFor[role]), [
    ref,
    role,
    clockVersion,
  ]);
  // null means "not chosen yet": the select falls back to the case's own outcome.
  const [outcome, setOutcome] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");

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

  if (!detail.data) {
    return (
      <Page>
        <p className="notice">Reading the case…</p>
      </Page>
    );
  }

  const c = detail.data;
  const fields = verification.data?.extraction.fields ?? [];
  const extraction = verification.data?.extraction;
  const report = verification.data?.report;
  const chosen = outcome ?? c.case.final_outcome ?? extraction?.proposed_outcome ?? c.case.outcomes[0]?.key ?? "";
  // The gates are the server's answers: available_actions is computed by the engine from
  // the caller's role and the case state (docs/api.md).
  const canConfirm = c.available_actions.includes("confirm_closure");
  const canReopen = c.available_actions.includes("reopen_case");
  const canReject = c.available_actions.includes("reject_proposal");
  const awaiting = c.case.awaiting_closure ?? (canConfirm || canReject);
  // Only a citation the server validated against the report text counts as evidence.
  const citations = fields.filter((f) => f.validated).length;
  const notRead = extraction?.origin === "not_read";
  const proposalLabel = extraction
    ? notRead
      ? "Latest report not read yet"
      : (PROPOSAL_LABEL[extraction.proposal] ?? extraction.proposal)
    : "Not read yet";

  async function write(kind: Decision["kind"], call: () => Promise<CaseDetailResponse & { recorded: string }>) {
    setBusy(true);
    setError("");
    try {
      const written = await call();
      setDecision({ kind, event: recordedEvent(written) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The decision could not be recorded.");
      setBusy(false);
      return;
    }
    setBusy(false);
    detail.reload();
    verification.reload();
  }

  function confirm() {
    if (!canConfirm) return;
    if (citations === 0) {
      setError("This proposal carries no citation. A closure cannot be confirmed without evidence.");
      return;
    }
    void write("confirmed", () => api.confirmClosure(c.case.case_id, actor, chosen) as Promise<CaseDetailResponse & { recorded: string }>);
  }

  function reopen() {
    if (!canReopen) return;
    void write("reopened", () => reopenWithReason(c.case.case_id, actor, reason.trim() || undefined));
  }

  function reject() {
    if (!canReject) return;
    if (reason.trim().length < 5) {
      setError("Say in a few words why the proposal does not hold.");
      return;
    }
    void write("rejected", () => rejectProposal(c.case.case_id, actor, reason.trim()));
  }

  async function readReport() {
    setReading(true);
    setReadError("");
    try {
      await readLatestReport(c.case.case_id, actor);
    } catch (e) {
      setReadError(e instanceof ApiError ? e.message : "The report could not be read.");
    }
    setReading(false);
    verification.reload();
    detail.reload();
  }

  const who = decision?.event?.actor?.display_name ?? actor.display_name;
  const when = decision?.event?.occurred_label ?? "";

  return (
    <Page>
      <div className="sheet-head">
        <h1>
          <span>{c.case.case_id} · closure review</span>
          {c.case.patient.display_name}, {c.case.patient.age}
        </h1>
        <div className="meta">
          Pathway <b>{c.case.pathway?.short_label ?? "—"}</b>
          <br />
          Stage <b>{c.case.stage_label}</b>
          <br />
          Citations <b>{citations}</b>
          <br />
          Deadline <b>{c.case.stage_due_label}</b>
          <br />
          Decision <b>{decision ? decision.kind : awaiting ? "pending clinician" : "none waiting"}</b>
        </div>
      </div>

      <section className="section">
        <h2>Proposal</h2>
        <p className="note">
          The engine reads the latest report and proposes one outcome. It never closes or reopens a
          case: the decision below is a clinician's act, recorded with their name in the audit trail.
        </p>
        <p className="notice" data-proposal={notRead ? "not_read" : (extraction?.proposal ?? "none")}>
          <strong>AI proposal, not a decision: {proposalLabel}</strong>
          {extraction?.proposal_reason}
          {extraction?.model && !notRead
            ? ` · read by ${extraction.model}, prompt ${extraction.prompt_version}${extraction.read_label ? `, ${extraction.read_label}` : ""}`
            : ""}
        </p>
        {report?.title && (
          <p className="note">
            Report read: <b>{report.title}</b>
          </p>
        )}
        {readError && (
          <p className="notice alarm" style={{ marginBottom: 14 }}>
            <strong>Report not read</strong>
            {readError}
          </p>
        )}
        {report?.document_id && extraction?.origin !== "pathway_not_verified" && (
          <div className="actions" style={{ marginBottom: 16 }}>
            <button className={`btn${notRead ? " primary" : ""}`} type="button" disabled={reading} onClick={readReport}>
              {reading ? "Reading…" : notRead ? "Read the latest report" : "Read the report again"}
            </button>
            <p>{notRead ? "A cached reading needs no model call." : "Same text, same answer: served from the cache."}</p>
          </div>
        )}
        <div className="field">
          <label htmlFor="outcome">Outcome to confirm</label>
          <select
            id="outcome"
            value={chosen}
            disabled={!canConfirm || decision !== null}
            onChange={(e) => setOutcome(e.target.value)}
          >
            {c.case.outcomes.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {citations === 0 && !notRead && (
          <p className="notice alarm">
            <strong>No citation on this proposal</strong>
            Closing is blocked until a report has been read and its evidence attached.
          </p>
        )}
        {fields.length > 0 && (
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
                  </div>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="section">
        <h2>Decision</h2>
        {decision?.kind === "confirmed" && (
          <p className="notice" style={{ marginBottom: 16 }}>
            <strong>
              Closure confirmed by {who} · {when}
            </strong>
            Outcome: {c.case.outcomes.find((o) => o.key === (c.case.final_outcome ?? chosen))?.label ?? chosen}. Stage now{" "}
            {c.case.stage_label}; the audit line is written.
          </p>
        )}
        {decision?.kind === "reopened" && (
          <p className="notice" style={{ marginBottom: 16 }} data-state="reopened">
            <strong>
              Case reopened by {who} · {when}
            </strong>
            Back at {c.case.stage_label}, owner {c.case.owner?.display_name ?? "none"}, outcome cleared.{" "}
            {decision.event?.summary}
          </p>
        )}
        {decision?.kind === "rejected" && (
          <p className="notice" style={{ marginBottom: 16 }}>
            <strong>
              AI proposal rejected by {who} · {when}
            </strong>
            Reason recorded: “{reason}”. The case stays at {c.case.stage_label} with the same owner.
          </p>
        )}
        {decision !== null && (
          <div className="actions">
            <Link className="btn primary" to={`/cases/${c.case.case_id}`}>
              Open the case
            </Link>
          </div>
        )}

        {decision === null && !awaiting && (
          <>
            <p className="notice">
              <strong>No closure is waiting on this case</strong>
              It is at {c.case.stage_label}. A closure review opens once closure is proposed.
            </p>
            <div className="actions">
              <Link className="btn" to={`/cases/${c.case.case_id}`}>
                Back to case
              </Link>
            </div>
          </>
        )}

        {decision === null && awaiting && (
          <>
            <p className="note">
              {canConfirm
                ? "Confirm the outcome only when the cited evidence supports it. Reopen when the examination has to be repeated."
                : `Confirming, reopening and rejecting are reserved to a responsible physician. You are acting as ${
                    role === "coordinator" ? "coordination staff" : "the program manager"
                  }.`}
            </p>
            <div className="field">
              <label htmlFor="reason">Reason (needed to reject the proposal, optional to reopen)</label>
              <textarea
                id="reason"
                value={reason}
                disabled={busy || (!canReopen && !canReject)}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Repeat colonoscopy needed."
              />
            </div>
            {error && (
              <p className="notice alarm" style={{ marginBottom: 14 }}>
                <strong>Decision not recorded</strong>
                {error}
              </p>
            )}
            <div className="actions">
              <button className="btn primary" type="button" onClick={confirm} disabled={!canConfirm || busy || notRead}>
                Confirm closure
              </button>
              <button className="btn" type="button" onClick={reopen} disabled={!canReopen || busy}>
                Reopen case
              </button>
              <button className="btn" type="button" onClick={reject} disabled={!canReject || busy}>
                Reject proposal
              </button>
              <Link className="btn" to={`/cases/${c.case.case_id}`}>
                Back to case
              </Link>
            </div>
          </>
        )}
      </section>
    </Page>
  );
}
