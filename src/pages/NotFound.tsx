import { Link } from "react-router-dom";
import { Page, useRole } from "../components/Shell";
import { api } from "../api";
import { roleFor } from "../api/roles";
import { useAsync } from "../hooks/useAsync";

export default function NotFound() {
  const { role, clockVersion } = useRole();
  const register = useAsync(() => api.listCases(roleFor[role]), [role, clockVersion]);
  const counts = register.data?.counts;

  return (
    <Page>
      <div className="summary">
        <div className="figure">
          <span>Route not found</span>
          <b>404</b>
          <p>This address does not point at a case or a screen.</p>
          <i aria-hidden="true" />
        </div>
        <div className="counts">
          <div className="count">
            <span>Register</span>
            <b>{counts?.open ?? "—"}</b>
            <p>open cases, each with an owner and a deadline</p>
          </div>
          <div className="count">
            <span>Unowned</span>
            <b className="alarm">{counts?.unowned ?? "—"}</b>
            <p>the exceptions worth opening first</p>
          </div>
          <div className="count">
            <span>Programme</span>
            <b>{counts?.closed_this_week ?? "—"}</b>
            <p>cases closed this week</p>
          </div>
        </div>
      </div>

      <section className="section">
        <h2>Where to go next</h2>
        <p className="note">
          Case references look like <code className="ref">CX-0417</code>. Anything else is not a
          case in this programme.
        </p>
        <div className="actions">
          <Link className="btn primary" to="/cases">
            Open the register
          </Link>
          <Link className="btn" to="/cases/CX-0417">
            Example case
          </Link>
          <Link className="btn" to="/programme">
            Programme view
          </Link>
        </div>
      </section>
    </Page>
  );
}
