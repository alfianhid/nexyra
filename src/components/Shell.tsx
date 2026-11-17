import { createContext, useContext, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

export type Role = "coordinator" | "physician" | "program_manager";

export const roleLabels: Record<Role, string> = {
  coordinator: "Coordination · R. Haddad",
  physician: "Physician · Dr. Fulan",
  program_manager: "Program manager · A. Al Suwaidi",
};

const RoleContext = createContext<{ role: Role; setRole: (r: Role) => void }>({
  role: "coordinator",
  setRole: () => {},
});

export function useRole() {
  return useContext(RoleContext);
}

export function Shell() {
  const [role, setRole] = useState<Role>("coordinator");

  return (
    <RoleContext.Provider value={{ role, setRole }}>
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
            <b>17 Nov 2026 · 11:42</b>
            demo clock · UTC+7
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
