import { BrowserRouter, Route, Routes } from "react-router";
import { registerAppCommands } from "../commands";
import { Shell } from "./Shell";
import { PortfolioPage } from "../features/portfolio/PortfolioPage";
import { PrintPage } from "../features/print/PrintPage";
import { WorkspacePage } from "../features/workspace/WorkspacePage";

// Registro único dos comandos: teclado, menus e paleta usam os mesmos ids.
registerAppCommands();

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<PortfolioPage />} />
          <Route path="/p/:projectId" element={<WorkspacePage />} />
        </Route>
        {/* Pré-visualização de impressão isolada (docs/architecture.md §11.3) */}
        <Route path="/p/:projectId/print" element={<PrintPage />} />
      </Routes>
    </BrowserRouter>
  );
}
