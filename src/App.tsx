import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import Worklist from "./pages/Worklist";
import CaseDetail from "./pages/CaseDetail";
import Outreach from "./pages/Outreach";
import Closure from "./pages/Closure";
import Programme from "./pages/Programme";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/cases" replace />} />
        <Route path="/cases" element={<Worklist />} />
        <Route path="/cases/:ref" element={<CaseDetail />} />
        <Route path="/cases/:ref/outreach" element={<Outreach />} />
        <Route path="/cases/:ref/closure" element={<Closure />} />
        <Route path="/programme" element={<Programme />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
