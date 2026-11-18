import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import Worklist from "./pages/Worklist";
import CaseDetail from "./pages/CaseDetail";
import Outreach from "./pages/Outreach";
import Closure from "./pages/Closure";
import Programme from "./pages/Programme";
import NotFound from "./pages/NotFound";
// TICKET-10
import PatientPage from "./pages/Patient";
// TICKET-08
import Unstitched from "./pages/Unstitched";

export default function App() {
  return (
    <Routes>
      {/* TICKET-10: the patient page from the message link, outside the staff shell. */}
      <Route path="/p/:token" element={<PatientPage />} />
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/cases" replace />} />
        <Route path="/cases" element={<Worklist />} />
        <Route path="/cases/:ref" element={<CaseDetail />} />
        <Route path="/cases/:ref/outreach" element={<Outreach />} />
        <Route path="/cases/:ref/closure" element={<Closure />} />
        <Route path="/programme" element={<Programme />} />
        {/* TICKET-08 */}
        <Route path="/ingest/unstitched" element={<Unstitched />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
