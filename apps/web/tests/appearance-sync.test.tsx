import "./helpers/dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, within, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AccountPage } from "../src/features/account/AccountPage";
import { AuthProvider, RequireAuth } from "../src/features/auth/AuthContext";
import { useUiStore } from "../src/store/uiStore";
import { useAppearance } from "../src/ui/useAppearance";
import { json, sentBody, stubFetch, unauthorized } from "./helpers/fetch";
import type { AuthUser } from "../src/lib/api";

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

beforeEach(() => {
  useUiStore.setState({ theme: "auto", density: "comfortable", palette: "indigo" });
});

afterEach(() => {
  restore?.();
  restore = undefined;
  cleanup();
  useUiStore.setState({ theme: "auto", density: "comfortable", palette: "indigo" });
});

/** Componente que aplica a aparência no documento, como faz o Shell. */
function AppearanceProbe() {
  useAppearance();
  return <div data-testid="probe" />;
}

async function waitFound(result: RenderResult, testId: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const elements = within(result.container).queryAllByTestId(testId);
    if (elements[0]) return elements[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`elemento [data-testid="${testId}"] não apareceu`);
}

describe("aparência sincronizada com a conta", () => {
  it("aplica tema, densidade e paleta da conta no carregamento", async () => {
    const account: AuthUser = { ...USER, theme: "dark", density: "wide", palette: "violet" };
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return json({ user: account });
      return undefined;
    });

    const result = render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<AppearanceProbe />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFound(result, "probe");

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (document.documentElement.getAttribute("data-theme") === "dark") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-density")).toBe("wide");
    expect(document.documentElement.getAttribute("data-palette")).toBe("violet");
    expect(useUiStore.getState().palette).toBe("violet");
  });

  it("guarda a preferência escolhida na conta", async () => {
    let patched: Record<string, unknown> = {};
    restore = stubFetch((url, init) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return json({ user: USER });
      if (url.includes("/api/api-keys")) return json({ keys: [] });
      if (url.includes("/api/users/me") && init?.method === "PATCH") {
        patched = sentBody(init);
        return json({ user: { ...USER, ...patched } as AuthUser });
      }
      if (url.includes("/api/users/me")) return json({ user: USER });
      return undefined;
    });

    const result = render(
      <MemoryRouter initialEntries={["/conta"]}>
        <AuthProvider>
          <Routes>
            <Route path="/conta" element={<AccountPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFound(result, "appearance-palette-emerald");

    fireEvent.click(within(result.container).getByTestId("appearance-palette-emerald"));

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (patched.palette === "emerald") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(patched).toMatchObject({ palette: "emerald" });
    expect(useUiStore.getState().palette).toBe("emerald");
    expect(document.documentElement.getAttribute("data-palette")).toBe("emerald");
  });

  it("restaura a aparência anterior quando o servidor recusa", async () => {
    restore = stubFetch((url, init) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return json({ user: USER });
      if (url.includes("/api/api-keys")) return json({ keys: [] });
      if (url.includes("/api/users/me") && init?.method === "PATCH") {
        return json({ error: { code: "server_error", message: "falha ao salvar" } }, 500);
      }
      if (url.includes("/api/users/me")) return json({ user: USER });
      return undefined;
    });

    const result = render(
      <MemoryRouter initialEntries={["/conta"]}>
        <AuthProvider>
          <Routes>
            <Route path="/conta" element={<AccountPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFound(result, "appearance-palette-emerald");

    fireEvent.click(within(result.container).getByTestId("appearance-palette-emerald"));

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (useUiStore.getState().palette === "indigo") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(useUiStore.getState().palette).toBe("indigo");
    expect(document.documentElement.getAttribute("data-palette")).toBe("indigo");
  });

  it("sem sessão não há preferência para aplicar", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return unauthorized();
      return undefined;
    });

    const result = render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <AppearanceProbe />
                </RequireAuth>
              }
            />
            <Route path="/login" element={<div data-testid="login" />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFound(result, "login");
    expect(document.documentElement.getAttribute("data-theme")).not.toBe("dark");
  });
});
