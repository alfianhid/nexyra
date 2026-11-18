import { useMemo, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Page, useRole } from "../components/Shell";
import { api } from "../api";
import { roleFor } from "../api/roles";
import type { CaseFilter, CaseSummary } from "../api/types";
import { useAsync } from "../hooks/useAsync";
// TICKET-08
import { UnownedList } from "../components/UnownedList";

type Filter = "all" | "unowned" | "due" | "closure" | "late";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All stages" },
  { id: "unowned", label: "Unowned" },
  { id: "due", label: "Due within 48h" },
  { id: "closure", label: "Closure review" },
  { id: "late", label: "Past deadline" },
];

// The role picker in the shell is the prototype's stand-in for the actor header.
const serverFilter: Record<Filter, CaseFilter | undefined> = {
  all: undefined,
  unowned: "unowned",
  due: undefined,
  closure: "awaiting_closure_confirmation",
  late: "late",
};

function stateOf(c: CaseSummary): "late" | "due" | "normal" | "closed" {
  if (c.flags.includes("closed")) return "closed";
  if (c.flags.includes("late")) return "late";
  if (c.flags.includes("due")) return "due";
  return "normal";
}

function dueFigure(c: CaseSummary) {
  if (c.hours_left_stage === null) return { value: "—", unit: "closed" };
  if (c.hours_left_stage < 0)
    return { value: `−${Math.abs(c.hours_left_stage)}`, unit: "hours late" };
  if (c.hours_left_stage < 48)
    return { value: `${c.hours_left_stage}`, unit: "hours left" };
  return { value: `${c.days_left_stage}`, unit: "days left" };
}

function matches(c: CaseSummary, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "unowned") return c.owner === null && !c.flags.includes("closed");
  if (filter === "due") return c.hours_left_stage !== null && c.hours_left_stage < 48;
  if (filter === "closure") return c.stage === "closure_proposed";
  return c.flags.includes("late");
}

export default function Worklist() {
  const { role, clockVersion } = useRole();
  // The filter lives in the URL, so /cases?filter=unowned opens the unowned list directly.
  const [params, setParams] = useSearchParams();
  const asked = params.get("filter");
  const filter: Filter = filters.some((f) => f.id === asked) ? (asked as Filter) : "all";
  const setFilter = (next: Filter) => setParams(next === "all" ? {} : { filter: next });
  const { data, error, loading } = useAsync(
    () => api.listCases(roleFor[role], serverFilter[filter]),
    [role, filter, clockVersion],
  );
  const rows = useMemo(
    () => (data?.cases ?? []).filter((c) => matches(c, filter)),
    [data, filter],
  );

  if (!data) {
    return (
      <Page>
        {error ? (
          <p className="notice alarm">
            <strong>Register could not be read</strong>
            {error.message}
          </p>
        ) : (
          <p className="notice">Reading the register…</p>
        )}
      </Page>
    );
  }

  const counts = data.counts;

  return (
    <Page>
      <div className="summary">
        <div className="figure">
          <span>Open cases</span>
          <b>{counts.open}</b>
          <p>FIT pathway · each case carries an owner, a deadline and an evidence line</p>
          <i aria-hidden="true" />
        </div>
        <div className="counts">
          <div className="count">
            <span>Unowned</span>
            <b className="alarm">{counts.unowned}</b>
            <p>
              <Link to="/cases?filter=unowned">open the unowned list</Link>
            </p>
          </div>
          <div className="count">
            <span>Past deadline</span>
            <b className="alarm">{counts.past_deadline}</b>
            <p>escalated to the program manager</p>
          </div>
          <div className="count">
            <span>Awaiting clinician</span>
            <b>{counts.awaiting_clinician}</b>
            <p>closure proposed with citations</p>
          </div>
        </div>
      </div>

      <div className="filters" role="group" aria-label="Filter cases">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <span className="measure">
          {filter === "unowned"
            ? "Row = case with no owner · longest first"
            : "Cell = case · number = distance to deadline"}
        </span>
      </div>

      {filter === "unowned" ? (
        <UnownedList role={roleFor[role]} clockVersion={clockVersion} />
      ) : (
        <>
          <div className="cells" role="list" aria-label="Open cases" aria-busy={loading}>
            {rows.map((c, i) => {
              const due = dueFigure(c);
              return (
                <Link
                  key={c.case_id}
                  to={`/cases/${c.case_id}`}
                  className="cell"
                  role="listitem"
                  data-state={stateOf(c)}
                  style={{ "--i": i } as CSSProperties}
                >
                  <span className="who">{c.owner?.display_name ?? "unowned"}</span>
                  <span className="ref">{c.case_id}</span>
                  <span className="name">{c.patient.display_name}</span>
                  <span className="stage">{c.stage_label}</span>
                  <span className="due">
                    <b>{due.value}</b>
                    <i>{due.unit}</i>
                  </span>
                  <span
                    className={`badge${c.owner === null && !c.flags.includes("closed") ? " alarm" : ""}`}
                  >
                    {c.flags.includes("late")
                      ? c.owner === null
                        ? "unowned"
                        : "escalated"
                      : c.owner === null && !c.flags.includes("closed")
                        ? "no owner"
                        : c.flags_renderable[0]}
                  </span>
                </Link>
              );
            })}
          </div>

          {error && (
            <p style={{ padding: "32px 0", fontSize: 13 }}>{error.message}</p>
          )}

          {!loading && !error && rows.length === 0 && (
            <p style={{ padding: "32px 0", fontSize: 13 }}>
              No case matches this filter. Clear it to see all {counts.open} open cases.
            </p>
          )}

          <div className="grid-foot">
            <span className="key">
              <s className="late" />
              past deadline
            </span>
            <span className="key">
              <s className="due" />
              due within 48 hours
            </span>
            {/* The grid carries closed rows too, so the denominator is the register this role
                can see, not counts.open. */}
            <span>{rows.length} of {data.cases.length} shown</span>
            <span className="right">Grid is the register · open a cell to act</span>
          </div>
        </>
      )}
    </Page>
  );
}
