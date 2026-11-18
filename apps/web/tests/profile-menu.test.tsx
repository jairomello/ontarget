import "./helpers/dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, within, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../src/features/auth/AuthContext";
import { ProfileMenu, initialsOf } from "../src/features/auth/ProfileMenu";
import { type AuthUser } from "../src/lib/api";
import { json, stubFetch, unauthorized } from "./helpers/fetch";

const USER: AuthUser = {
  id: "u1",
  email: "dono@exemplo.org",
  name: "Jairo Mello",
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

function renderMenu(options: { authenticated?: boolean; hasAvatar?: boolean } = {}): RenderResult {
  const authenticated = options.authenticated ?? true;
  restore = stubFetch((url) => {
    if (url.includes("/api/auth/state")) return json({ needsSetup: false });
    if (url.includes("/api/auth/me")) {
      return authenticated
        ? json({ user: { ...USER, hasAvatar: options.hasAvatar ?? false } })
        : unauthorized();
    }
    if (url.includes("/api/auth/logout")) return json({ ok: true });
    return undefined;
  });

  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/"
            element={
              <div>
                <ProfileMenu />
                <button type="button" data-testid="fora">
                  fora
                </button>
              </div>
            }
          />
          <Route path="/conta" element={<div data-testid="conta" />} />
          <Route path="/login" element={<div data-testid="login" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function panel(result: RenderResult): HTMLElement {
  const found = within(result.container).queryByTestId("profile-menu-panel");
  if (!found) throw new Error("painel do menu não está aberto");
  return found;
}

describe("initialsOf", () => {
  it("usa a primeira letra do primeiro e do último nome", () => {
    expect(initialsOf("Jairo Mello")).toBe("JM");
    expect(initialsOf("  Ana  Pereira  ")).toBe("AP");
    expect(initialsOf("Dono")).toBe("D");
    expect(initialsOf("   ")).toBe("?");
  });
});

describe("ProfileMenu", () => {
  it("abre com nome, e-mail e ações", async () => {
    const result = renderMenu();
    for (let attempt = 0; attempt < 50 && !within(result.container).queryByTestId("profile-menu"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(within(result.container).queryAllByTestId("profile-menu-panel")).toHaveLength(0);

    fireEvent.click(within(result.container).getByTestId("profile-menu"));

    const open = panel(result);
    expect(within(open).getByTestId("profile-menu-name").textContent).toBe("Jairo Mello");
    expect(within(open).getByTestId("profile-menu-email").textContent).toBe("dono@exemplo.org");
    expect(within(open).getByTestId("profile-menu-account")).toBeTruthy();
    expect(within(open).getByTestId("profile-menu-keys")).toBeTruthy();
    expect(within(open).getByTestId("profile-menu-logout")).toBeTruthy();
    expect(within(result.container).getByTestId("profile-menu").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("mostra as iniciais quando não há foto", async () => {
    const result = renderMenu();
    for (let attempt = 0; attempt < 50 && !within(result.container).queryByTestId("profile-menu"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(within(result.container).getByTestId("profile-initials").textContent).toBe("JM");
    expect(within(result.container).queryAllByTestId("profile-avatar")).toHaveLength(0);
  });

  it("fecha ao clicar fora", async () => {
    const result = renderMenu();
    for (let attempt = 0; attempt < 50 && !within(result.container).queryByTestId("profile-menu"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    fireEvent.click(within(result.container).getByTestId("profile-menu"));
    expect(panel(result)).toBeTruthy();

    fireEvent.mouseDown(within(result.container).getByTestId("fora"));
    expect(within(result.container).queryAllByTestId("profile-menu-panel")).toHaveLength(0);
  });

  it("`Esc` fecha e devolve o foco ao botão", async () => {
    const result = renderMenu();
    for (let attempt = 0; attempt < 50 && !within(result.container).queryByTestId("profile-menu"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const trigger = within(result.container).getByTestId("profile-menu");
    fireEvent.click(trigger);
    panel(result);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(within(result.container).queryAllByTestId("profile-menu-panel")).toHaveLength(0);
    expect(activeTestId()).toBe("profile-menu");
  });

  it("as setas percorrem as ações do menu", async () => {
    const result = renderMenu();
    for (let attempt = 0; attempt < 50 && !within(result.container).queryByTestId("profile-menu"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    fireEvent.click(within(result.container).getByTestId("profile-menu"));
    const open = panel(result);
    const account = within(open).getByTestId("profile-menu-account");

    fireEvent.keyDown(account, { key: "ArrowDown" });
    expect(activeTestId()).toBe("profile-menu-keys");

    fireEvent.keyDown(within(open).getByTestId("profile-menu-keys"), { key: "ArrowUp" });
    expect(activeTestId()).toBe("profile-menu-account");

    fireEvent.keyDown(account, { key: "ArrowUp" });
    expect(activeTestId()).toBe("profile-menu-logout");
  });

  it("vai para a conta e para as chaves", async () => {
    const result = renderMenu();
    for (let attempt = 0; attempt < 50 && !within(result.container).queryByTestId("profile-menu"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    fireEvent.click(within(result.container).getByTestId("profile-menu"));
    fireEvent.click(within(panel(result)).getByTestId("profile-menu-account"));

    expect(await waitFound(result, "conta")).toBeTruthy();
    expect(within(result.container).queryAllByTestId("profile-menu-panel")).toHaveLength(0);
  });

  it("sai encerra a sessão e manda para o login", async () => {
    const result = renderMenu();
    for (let attempt = 0; attempt < 50 && !within(result.container).queryByTestId("profile-menu"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    fireEvent.click(within(result.container).getByTestId("profile-menu"));
    fireEvent.click(within(panel(result)).getByTestId("profile-menu-logout"));

    expect(await waitFound(result, "login")).toBeTruthy();
  });
});

/** `data-testid` do elemento focado (evita imprimir o nó inteiro no erro). */
function activeTestId(): string | null {
  const active = document.activeElement as HTMLElement | null;
  return active?.getAttribute("data-testid") ?? null;
}

async function waitFound(result: RenderResult, testId: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const element = within(result.container).queryByTestId(testId);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`elemento [data-testid="${testId}"] não apareceu`);
}
