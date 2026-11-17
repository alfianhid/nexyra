import { Link } from "react-router-dom";
import { Page, useRole } from "../components/Shell";
import { api } from "../api";
import { roleFor } from "../api/roles";
import { useAsync } from "../hooks/useAsync";

export default function Programme() {
  const { role } = useRole();
  const summary = useAsync(() => api.getProgramme(roleFor[role]), [role]);

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
  const max = Math.max(...programme.funnel.map((s) => s.open));

  return (
    <Page>
      <div className="summary">
        <div className="figure">
          <span>Closed this week</span>
          <b>{programme.counts.closed_this_week}</b>
          <p>of {programme.counts.open + programme.counts.closed_this_week} cases in the programme</p>
          <i aria-hidden="true" />
        </div>
        <div className="counts">
          <div className="count">
            <span>Open</span>
            <b>{programme.counts.open}</b>
            <p>across five stages</p>
          </div>
          <div className="count">
            <span>Unowned</span>
            <b className="alarm">{programme.counts.unowned}</b>
            <p>no coordinator matched</p>
          </div>
          <div className="count">
            <span>Due today</span>
            <b>{programme.counts.due_today}</b>
            <p>one of them unowned</p>
          </div>
        </div>
      </div>

      <section className="section">
        <h2>Open cases by stage</h2>
        <p className="note">
          The bar is the whole stage at one scale. Signal blue is the share inside it with no owner;
          ink is owned work.
        </p>
        <div className="bars">
          {programme.funnel.map((s) => (
            <div className="bar-row" key={s.stage}>
              <span>{s.stage}</span>
              <span className="track">
                {s.unowned > 0 && <i className="un" style={{ width: `${(s.unowned / max) * 100}%` }} />}
                <i style={{ width: `${((s.open - s.unowned) / max) * 100}%` }} />
              </span>
              <span className="num">{s.open} open</span>
              <span className="num">{s.unowned > 0 ? `${s.unowned} unowned` : "—"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Exceptions</h2>
        <p className="note">
          Cases that cannot be left to the routine queue. Every row names the reason, not just the
          count.
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
            {programme.exceptions.map((e) => (
              <tr key={e.case_id}>
                <td className="ref">
                  <Link to={`/cases/${e.case_id}`}>{e.case_id}</Link>
                </td>
                <td className="reason">{e.reason}</td>
                <td className="who">{e.owner}</td>
                <td className="due">{e.due_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
