import { Link, useSearchParams } from "react-router-dom";
import { Page, useRole } from "../components/Shell";
import { getUnstitched } from "../api/ownership";
import { roleFor } from "../api/roles";
import { useAsync } from "../hooks/useAsync";

// TICKET-08: resources from other providers that matched no case. They are kept and shown
// here instead of being dropped. Read-only: a queued resource is stitched when it is sent
// again after its case exists, never by editing it on this screen.

const views = [
  { id: "queued", label: "Waiting for a case" },
  { id: "stitched", label: "Stitched later" },
  { id: "all", label: "All" },
] as const;

type View = (typeof views)[number]["id"];

export default function Unstitched() {
  const { role, clockVersion } = useRole();
  const [params, setParams] = useSearchParams();
  const asked = params.get("status");
  const view: View = views.some((v) => v.id === asked) ? (asked as View) : "queued";
  const { data, error, loading } = useAsync(
    () => getUnstitched(roleFor[role], view),
    [role, view, clockVersion],
  );

  return (
    <Page>
      <div className="sheet-head">
        <h1>
          <span>Ingest · FHIR</span>
          Not yet stitched
        </h1>
        <div className="meta">
          Matched on <b>patient identifier + referral</b>
          <br />
          Resources <b>Appointment, Procedure, DiagnosticReport</b>
          <br />
          Shown <b>{data ? data.count : "…"}</b>
        </div>
      </div>

      <section className="section">
        <h2>Queue</h2>
        <p className="note">
          A resource is stitched to a case only when both its patient identifier and its originating
          referral match one exactly. Anything else waits here with its reason, oldest first. Nothing
          is discarded.
        </p>

        <div className="filters" role="group" aria-label="Queue status">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => setParams(v.id === "queued" ? {} : { status: v.id })}
            >
              {v.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="notice alarm" style={{ marginTop: 16 }}>
            <strong>Queue could not be read</strong>
            {error.message}
          </p>
        ) : !data ? (
          <p className="notice" style={{ marginTop: 16 }}>Reading the queue…</p>
        ) : (
          <table className="exceptions" aria-busy={loading} style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th scope="col">Resource</th>
                <th scope="col">Why it did not stitch</th>
                <th scope="col">From</th>
                <th scope="col">Patient · referral</th>
                <th scope="col">Received</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="reason">
                    {view === "queued"
                      ? "Nothing is waiting: every resource received so far matched a case."
                      : "No resource in this view."}
                  </td>
                </tr>
              )}
              {data.items.map((u) => (
                <tr key={u.unstitched_id}>
                  <td>
                    <span className="reason">{u.resource_type}</span>
                    <br />
                    <small className="ref">{u.resource_id}</small>
                  </td>
                  <td>
                    {u.reason}
                    <br />
                    <small className="who">{u.reason_code.replace(/_/g, " ")}</small>
                  </td>
                  <td>{u.source_provider?.name ?? "—"}</td>
                  <td className="who">
                    {u.patient_identifier ?? "no identifier"} · {u.referral_id ?? "no referral"}
                  </td>
                  <td className="due">{u.received_label}</td>
                  <td className="reason">
                    {u.status === "stitched" && u.stitched_case_id ? (
                      <>
                        stitched to <Link to={`/cases/${u.stitched_case_id}`}>{u.stitched_case_id}</Link>
                      </>
                    ) : (
                      u.status
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Page>
  );
}
