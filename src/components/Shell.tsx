import { createContext, useContext, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { actorFor } from "../api/actors";
import { api } from "../api";
import type { Actor } from "../api/types";
import { useAsync } from "../hooks/useAsync";

export type Role = "coordinator" | "physician" | "program_manager";

export const roleLabels: Record<Role, string> = {
  coordinator: "Coordination · R. Haddad",
  physician: "Physician · Dr. Fulan",
  program_manager: "Program manager · A. Al Suwaidi",
};

// The picker is the prototype's stand-in for the X-Nexyra-Actor header: it carries the
// whole actor, so a page never has to invent an id or a display name.
type RoleContextValue = {
  role: Role;
  setRole: (r: Role) => void;
  actor: Actor;
  // Bumped whenever the demo clock moves, so a page re-reads instead of showing data it
  // fetched before the jump. It is a dependency, not a value the UI prints.
  clockVersion: number;
};

const RoleContext = createContext<RoleContextValue>({
  role: "coordinator",
  setRole: () => {},
  actor: actorFor("coordinator"),
  clockVersion: 0,
});

export function useRole() {
  return useContext(RoleContext);
}

export function Shell() {
  const [role, setRole] = useState<Role>("coordinator");
  const [clockVersion, setClockVersion] = useState(0);
  const clock = useAsync(() => api.getClock(), [clockVersion]);

  async function advance(days: number | "next_deadline") {
    await api.advanceClock(days);
    setClockVersion((v) => v + 1);
  }

  return (
    <RoleContext.Provider value={{ role, setRole, actor: actorFor(role), clockVersion }}>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <img src="/brand/favicon.svg" alt="" width={22} height={22} aria-hidden="true" />
            <span>
              Nexyra
              <small>Abu Dhabi · screening</small>
            </span>
          </div>
          <nav className="nav" aria-label="Main">
            <NavLink to="/cases" end>
              Cases
            </NavLink>
            <NavLink to="/programme">Programme</NavLink>
            {/* TICKET-08: the not-yet-stitched queue is coordination and programme work. */}
            {role !== "physician" && <NavLink to="/ingest/unstitched">Unstitched</NavLink>}
          </nav>
          <div className="role">
            <label htmlFor="role">Acting as</label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="coordinator">Coordinator</option>
              <option value="physician">Physician</option>
              <option value="program_manager">Program manager</option>
            </select>
          </div>
          <div className="clock">
            <b>{clock.data?.label ?? "17 Nov 2026 · 11:42"}</b>
            demo clock · UTC+7
            <div className="clock-actions">
              <button type="button" onClick={() => advance(1)} disabled={clock.loading}>
                +1 day
              </button>
              <button
                type="button"
                onClick={() => advance("next_deadline")}
                disabled={clock.loading}
              >
                Next deadline
              </button>
            </div>
          </div>
        </header>
        <main id="main">
          <Outlet />
        </main>
        <footer className="foot">
          <span>All data synthetic · generated for the demo</span>
          <span>Every case carries an owner, a deadline, an audit line</span>
          <span className="right">Nexyra · case engine</span>
        </footer>
      </div>
    </RoleContext.Provider>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>;
}
