import "./helpers/dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, within, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AccountPage } from "../src/features/account/AccountPage";
import { AuthProvider, RequireAuth } from "../src/features/auth/AuthContext";
import { type AuthUser, type ApiKeyInfo } from "../src/lib/api";
import { json, sentBody, stubFetch, unauthorized } from "./helpers/fetch";

const USER: AuthUser = {
  id: "u1",
  email: "dono@exemplo.org",
  name: "Jairo Mello",
  hasAvatar: false,
  theme: "auto",
  density: "comfortable",
  palette: "indigo",
};

const KEY: ApiKeyInfo = {
  id: "k1",
  name: "Agente antigo",
  createdAt: Date.UTC(2026, 0, 5),
  lastUsedAt: null,
};

interface Captured {
  calls: Array<{ url: string; init?: RequestInit }>;
  keys: ApiKeyInfo[];
  user: AuthUser;
}

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  cleanup();
});

function renderAccount(): { result: RenderResult; captured: Captured } {
  const captured: Captured = { calls: [], keys: [KEY], user: USER };

  restore = stubFetch((url, init) => {
    captured.calls.push({ url, init });

    if (url.includes("/api/auth/state")) return json({ needsSetup: false });
    if (url.includes("/api/auth/me")) return json({ user: captured.user });

    if (url.includes("/api/users/me/password")) return json({ ok: true });

    if (url.includes("/api/users/me/avatar")) return json({ user: captured.user });

    if (url.includes("/api/users/me")) {
      const body = sentBody(init);
      captured.user = { ...captured.user, ...body } as AuthUser;
      return json({ user: captured.user });
    }

    if (url.includes("/api/api-keys/") && init?.method === "DELETE") {
      const id = url.split("/").pop();
      captured.keys = captured.keys.filter((key) => key.id !== id);
      return json({ key: KEY });
    }

    if (url.includes("/api/api-keys") && init?.method === "POST") {
      const name = String(sentBody(init).name ?? "");
      const created: ApiKeyInfo = { id: "k2", name, createdAt: Date.now(), lastUsedAt: null };
      captured.keys = [...captured.keys, created];
      return json({ key: created, value: "ont_valor-exibido-uma-vez" }, 201);
    }

    if (url.includes("/api/api-keys")) return json({ keys: captured.keys });

    return undefined;
  });

  const result = render(
    <MemoryRouter initialEntries={["/conta"]}>
      <AuthProvider>
        <Routes>
          <Route path="/conta" element={<AccountPage />} />
          <Route path="/" element={<div data-testid="home" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

  return { result, captured };
}

async function waitFound(result: RenderResult, testId: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    // `queryAllByTestId`: ids como `api-key-item` aparecem mais de uma vez.
    const elements = within(result.container).queryAllByTestId(testId);
    if (elements[0]) return elements[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`elemento [data-testid="${testId}"] não apareceu`);
}

function field(result: RenderResult, testId: string): HTMLInputElement {
  const element = within(result.container).getByTestId(testId);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${testId} não é input`);
  return element;
}

function fill(result: RenderResult, testId: string, value: string): void {
  fireEvent.input(field(result, testId), { target: { value } });
}

/**
 * Envia o formulário que contém o elemento: clicar no botão `submit` faz o
 * happy-dom tentar navegar e derruba a árvore renderizada.
 */
function submitFormOf(result: RenderResult, testId: string): void {
  const element = within(result.container).getByTestId(testId);
  const form = element.closest("form");
  if (!form) throw new Error(`sem formulário por trás de ${testId}`);
  fireEvent.submit(form);
}

describe("AccountPage", () => {
  it("exibe as quatro seções da conta", async () => {
    const { result } = renderAccount();

    expect((await waitFound(result, "account-page")).getAttribute("data-testid")).toBe("account-page");
    expect(await waitFound(result, "api-keys-list")).toBeTruthy();
    expect(within(result.container).getByTestId("account-name")).toBeTruthy();
    expect(within(result.container).getByTestId("account-email")).toBeTruthy();
    expect(within(result.container).getByTestId("account-password-submit")).toBeTruthy();
    expect(within(result.container).getByTestId("appearance-theme-light")).toBeTruthy();
    expect(within(result.container).getByTestId("appearance-palette-violet")).toBeTruthy();
    expect(within(result.container).getByTestId("api-keys-guide").textContent).toContain(
      "exibida uma única vez",
    );
  });

  it("e-mail é somente leitura", async () => {
    const { result } = renderAccount();
    await waitFound(result, "account-email");
    const email = field(result, "account-email");
    expect(email.readOnly).toBe(true);
    expect(email.disabled).toBe(true);
  });

  it("recusa salvar nome vazio", async () => {
    const { result } = renderAccount();
    await waitFound(result, "account-name");

    fill(result, "account-name", "   ");
    fireEvent.click(within(result.container).getByTestId("account-name-save"));

    expect(within(result.container).getByTestId("account-error").textContent).toContain(
      "1 a 200 caracteres",
    );
  });

  it("salva o nome e atualiza a conta", async () => {
    const { result, captured } = renderAccount();
    await waitFound(result, "account-name");

    fill(result, "account-name", "Jairo S. Mello");
    fireEvent.click(within(result.container).getByTestId("account-name-save"));

    const success = await waitFound(result, "account-success");
    expect(success.textContent).toContain("Nome salvo");

    const patch = captured.calls.find(
      (call) => call.url.includes("/api/users/me") && call.init?.method === "PATCH",
    );
    expect(patch).toBeTruthy();
    expect(sentBody(patch?.init)).toMatchObject({ name: "Jairo S. Mello" });
  });

  it("valida a troca de senha antes de enviar", async () => {
    const { result } = renderAccount();
    await waitFound(result, "account-password-submit");

    fill(result, "account-password-current", "senha-antiga");
    fill(result, "account-password-new", "curta");
    fill(result, "account-password-confirm", "curta");
    submitFormOf(result, "account-password-submit");

    expect(within(result.container).getByTestId("account-password-error").textContent).toContain(
      "no mínimo 10 caracteres",
    );

    fill(result, "account-password-new", "senha-nova-bem-longa");
    fill(result, "account-password-confirm", "outra-senha-diferente");
    submitFormOf(result, "account-password-submit");

    expect(within(result.container).getByTestId("account-password-error").textContent).toContain(
      "não confere",
    );
  });

  it("troca a senha com os três campos corretos", async () => {
    const { result, captured } = renderAccount();
    await waitFound(result, "account-password-submit");

    fill(result, "account-password-current", "senha-antiga-bem-longa");
    fill(result, "account-password-new", "senha-nova-bem-longa");
    fill(result, "account-password-confirm", "senha-nova-bem-longa");
    submitFormOf(result, "account-password-submit");

    const success = await waitFound(result, "account-password-success");
    expect(success.textContent).toContain("Senha alterada");

    const patch = captured.calls.find(
      (call) => call.url.includes("/api/users/me/password") && call.init?.method === "PATCH",
    );
    expect(patch).toBeTruthy();
    expect(field(result, "account-password-current").value).toBe("");
  });

  it("troca a paleta e grava na conta", async () => {
    const { result, captured } = renderAccount();
    await waitFound(result, "appearance-palette-violet");

    fireEvent.click(within(result.container).getByTestId("appearance-palette-violet"));

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const patch = captured.calls.find(
        (call) => call.url.includes("/api/users/me") && call.init?.method === "PATCH",
      );
      if (patch && sentBody(patch.init).palette === "violet") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const patch = captured.calls.find(
      (call) => call.url.includes("/api/users/me") && call.init?.method === "PATCH",
    );
    expect(sentBody(patch?.init)).toMatchObject({ palette: "violet" });
  });

  it("cria uma chave e mostra o valor uma única vez", async () => {
    const { result, captured } = renderAccount();
    await waitFound(result, "api-keys-list");

    fireEvent.click(within(result.container).getByTestId("api-key-new"));
    fill(result, "api-key-name", "Agente novo");
    submitFormOf(result, "api-key-create");

    const value = await waitFound(result, "api-key-created-value");
    expect(value.textContent).toBe("ont_valor-exibido-uma-vez");

    // A listagem nunca traz o valor.
    fireEvent.click(within(result.container).getByTestId("api-key-created-close"));
    await waitFound(result, "api-key-item");
    expect(within(result.container).queryAllByTestId("api-key-created-value")).toHaveLength(0);
    expect(JSON.stringify(captured.keys)).not.toContain("ont_valor");

    const created = captured.calls.find(
      (call) => call.url.includes("/api/api-keys") && call.init?.method === "POST",
    );
    expect(sentBody(created?.init)).toMatchObject({ name: "Agente novo" });
  });

  it("revoga chave com confirmação", async () => {
    const { result, captured } = renderAccount();
    await waitFound(result, "api-key-item");

    fireEvent.click(within(result.container).getByTestId("api-key-revoke"));
    expect(within(result.container).queryAllByTestId("api-key-revoke-confirm").length).toBe(1);

    fireEvent.click(within(result.container).getByTestId("api-key-revoke-cancel"));
    expect(within(result.container).queryAllByTestId("api-key-revoke-confirm")).toHaveLength(0);
    expect(captured.keys).toHaveLength(1);

    fireEvent.click(within(result.container).getByTestId("api-key-revoke"));
    fireEvent.click(within(result.container).getByTestId("api-key-revoke-confirm"));

    // Espera a LISTAGEM (não o stub) esvaziar: o `load()` posterior ao DELETE
    // é quem remove os itens do DOM.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (within(result.container).queryAllByTestId("api-key-item").length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(captured.keys).toHaveLength(0);
    expect(within(result.container).queryAllByTestId("api-key-item")).toHaveLength(0);
  });

  it("sem sessão não chega na conta", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return unauthorized();
      return undefined;
    });

    // Mesma guarda do App: a rota protegida fica dentro do `RequireAuth`.
    const result = render(
      <MemoryRouter initialEntries={["/conta"]}>
        <AuthProvider>
          <Routes>
            <Route
              path="/conta"
              element={
                <RequireAuth>
                  <AccountPage />
                </RequireAuth>
              }
            />
            <Route path="/login" element={<div data-testid="login" />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await waitFound(result, "login")).toBeTruthy();
    expect(within(result.container).queryAllByTestId("account-page")).toHaveLength(0);
  });
});
