import { BrowserRouter, Route, Routes } from "react-router";
import { registerAppCommands } from "../commands";
import { Shell } from "./Shell";
import { AuthProvider, RequireAuth } from "../features/auth/AuthContext";
import { LoginPage } from "../features/auth/LoginPage";
import { SetupPage } from "../features/auth/SetupPage";
import { AccountPage } from "../features/account/AccountPage";
import { PortfolioPage } from "../features/portfolio/PortfolioPage";
import { PrintPage } from "../features/print/PrintPage";
import { WorkspacePage } from "../features/workspace/WorkspacePage";

// Registro único dos comandos: teclado, menus e paleta usam os mesmos ids.
registerAppCommands();

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/primeiro-acesso" element={<SetupPage />} />
          <Route
            element={
              <RequireAuth>
                <Shell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<PortfolioPage />} />
            <Route path="/p/:projectId" element={<WorkspacePage />} />
            <Route path="/conta" element={<AccountPage />} />
          </Route>
          {/* Pré-visualização de impressão isolada (docs/architecture.md §11.3) */}
          <Route
            path="/p/:projectId/print"
            element={
              <RequireAuth>
                <PrintPage />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
