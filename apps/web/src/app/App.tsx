import { BrowserRouter, Route, Routes } from "react-router";
import { Shell } from "./Shell";
import { PortfolioPage } from "../features/portfolio/PortfolioPage";
import { WorkspacePage } from "../features/workspace/WorkspacePage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<PortfolioPage />} />
          <Route path="/p/:projectId" element={<WorkspacePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
