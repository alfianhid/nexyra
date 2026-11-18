import { useState } from "react";
import { ApiError } from "../api";
import { useRoster } from "../api/actors";
import { recordStep } from "../api/caseSteps";
import type { Actor, CaseDetailResponse } from "../api/types";
import { ownerCandidates } from "../handoff";

// The case page's one generic control: every event this role may record next, as the
// server lists it from the template (`next_steps`). A closure proposal asks for an
// outcome, a hand-over for the new owner; nothing else is special-cased here, and the
// server checks every step again.
export function NextStepForm({
  detail,
  actor,
  onDone,
}: {
  detail: CaseDetailResponse;
  actor: Actor;
  onDone: () => void;
}) {
  const steps = detail.next_steps ?? [];
  const roster = useRoster();
  const [event, setEvent] = useState("");
  const [outcome, setOutcome] = useState(detail.case.final_outcome ?? "");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (steps.length === 0) return null;
  const step = steps.find((s) => s.event === event);
  const owners = ownerCandidates(roster).filter((a) => a.actor_id !== detail.case.owner?.actor_id);

  async function send() {
    if (!step) {
      setError("Choose the step to record.");
      return;
    }
    if (step.needs_outcome && !outcome) {
      setError("Choose the outcome the closure proposes.");
      return;
    }
    if (step.needs_owner && !owner) {
      setError("Choose who takes the case.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await recordStep(detail.case.case_id, actor, step.event, {
        ...(note.trim() ? { summary: note.trim() } : {}),
        ...(step.needs_outcome ? { outcome } : {}),
        ...(step.needs_owner ? { owner_actor_id: owner } : {}),
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The step could not be recorded.");
      setBusy(false);
      return;
    }
    setBusy(false);
    setEvent("");
    setNote("");
    onDone();
  }

  return (
    <section className="section" aria-labelledby="next-step-h">
      <h2 id="next-step-h">Record next step</h2>
      <p className="note">
        The steps this role may record at this stage, from the pathway template. The engine checks
        the step again when it is recorded.
      </p>
      <div className="handoff-forms">
        <div className="handoff-form">
          <div className="field">
            <label htmlFor="step-event">Step</label>
            <select id="step-event" value={event} disabled={busy} onChange={(e) => setEvent(e.target.value)}>
              <option value="">Choose the step</option>
              {steps.map((s) => (
                <option key={s.event} value={s.event}>
                  {s.label}
                  {s.moves_stage ? ` → ${s.to_label}` : ""}
                </option>
              ))}
            </select>
          </div>
          {step?.needs_outcome && (
            <div className="field">
              <label htmlFor="step-outcome">Outcome proposed</label>
              <select id="step-outcome" value={outcome} disabled={busy} onChange={(e) => setOutcome(e.target.value)}>
                <option value="">Choose the outcome</option>
                {detail.case.outcomes.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {step?.needs_owner && (
            <div className="field">
              <label htmlFor="step-owner">New owner</label>
              <select id="step-owner" value={owner} disabled={busy} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Choose who takes the case</option>
                {owners.map((a) => (
                  <option key={a.actor_id} value={a.actor_id}>
                    {a.display_name} · {a.role.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="step-note">Note for the audit line (optional)</label>
            <textarea
              id="step-note"
              value={note}
              disabled={busy}
              maxLength={300}
              placeholder="What happened, in one line."
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && (
            <p className="notice alarm" style={{ marginBottom: 14 }}>
              <strong>Step not recorded</strong>
              {error}
            </p>
          )}
          <div className="actions">
            <button className="btn primary" type="button" disabled={busy} onClick={send}>
              Record step
            </button>
            {step && <p>{step.moves_stage ? `Moves the case to ${step.to_label}.` : "The stage stays the same."}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
