import "./helpers/dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, within, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider, RequireAuth } from "../src/features/auth/AuthContext";
import { LoginPage } from "../src/features/auth/LoginPage";
import { SetupPage } from "../src/features/auth/SetupPage";
import { api, type AuthUser } from "../src/lib/api";
import { json, stubFetch, unauthorized } from "./helpers/fetch";

/**
 * `screen` do Testing Library captura `document.body` no carregamento do
 * módulo, antes do happy-dom registrar o DOM — por isso as consultas usam
 * `within(container)`, resolvidas na hora do teste.
 */

const USER: AuthUser = {
  id: "u1",
  email: "dono@exemplo.org",
  name: "Dono",
  hasAvatar: false,
  theme: "auto",
  density: "comfortable",
  palette: "indigo",
};

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  cleanup();
});

function find(result: RenderResult, testId: string): HTMLElement | null {
  return within(result.container).queryByTestId(testId);
}

async function waitFound(result: RenderResult, testId: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const element = find(result, testId);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`elemento [data-testid="${testId}"] não apareceu`);
}

function renderGuard(initialPath = "/"): RenderResult {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/primeiro-acesso" element={<SetupPage />} />
          <Route
            element={
              <RequireAuth>
                <div data-testid="conteudo-privado">privado</div>
                <button
                  type="button"
                  data-testid="dispara-401"
                  onClick={() => void api.listProjects().catch(() => undefined)}
                >
                  lista
                </button>
              </RequireAuth>
            }
          >
            <Route path="/" element={<div />} />
            <Route path="/p/:projectId" element={<div />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AuthProvider + RequireAuth", () => {
  it("libera a rota quando há sessão", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return json({ user: USER });
      return undefined;
    });

    const result = renderGuard("/");

    await waitFound(result, "conteudo-privado");
    expect(find(result, "login-email")).toBeNull();
  });

  it("manda para o login preservando a rota pretendida", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return unauthorized();
      return undefined;
    });

    const result = renderGuard("/p/abc");

    await waitFound(result, "login-email");
    expect(find(result, "conteudo-privado")).toBeNull();
  });

  it("sem conta na instalação, manda para o primeiro acesso", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: true });
      if (url.includes("/api/auth/me")) return unauthorized();
      return undefined;
    });

    const result = renderGuard("/");

    await waitFound(result, "setup-name");
    expect(find(result, "login-email")).toBeNull();
  });

  it("mostra o carregando enquanto a sessão é resolvida", () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/auth/me")) return new Promise<Response>(() => undefined);
      return json({ needsSetup: false });
    }) as typeof globalThis.fetch;
    restore = () => {
      globalThis.fetch = original;
    };

    const result = renderGuard("/");

    expect(find(result, "auth-loading")).toBeTruthy();
    expect(find(result, "login-email")).toBeNull();
  });

  it("401 em chamada de dados limpa a sessão e volta ao login", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return json({ user: USER });
      if (url.includes("/api/projects")) return unauthorized();
      return undefined;
    });

    const result = renderGuard("/");
    await waitFound(result, "conteudo-privado");

    fireEvent.click(within(result.container).getByTestId("dispara-401"));

    await waitFound(result, "login-email");
    expect(find(result, "conteudo-privado")).toBeNull();
  });
});
