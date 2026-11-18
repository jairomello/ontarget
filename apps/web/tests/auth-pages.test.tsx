import "./helpers/dom";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, within, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "../src/features/auth/AuthContext";
import { LoginPage } from "../src/features/auth/LoginPage";
import { SetupPage } from "../src/features/auth/SetupPage";
import { json, sentBody, stubFetch, unauthorized } from "./helpers/fetch";

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  cleanup();
});

function renderPage(path: string): RenderResult {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/primeiro-acesso" element={<SetupPage />} />
          <Route path="/" element={<div data-testid="home" />} />
          <Route path="/p/:projectId" element={<div data-testid="destino" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function waitFound(result: RenderResult, testId: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const element = within(result.container).queryByTestId(testId);
    if (element) return element;
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
  // React 19 escuta `input` em campos de texto; `fireEvent.change` dispara só
  // `change` e o estado não muda (o valor é revertido no próximo render).
  fireEvent.input(field(result, testId), { target: { value } });
}

function submit(result: RenderResult): void {
  const form = result.container.querySelector("form");
  if (!form) throw new Error("formulário não encontrado");
  fireEvent.submit(form);
}

/** Estado com conta já criada e sessão expirada (fluxo normal de login). */
function anonymousServer(): void {
  restore = stubFetch((url) => {
    if (url.includes("/api/auth/state")) return json({ needsSetup: false });
    if (url.includes("/api/auth/me")) return unauthorized();
    if (url.includes("/api/auth/login")) return json({ user: { id: "u1" } });
    return undefined;
  });
}

describe("LoginPage", () => {
  it("exige e-mail e senha antes de chamar o servidor", async () => {
    anonymousServer();
    const result = renderPage("/login");
    await waitFound(result, "login-email");

    submit(result);

    expect(within(result.container).getByTestId("login-error").textContent).toContain(
      "Informe e-mail e senha",
    );
  });

  it("mostra a mensagem genérica do servidor para credencial errada", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return unauthorized();
      if (url.includes("/api/auth/login")) return unauthorized("E-mail ou senha incorretos");
      return undefined;
    });

    const result = renderPage("/login");
    await waitFound(result, "login-email");

    fill(result, "login-email", "dono@exemplo.org");
    fill(result, "login-password", "senha-inicial");
    submit(result);

    const error = await waitFound(result, "login-error");
    expect(error.textContent).toBe("E-mail ou senha incorretos");
  });

  it("entra e vai para a rota pedida em `next`", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: false });
      if (url.includes("/api/auth/me")) return unauthorized();
      if (url.includes("/api/auth/login")) return json({ user: { id: "u1" } });
      return undefined;
    });

    const result = renderPage("/login?next=%2Fp%2Fabc");
    await waitFound(result, "login-email");

    fill(result, "login-email", "dono@exemplo.org");
    fill(result, "login-password", "senha-inicial");
    submit(result);

    expect(await waitFound(result, "destino")).toBeTruthy();
  });

  it("instalação sem conta manda direto para o primeiro acesso", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: true });
      if (url.includes("/api/auth/me")) return unauthorized();
      return undefined;
    });

    const result = renderPage("/login");

    expect(await waitFound(result, "setup-name")).toBeTruthy();
    expect(within(result.container).queryAllByTestId("login-email")).toHaveLength(0);
  });
});

describe("SetupPage", () => {
  it("recusa senha curta", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: true });
      if (url.includes("/api/auth/me")) return unauthorized();
      return undefined;
    });

    const result = renderPage("/primeiro-acesso");
    await waitFound(result, "setup-name");

    fill(result, "setup-name", "Dono");
    fill(result, "setup-email", "dono@exemplo.org");
    fill(result, "setup-password", "curta");
    fill(result, "setup-confirm", "curta");
    submit(result);

    expect(within(result.container).getByTestId("setup-error").textContent).toContain(
      "no mínimo 10 caracteres",
    );
  });

  it("recusa confirmação divergente", async () => {
    restore = stubFetch((url) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: true });
      if (url.includes("/api/auth/me")) return unauthorized();
      return undefined;
    });

    const result = renderPage("/primeiro-acesso");
    await waitFound(result, "setup-name");

    fill(result, "setup-name", "Dono");
    fill(result, "setup-email", "dono@exemplo.org");
    fill(result, "setup-password", "senha-bem-longa");
    fill(result, "setup-confirm", "outra-senha-longa");
    submit(result);

    expect(within(result.container).getByTestId("setup-error").textContent).toContain(
      "não confere",
    );
  });

  it("cria a conta e entra", async () => {
    let sentSetup: Record<string, unknown> = {};
    restore = stubFetch((url, init) => {
      if (url.includes("/api/auth/state")) return json({ needsSetup: true });
      if (url.includes("/api/auth/me")) return unauthorized();
      if (url.includes("/api/auth/setup")) {
        sentSetup = sentBody(init);
        return json({ user: { id: "u1" } }, 201);
      }
      return undefined;
    });

    const result = renderPage("/primeiro-acesso");
    await waitFound(result, "setup-name");

    fill(result, "setup-name", "Dono da Casa");
    fill(result, "setup-email", "dono@exemplo.org");
    fill(result, "setup-password", "senha-bem-longa");
    fill(result, "setup-confirm", "senha-bem-longa");
    submit(result);

    expect(await waitFound(result, "home")).toBeTruthy();
    expect(sentSetup).toMatchObject({
      email: "dono@exemplo.org",
      name: "Dono da Casa",
      password: "senha-bem-longa",
      confirmPassword: "senha-bem-longa",
    });
  });
});
