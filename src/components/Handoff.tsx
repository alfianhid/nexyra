import { useState } from "react";
import { ApiError } from "../api";
import { actorName, rosterActor, useRoster, type RosterActor } from "../api/actors";
import {
  answerConsultation,
  assignOwner,
  getProviders,
  recordPatientMoved,
  requestConsultation,
} from "../api/ownership";
import type {
  Actor,
  CaseDetailResponse,
  Consultation,
  ConsultationOutcome,
  ProviderOption,
} from "../api/types";
import {
  answerBody,
  answerProblem,
  canRecordMove,
  defaultOwnerId,
  openConsultation,
  outcomeWords,
  ownerCandidates,
  physiciansAt,
} from "../handoff";
import { useAsync } from "../hooks/useAsync";

// TICKET-08 / TICKET-11 on the case page: who holds the case, where it is, the referrals
// and consultations, and the four hand-over forms. Every form is shown only when the
// server's available_actions allows it (record_provider_move for the move).

function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(write: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await write();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The change could not be recorded.");
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
  }
  return { busy, error, run, setError };
}

function FormError({ id, title, error }: { id: string; title: string; error: string }) {
  if (!error) return null;
  return (
    <p id={id} className="notice alarm" style={{ marginBottom: 14 }}>
      <strong>{title}</strong>
      {error}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

export function OwnershipSection({ detail }: { detail: CaseDetailResponse }) {
  const { ownership, provider, tasks } = detail;
  const openGap = ownership.gaps.find((g) => g.owned_at === null);
  const lastClosedGap = [...ownership.gaps].reverse().find((g) => g.owned_at !== null);
  const ownerTask = tasks.find((t) => t.kind === "assign_owner" && t.status === "open");
  const unowned = ownership.state === "unowned";
  // A move during the open spell keeps the spell (and its first trigger); the server's own
  // summary of the latest move says where the patient went.
  const lastMove = [...detail.timeline]
    .reverse()
    .find((e) => e.type === "patient_moved_provider" && (!openGap || e.occurred_at >= openGap.unowned_at));

  return (
    <section className="section" aria-labelledby="ownership-h">
      <h2 id="ownership-h" className="below-topbar">
        Ownership
      </h2>
      <p className="note">
        Who holds this screening result now. A rejected or unanswered referral, or a move to
        another provider, leaves the case with no owner until someone takes it.
      </p>

      <div className="handoff-state">
        {unowned ? (
          <p className="notice alarm" data-state="unowned">
            <strong>
              <span className="mark" aria-hidden="true">
                ◻
              </span>{" "}
              {ownership.unowned_label ?? "No owner"} · since {ownership.unowned_since_label ?? "—"}
            </strong>
            {openGap ? `${openGap.trigger.label}: ${openGap.trigger.reason}.` : "No trigger recorded."}
            {lastMove && (
              <>
                {" "}
                {lastMove.summary} ({lastMove.occurred_label}).
              </>
            )}
            {ownerTask && (
              <>
                {" "}
                Assign-owner task with {ownerTask.owner?.display_name ?? "nobody"}, due{" "}
                {ownerTask.due_label}.
              </>
            )}
          </p>
        ) : (
          <p className="notice" data-state="owned">
            <strong>
              <span className="mark" aria-hidden="true">
                ◼
              </span>{" "}
              Owned by {detail.case.owner?.display_name ?? "—"}
            </strong>
            {lastClosedGap
              ? `Owner again ${lastClosedGap.owned_at_label ?? "—"}, ${lastClosedGap.hours_to_owner}h after "${lastClosedGap.trigger.label.toLowerCase()}".`
              : "The case has not been without an owner."}
          </p>
        )}
        <dl className="handoff-facts">
          <div>
            <dt>Provider now</dt>
            <dd>{provider?.name ?? "—"}</dd>
          </div>
          <div>
            <dt>Patient identifier</dt>
            <dd>{detail.case.patient.identifier ?? "—"}</dd>
          </div>
          <div>
            <dt>Ownership gaps</dt>
            <dd>{ownership.gaps.length}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

// The record behind the state above: every ownership spell, referral and consultation.
export function HandoffRecords({ detail }: { detail: CaseDetailResponse }) {
  const roster = useRoster();
  const { ownership, referrals, consultations } = detail;
  if (ownership.gaps.length + referrals.length + consultations.length === 0) return null;

  return (
    <section className="section" aria-labelledby="records-h">
      <h2 id="records-h">Referrals, ownership gaps and consultations</h2>
      <p className="note">
        Referral status tracking belongs to Malaffi e-Referral; Nexyra keeps the referral to know who
        owns the screening result, and measures the hours each gap and each question stayed open.
      </p>
      {ownership.gaps.length > 0 && (
        <table className="exceptions handoff-table">
          <caption className="note">Time from trigger to owned again, one row per spell</caption>
          <thead>
            <tr>
              <th scope="col">Trigger</th>
              <th scope="col">Reason</th>
              <th scope="col">Unowned from</th>
              <th scope="col">Owner again</th>
              <th scope="col">New owner</th>
              <th scope="col">Hours to owner</th>
            </tr>
          </thead>
          <tbody>
            {ownership.gaps.map((g, i) => (
              <tr key={g.trigger.event_id ?? i}>
                <td className="reason">{g.trigger.label}</td>
                <td>{g.trigger.reason || "—"}</td>
                <td className="due">{g.unowned_at_label}</td>
                <td className="due">{g.owned_at_label ?? "still unowned"}</td>
                <td className="who">{g.owner_actor_id ? actorName(roster, g.owner_actor_id) : "—"}</td>
                <td className="due">{g.hours_to_owner === null ? "open" : `${g.hours_to_owner}h`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {referrals.length > 0 && (
        <table className="exceptions handoff-table">
          <caption className="note">Referrals, with status, priority and SNOMED-coded specialty</caption>
          <thead>
            <tr>
              <th scope="col">Referral</th>
              <th scope="col">To</th>
              <th scope="col">Status</th>
              <th scope="col">Priority</th>
              <th scope="col">Specialty</th>
              <th scope="col">Sent</th>
            </tr>
          </thead>
          <tbody>
            {referrals.map((r) => (
              <tr key={r.referral_id} data-status={r.status}>
                <td className="ref">{r.referral_id}</td>
                <td>{r.to_provider?.name ?? "—"}</td>
                <td className="reason">
                  <span className="status-word">{r.status}</span>
                  {r.replaces_referral_id && <small> replaces {r.replaces_referral_id}</small>}
                </td>
                <td className="who">{r.priority}</td>
                <td>
                  {r.specialty.display} <small className="who">SNOMED {r.specialty.code}</small>
                </td>
                <td className="due">{r.sent_label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {consultations.length > 0 && (
        <table className="exceptions handoff-table">
          <caption className="note">Consultations: one question, an owner and a deadline for the answer</caption>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Asked of</th>
              <th scope="col">Asked</th>
              <th scope="col">Answer due</th>
              <th scope="col">Answer</th>
              <th scope="col">Hours to answer</th>
            </tr>
          </thead>
          <tbody>
            {consultations.map((k) => (
              <tr key={k.consultation_id} data-status={k.status}>
                <td>{k.question}</td>
                <td className="who">
                  {actorName(roster, k.to_actor_id)} · {k.to_provider?.name ?? "—"}
                </td>
                <td className="due">
                  {k.requested_label} by {actorName(roster, k.requested_by_actor_id)}
                </td>
                <td className="due">{k.due_label}</td>
                <td className="reason">
                  {k.status === "open" ? (
                    <span className="status-word">waiting</span>
                  ) : (
                    <>
                      <span className="status-word">{k.outcome ? outcomeWords[k.outcome] : k.status}</span>
                      {k.answer_note && <small> “{k.answer_note}”</small>}
                    </>
                  )}
                </td>
                <td className="due">{k.hours_to_answer === null ? "—" : `${k.hours_to_answer}h`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Write side
// ---------------------------------------------------------------------------

type FormProps = { detail: CaseDetailResponse; actor: Actor; onDone: () => void };

function AssignOwnerForm({ detail, actor, onDone }: FormProps) {
  const roster = useRoster();
  const candidates = ownerCandidates(roster);
  const [picked, setOwner] = useState(defaultOwnerId(detail) ?? "");
  const owner = picked || candidates[0]?.actor_id || "";
  const { busy, error, run } = useSubmit(onDone);
  const id = "assign";
  return (
    <div className="handoff-form">
      <h3>Assign owner</h3>
      <p className="note">Records who handed over and who took the case.</p>
      <div className="field">
        <label htmlFor={`${id}-owner`}>New owner</label>
        <select id={`${id}-owner`} value={owner} disabled={busy} onChange={(e) => setOwner(e.target.value)}>
          {candidates.map((a) => (
            <option key={a.actor_id} value={a.actor_id}>
              {a.display_name} · {a.role.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <FormError id={`${id}-error`} title="Owner not assigned" error={error} />
      <div className="actions">
        <button
          className="btn primary"
          type="button"
          disabled={busy || !owner}
          onClick={() => run(() => assignOwner(detail.case.case_id, actor, owner))}
        >
          Assign owner
        </button>
      </div>
    </div>
  );
}

function MoveForm({ detail, actor, onDone, providers }: FormProps & { providers: ProviderOption[] }) {
  const current = detail.provider?.provider_id;
  const choices = providers.filter((p) => p.provider_id !== current);
  const [target, setTarget] = useState("");
  // No default: a move takes the owner away, so it is never one click on the first provider.
  const chosen = target;
  const { busy, error, run } = useSubmit(onDone);
  const id = "move";
  return (
    <div className="handoff-form">
      <h3>Patient moved provider</h3>
      <p className="note">
        The case stays open and loses its owner; the assign-owner task goes to coordination staff
        at the new provider.
      </p>
      <div className="field">
        <label htmlFor={`${id}-provider`}>Moved to</label>
        <select id={`${id}-provider`} value={chosen} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose the new provider</option>
          {choices.map((p) => (
            <option key={p.provider_id} value={p.provider_id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <FormError id={`${id}-error`} title="Move not recorded" error={error} />
      <div className="actions">
        <button
          className="btn primary"
          type="button"
          disabled={busy || !chosen}
          onClick={() => run(() => recordPatientMoved(detail.case.case_id, actor, chosen))}
        >
          Record move
        </button>
        <p>From {detail.provider?.name ?? "no provider"}.</p>
      </div>
    </div>
  );
}

function ConsultForm({ detail, actor, onDone, providers }: FormProps & { providers: ProviderOption[] }) {
  const roster = useRoster();
  const latest = detail.referrals[detail.referrals.length - 1];
  const [provider, setProvider] = useState(latest?.to_provider?.provider_id ?? providers[0]?.provider_id ?? "");
  const physicians = physiciansAt(provider, roster);
  const [physician, setPhysician] = useState("");
  const chosenPhysician = physicians.some((p) => p.actor_id === physician)
    ? physician
    : (physicians[0]?.actor_id ?? "");
  const [question, setQuestion] = useState("");
  const { busy, error, run, setError } = useSubmit(() => {
    setQuestion("");
    onDone();
  });
  const id = "consult";

  function send() {
    if (question.trim().length === 0) {
      setError("Write the one question the receiving physician should answer.");
      return;
    }
    run(() =>
      requestConsultation(detail.case.case_id, actor, {
        question: question.trim(),
        to_provider_id: provider,
        ...(chosenPhysician ? { to_actor_id: chosenPhysician } : {}),
      }),
    );
  }

  return (
    <div className="handoff-form">
      <h3>Request consultation</h3>
      <p className="note">
        One short question to the receiving provider. It becomes a task for their physician with a
        48-hour answer deadline from the pathway template. In production it travels over e-Referral.
      </p>
      <div className="field">
        <label htmlFor={`${id}-provider`}>Receiving provider</label>
        <select id={`${id}-provider`} value={provider} disabled={busy} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => (
            <option key={p.provider_id} value={p.provider_id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-physician`}>Receiving physician</label>
        <select
          id={`${id}-physician`}
          value={chosenPhysician}
          disabled={busy || physicians.length === 0}
          onChange={(e) => setPhysician(e.target.value)}
        >
          {physicians.length === 0 && <option value="">The server picks the first physician there</option>}
          {physicians.map((p) => (
            <option key={p.actor_id} value={p.actor_id}>
              {p.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-question`}>Question</label>
        <textarea
          id={`${id}-question`}
          value={question}
          maxLength={500}
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder="Missing FIT date and history now attached. Can you accept the referral?"
          onChange={(e) => setQuestion(e.target.value)}
        />
      </div>
      <FormError id={`${id}-error`} title="Consultation not sent" error={error} />
      <div className="actions">
        <button className="btn primary" type="button" disabled={busy} onClick={send}>
          Send consultation request
        </button>
      </div>
    </div>
  );
}

// The receiving physician (Dr. Fulana in the seed) has no seat in the role picker. The form
// sends the addressee's own actor header, so the audit line names her, the same way the
// outreach screen records the navigator's call (docs/frontend-handoff.md).
function answeringActor(k: Consultation, roster: RosterActor[]): Actor {
  const known = rosterActor(roster, k.to_actor_id);
  if (known) return { actor_id: known.actor_id, role: known.role, display_name: known.display_name };
  return { actor_id: k.to_actor_id ?? "", role: "responsible_physician", display_name: k.to_actor_id ?? "" };
}

function AnswerForm({
  detail,
  consultation,
  onDone,
  providers,
}: {
  detail: CaseDetailResponse;
  consultation: Consultation;
  onDone: () => void;
  providers: ProviderOption[];
}) {
  const roster = useRoster();
  const answerer = answeringActor(consultation, roster);
  const unowned = detail.ownership.state === "unowned";
  const candidates = ownerCandidates(roster);
  const [outcome, setOutcome] = useState<ConsultationOutcome>("accepted");
  const [owner, setOwner] = useState(defaultOwnerId(detail) ?? "");
  const redirectChoices = providers.filter((p) => p.provider_id !== consultation.to_provider?.provider_id);
  const [redirect, setRedirect] = useState("");
  const chosenRedirect = redirect || redirectChoices[0]?.provider_id || "";
  const [note, setNote] = useState("");
  const { busy, error, run, setError } = useSubmit(onDone);
  const id = "answer";

  function send() {
    const options = { note, ownerActorId: owner || undefined, redirectProviderId: chosenRedirect, unowned };
    const problem = answerProblem(outcome, options);
    if (problem) {
      setError(problem);
      return;
    }
    run(() => answerConsultation(consultation.consultation_id, answerer, answerBody(outcome, options)));
  }

  return (
    <div className="handoff-form" data-acting-as={answerer.actor_id}>
      <h3>
        Answer as {answerer.display_name}
        {consultation.to_provider ? ` · ${consultation.to_provider.name}` : ""}
      </h3>
      <p className="note">
        “{consultation.question}” Due {consultation.due_label}. {answerer.display_name} has no
        seat in the role picker; this form records the answer under her own name.
      </p>
      <fieldset className="field handoff-choice">
        <legend>Answer</legend>
        {(Object.keys(outcomeWords) as ConsultationOutcome[]).map((o) => (
          <label key={o}>
            <input
              type="radio"
              name={`${id}-outcome`}
              value={o}
              checked={outcome === o}
              disabled={busy}
              onChange={() => setOutcome(o)}
            />
            {outcomeWords[o]}
          </label>
        ))}
      </fieldset>
      {unowned && (
        <div className="field">
          <label htmlFor={`${id}-owner`}>New owner (the case has none)</label>
          <select id={`${id}-owner`} value={owner} disabled={busy} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Choose who takes the case</option>
            {candidates.map((a) => (
              <option key={a.actor_id} value={a.actor_id}>
                {a.display_name} · {a.role.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      )}
      {outcome === "redirected" && (
        <div className="field">
          <label htmlFor={`${id}-redirect`}>Redirect to</label>
          <select
            id={`${id}-redirect`}
            value={chosenRedirect}
            disabled={busy}
            onChange={(e) => setRedirect(e.target.value)}
          >
            {redirectChoices.map((p) => (
              <option key={p.provider_id} value={p.provider_id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-note`}>Note (optional)</label>
        <textarea
          id={`${id}-note`}
          value={note}
          disabled={busy}
          placeholder="History received. Booking the colonoscopy."
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <FormError id={`${id}-error`} title="Answer not recorded" error={error} />
      <div className="actions">
        <button className="btn primary" type="button" disabled={busy} onClick={send}>
          Record answer as {answerer.display_name}
        </button>
      </div>
    </div>
  );
}

export function HandoffActions({ detail, actor, onDone }: FormProps) {
  const actions = detail.available_actions;
  const open = openConsultation(detail.consultations);
  const showAssign = actions.includes("assign_owner");
  const showMove = canRecordMove(detail);
  const showConsult = actions.includes("request_consultation");
  const showAnswer = actions.includes("answer_consultation") && open !== undefined;
  const needsProviders = showMove || showConsult || showAnswer;
  const providers = useAsync(
    () => (needsProviders ? getProviders() : Promise.resolve({ providers: [] })),
    [needsProviders],
  );

  if (!showAssign && !showMove && !showConsult && !showAnswer) return null;

  const list = providers.data?.providers ?? [];
  // A form remounts after each write, so its defaults follow the new case state.
  const k = detail.timeline.length;

  return (
    <section className="section" aria-labelledby="handoff-h">
      <h2 id="handoff-h">Hand-over</h2>
      <p className="note">
        The forms this role may use on this case at this stage, as the engine reports them.
      </p>
      {providers.error && (
        <p className="notice alarm" style={{ marginBottom: 14 }}>
          <strong>Providers could not be read</strong>
          {providers.error.message}
        </p>
      )}
      <div className="handoff-forms">
        {showAnswer && open && (
          <AnswerForm key={`answer-${k}`} detail={detail} consultation={open} onDone={onDone} providers={list} />
        )}
        {showMove && <MoveForm key={`move-${k}-${list.length}`} detail={detail} actor={actor} onDone={onDone} providers={list} />}
        {showConsult && (
          <ConsultForm key={`consult-${k}-${list.length}`} detail={detail} actor={actor} onDone={onDone} providers={list} />
        )}
        {showAssign && <AssignOwnerForm key={`assign-${k}`} detail={detail} actor={actor} onDone={onDone} />}
      </div>
    </section>
  );
}
