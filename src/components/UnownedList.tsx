import { Link, useNavigate } from "react-router-dom";
import { getUnowned } from "../api/ownership";
import type { Role } from "../api/types";
import { formatStamp } from "../handoff";
import { useAsync } from "../hooks/useAsync";

// TICKET-08: the dedicated unowned list, straight from GET /api/unowned. The server
// orders it (longest unowned first) and writes the "Unowned 20h" label; nothing here
// filters or sorts.
export function UnownedList({ role, clockVersion }: { role: Role; clockVersion: number }) {
  const navigate = useNavigate();
  const { data, error, loading } = useAsync(() => getUnowned(role), [role, clockVersion]);

  if (error) {
    return (
      <p className="notice alarm" style={{ margin: "24px 0" }}>
        <strong>Unowned list could not be read</strong>
        {error.message}
      </p>
    );
  }
  if (!data) return <p className="notice" style={{ margin: "24px 0" }}>Reading the unowned list…</p>;

  return (
    <div className="unowned" aria-busy={loading}>
      <table className="exceptions unowned-table">
        <caption className="note">
          {data.count === 1 ? "1 open case has" : `${data.count} open cases have`} no owner. Each row
          opens the case.
        </caption>
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col">Patient</th>
            <th scope="col">No owner for</th>
            <th scope="col">Why</th>
            <th scope="col">Provider now</th>
            <th scope="col">Assign-owner task</th>
          </tr>
        </thead>
        <tbody>
          {data.cases.length === 0 && (
            <tr>
              <td colSpan={6} className="reason">
                Every open case has an owner at this demo time.
              </td>
            </tr>
          )}
          {data.cases.map((r) => (
            <tr
              key={r.case_id}
              className="row-link"
              onClick={() => navigate(`/cases/${r.case_id}`)}
            >
              <td className="ref">
                <Link to={`/cases/${r.case_id}`}>{r.case_id}</Link>
              </td>
              <td>
                {r.patient.display_name}, {r.patient.age}
                <br />
                <small className="who">{r.stage_label}</small>
              </td>
              <td className="reason">
                <span className="mark" aria-hidden="true">
                  ◻
                </span>{" "}
                {r.unowned_label}
                <br />
                <small className="due">since {formatStamp(r.unowned_since)}</small>
              </td>
              <td>
                {r.trigger ? (
                  <>
                    <span className="reason">{r.trigger.label}</span>
                    {r.trigger.reason && (
                      <>
                        <br />
                        <small>{r.trigger.reason}</small>
                      </>
                    )}
                  </>
                ) : (
                  "No trigger recorded"
                )}
                {r.previous_owner && (
                  <>
                    <br />
                    <small className="who">was {r.previous_owner.display_name}</small>
                  </>
                )}
              </td>
              <td>{r.provider?.name ?? "—"}</td>
              <td className="who">
                {r.assign_owner_task
                  ? `${r.assign_owner_task.owner?.display_name ?? "nobody"}, due ${formatStamp(r.assign_owner_task.due_at)}`
                  : "none open"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
