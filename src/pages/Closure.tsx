import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Page, useRole } from "../components/Shell";
import { api, ApiError } from "../api";
import { roleFor } from "../api/roles";
import { useAsync } from "../hooks/useAsync";
import type { Proposal } from "../api/types";

// The AI's proposal in words. It is printed as a proposal, never as a decision: the
// decision is the clinician's, below.
const PROPOSAL_LABEL: Record<Proposal, string> = {
  reopen: "Reopen the case",
  wait_for_pathology: "Wait for pathology",
  needs_human_reading: "Needs a human reading",
  propose_closure: "Propose closure",
};

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
  const [decision, setDecision] = useState<"none" | "confirmed" | "returned">("none");
  const [reason, setReason] = useState("");
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
  const fields = verification.data?.extraction.fields ?? [];
  const chosen = outcome ?? c.case.final_outcome ?? c.case.outcomes[0]?.key ?? "";
  const chosenLabel = c.case.outcomes.find((o) => o.key === chosen)?.label ?? chosen;
  // The gate is the server's answer, not the picker's value: available_actions is computed
  // by the engine from the caller's role and the case state (docs/api.md).
  const isPhysician = c.available_actions.includes("confirm_closure");
  // Only a citation the server validated against the report text counts as evidence.
  const citations = fields.filter((f) => f.validated).length;
  const extraction = verification.data?.extraction;
  const proposalLabel = extraction
    ? (PROPOSAL_LABEL[extraction.proposal] ?? extraction.proposal)
    : "Not read yet";

  async function confirm() {
    if (!isPhysician) return;
    if (citations === 0) {
      setError("This proposal carries no citation. A closure cannot be confirmed without evidence.");
      return;
    }
    try {
      await api.confirmClosure(c.case.case_id, actor, chosen);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The decision could not be recorded.");
      return;
    }
    setError("");
    setDecision("confirmed");
    detail.reload();
  }

  function returnProposal() {
    if (reason.trim().length < 5) {
      setError("Name what is missing — the engine re-reads on the next report.");
      return;
    }
    setError("");
    setDecision("returned");
  }

  return (
    <Page>
      <div className="sheet-head">
        <h1>
          <span>{c.case.case_id} · closure review</span>
          {c.case.patient.display_name}, {c.case.patient.age}
        </h1>
        <div className="meta">
          Proposed by <b>case engine</b>
          <br />
          Citations <b>{citations}</b>
          <br />
          Deadline <b>{c.case.stage_due_label}</b>
          <br />
          Decision <b>{decision === "none" ? "pending clinician" : decision}</b>
        </div>
      </div>

      <section className="section">
        <h2>Proposal</h2>
        <p className="note">
          The engine proposes one outcome. It never closes a case: the confirmation below is a
          clinician's act, recorded with their name in the audit trail.
        </p>
        <p className="notice" data-proposal={extraction?.proposal ?? "none"}>
          <strong>AI proposal, not a decision: {proposalLabel}</strong>
          {extraction?.proposal_reason}
          {extraction?.model ? ` · read by ${extraction.model}, prompt ${extraction.prompt_version}` : ""}
        </p>
        <div className="field">
          <label htmlFor="outcome">Proposed outcome</label>
          <select
            id="outcome"
            value={chosen}
            disabled={!isPhysician || decision !== "none"}
            onChange={(e) => setOutcome(e.target.value)}
          >
            {c.case.outcomes.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {citations === 0 && (
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
        {decision === "confirmed" && (
          <p className="notice" style={{ marginBottom: 16 }}>
            <strong>Closure confirmed by Dr. Fulan · 17 Nov 11:42</strong>
            Outcome: {chosenLabel}. Audit line written; the case leaves the open grid.
          </p>
        )}
        {decision === "returned" && (
          <p className="notice" style={{ marginBottom: 16 }}>
            <strong>Proposal returned to the engine</strong>
            Reason recorded: “{reason}”. The case stays open with the same owner.
          </p>
        )}

        {decision === "none" && (
          <>
            <p className="note">
              {isPhysician
                ? "Confirm the outcome only when the cited evidence supports it."
                : `Confirming closure is reserved to a responsible physician. You are acting as ${
                    role === "coordinator" ? "coordination staff" : "the program manager"
                  }.`}
            </p>
            <div className="field">
              <label htmlFor="reason">If the evidence does not support closure, say what is missing</label>
              <textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Pathology report 15/11 does not state a surveillance interval."
              />
            </div>
            {error && (
              <p className="notice alarm" style={{ marginBottom: 14 }}>
                <strong>Decision not recorded</strong>
                {error}
              </p>
            )}
            <div className="actions">
              <button className="btn primary" type="button" onClick={confirm} disabled={!isPhysician}>
                Confirm closure
              </button>
              <button className="btn" type="button" onClick={returnProposal}>
                Return to engine
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
