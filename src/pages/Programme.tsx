import { Link } from "react-router-dom";
import { Page, useRole } from "../components/Shell";
import { api } from "../api";
import { roleFor } from "../api/roles";
import { useAsync } from "../hooks/useAsync";

// Bar widths are a share of the largest row in the same chart. Zero rows still render.
function share(value: number, max: number): string {
  return `${max > 0 ? (value / max) * 100 : 0}%`;
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export default function Programme() {
  const { role, clockVersion } = useRole();
  const summary = useAsync(() => api.getProgramme(roleFor[role]), [role, clockVersion]);

  if (summary.error) {
    return (
      <Page>
        <p className="notice alarm">
          <strong>Programme view not available</strong>
          {summary.error.message}
        </p>
      </Page>
    );
  }

  if (summary.loading || !summary.data) {
    return (
      <Page>
        <p className="notice">Reading the programme…</p>
      </Page>
    );
  }

  const programme = summary.data;
  const { counts } = programme;
  const openStages = programme.funnel.filter((s) => !s.terminal || s.open > 0);
  const maxOpen = Math.max(0, ...openStages.map((s) => s.open));
  const maxReached = Math.max(0, ...programme.funnel.map((s) => s.reached));
  const referral = programme.referral_to_colonoscopy;
  const maxBucket = referral
    ? Math.max(0, ...referral.buckets.map((b) => b.completed + b.waiting))
    : 0;
  const maxReason = Math.max(0, ...programme.delay_reasons.map((r) => r.count));
  const scenario = programme.scenario;

  return (
    <Page>
      <p className="notice" role="note" style={{ marginBottom: 18 }}>
        {programme.synthetic_data_label}
      </p>

      <div className="summary">
        <div className="figure">
          <span>Closed this week</span>
          <b>{counts.closed_this_week}</b>
          <p>of {counts.total} cases in the programme</p>
          <i aria-hidden="true" />
        </div>
        <div className="counts">
          <div className="count">
            <span>Open</span>
            <b>{counts.open}</b>
            <p>across {openStages.filter((s) => s.open > 0).length} stages</p>
          </div>
          <div className="count">
            <span>Unowned</span>
            <b className="alarm">{counts.unowned}</b>
            <p>no owner recorded</p>
          </div>
          <div className="count">
            <span>Due today</span>
            <b>{counts.due_today}</b>
            <p>
              {counts.due_today_unowned === 0
                ? "none of them unowned"
                : `${counts.due_today_unowned} of them unowned`}
            </p>
          </div>
        </div>
      </div>

      <section className="section">
        <h2>Exceptions</h2>
        <p className="note">
          Cases that cannot be left to the routine queue: {counts.unowned} unowned,{" "}
          {counts.past_referral_limit} past the {referral?.limit_days ?? 31}-day referral limit,{" "}
          {counts.closures_held} {counts.closures_held === 1 ? "closure" : "closures"} held
          because the latest reading does not propose closure. Every row names the reason and
          opens its case.
        </p>
        <table className="exceptions">
          <caption className="note" style={{ textAlign: "left" }}>
            Synthetic demonstration data
          </caption>
          <thead>
            <tr>
              <th scope="col">Ref</th>
              <th scope="col">Reason</th>
              <th scope="col">Owner</th>
              <th scope="col">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {programme.exceptions.length === 0 && (
              <tr>
                <td colSpan={4} className="reason">
                  No exceptions at this demo time.
                </td>
              </tr>
            )}
            {programme.exceptions.map((e) => (
              <tr key={`${e.kind}-${e.case_id}`}>
                <td className="ref">
                  <Link to={`/cases/${e.case_id}`}>{e.case_id}</Link>
                </td>
                <td className="reason">{e.reason}</td>
                <td className="who">{e.owner}</td>
                <td className="due">{e.due_label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <h2>Events not yet stitched to a case</h2>
        {!programme.unstitched.available ? (
          <p className="note">
            This build has no ingest queue yet, so there are no unmatched events to list.
          </p>
        ) : programme.unstitched.rows.length === 0 ? (
          <p className="note">Every ingested event matched a case.</p>
        ) : (
          <table className="exceptions">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Reason</th>
                <th scope="col">What arrived</th>
                <th scope="col">Received</th>
              </tr>
            </thead>
            <tbody>
              {programme.unstitched.rows.map((u) => (
                <tr key={u.id}>
                  <td className="ref">{u.id}</td>
                  <td className="reason">{u.reason}</td>
                  <td className="who">{u.summary}</td>
                  <td className="due">{u.received_label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h2>Funnel: result received to closed</h2>
        <p className="note">
          Cases that ever reached each stage, counted from the event trail. The median is the
          days from the earlier stage the case last reached.
        </p>
        <div className="bars">
          {programme.funnel.map((s) => (
            <div className="bar-row" key={s.key}>
              <span>{s.stage}</span>
              <span className="track">
                <i style={{ width: share(s.reached, maxReached) }} />
              </span>
              <span className="num">{s.reached} reached</span>
              <span className="num">
                {s.median_days_from_previous === null ? "—" : `median ${s.median_days_from_previous} d`}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Open cases by stage</h2>
        <p className="note">
          The bar is the whole stage at one scale. Signal blue is the share inside it with no owner;
          ink is owned work.
        </p>
        <div className="bars">
          {openStages.map((s) => (
            <div className="bar-row" key={s.key}>
              <span>{s.stage}</span>
              <span className="track">
                {s.unowned > 0 && <i className="un" style={{ width: share(s.unowned, maxOpen) }} />}
                <i style={{ width: share(s.open - s.unowned, maxOpen) }} />
              </span>
              <span className="num">{s.open} open</span>
              <span className="num">{s.unowned > 0 ? `${s.unowned} unowned` : "—"}</span>
            </div>
          ))}
        </div>
      </section>

      {referral && (
        <section className="section">
          <h2>
            {referral.label} against the {referral.limit_days}-day limit
          </h2>
          <p className="note">
            Days from the referral to the colonoscopy. Ink is a case whose colonoscopy is done;
            signal blue is a case still waiting, counted to the demo clock. {referral.completed_within_limit}{" "}
            of {referral.completed} done within the limit
            {referral.median_days_completed === null ? "" : `, median ${referral.median_days_completed} days`};{" "}
            {referral.waiting_over_limit} still waiting past it. Limit: {referral.source}.
          </p>
          <div className="bars">
            {referral.buckets.map((b) => (
              <div className="bar-row" key={b.label}>
                <span>
                  {b.label}
                  {b.over_limit ? " · over the limit" : ""}
                </span>
                <span className="track">
                  {b.waiting > 0 && <i className="un" style={{ width: share(b.waiting, maxBucket) }} />}
                  <i style={{ width: share(b.completed, maxBucket) }} />
                </span>
                <span className="num">{b.completed} done</span>
                <span className="num">{b.waiting} waiting</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>Delay reasons recorded by staff</h2>
        <p className="note">
          The reason staff chose when logging an outreach attempt or completing a task, one count
          per barrier: a call that also closes a ladder task is counted once.
        </p>
        <div className="bars">
          {programme.delay_reasons.map((r) => (
            <div className="bar-row" key={r.delay_reason}>
              <span>{r.label}</span>
              <span className="track">
                <i style={{ width: share(r.count, maxReason) }} />
              </span>
              <span className="num">{r.count}</span>
              <span className="num" />
            </div>
          ))}
        </div>
      </section>

      {programme.ai_divergence && (
        <section className="section">
          <h2>Physician against the AI reading</h2>
          <p className="note">
            Decisions where the responsible physician did not follow the AI proposal: proposals
            rejected with a reason, and closures confirmed while the reading proposed something
            other than closure. A count to review, not an error rate.
          </p>
          <dl className="handoff-facts">
            <div>
              <dt>Divergences</dt>
              <dd>{programme.ai_divergence.count}</dd>
            </div>
            <div>
              <dt>Proposals rejected</dt>
              <dd>{programme.ai_divergence.proposals_rejected}</dd>
            </div>
            <div>
              <dt>Closed against the reading</dt>
              <dd>{programme.ai_divergence.closed_against_reading}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="section">
        <h2>Escalations per role per demo day</h2>
        <p className="note">
          Alerts the deadline timers sent, by the role that received them. The last row is the
          average per demo day.
        </p>
        <table className="exceptions">
          <thead>
            <tr>
              <th scope="col">Demo day</th>
              {programme.escalations_per_role_per_day.map((r) => (
                <th scope="col" key={r.role}>
                  {r.role_label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {programme.escalations_by_day.map((d) => (
              <tr key={d.day}>
                <td className="who">{d.label}</td>
                {d.per_role.map((r) => (
                  <td className="due" key={r.role}>
                    {r.count}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="reason">Per day</td>
              {programme.escalations_per_role_per_day.map((r) => (
                <td className="reason" key={r.role}>
                  {r.per_day}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>

      <section className="section">
        <h2>{scenario.title}</h2>
        <p className="note">
          Not a measurement and not a result of this system. {scenario.caveat}
        </p>
        <p>
          If follow-up completion moved from {percent(scenario.baseline_rate)} to{" "}
          {percent(scenario.outreach_rate)}, then across the {scenario.cohort_cases} synthetic cases
          in this programme about <b>{scenario.additional_completed}</b> more would complete
          follow-up.
        </p>
        <p className="note" style={{ marginTop: 8 }}>
          Source: {scenario.source}.
        </p>
      </section>

      <div className="grid-foot">
        <span>Programme view reads the same case records as the register</span>
        <span className="right">
          <Link to="/cases">Open the register →</Link>
        </span>
      </div>
    </Page>
  );
}
