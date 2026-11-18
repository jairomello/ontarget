import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { request, type APIRequestContext } from "@playwright/test";

/**
 * Prepara o E2E autenticado (specs/user-auth e user-profile).
 *
 * O `webServer` sobe antes do `globalSetup`, então dá para falar com a API:
 * cria a conta inicial (banco novo a cada execução) ou entra com a mesma
 * conta quando o servidor é reaproveitado, e grava o `storageState` que o
 * `playwright.config.ts` injeta em todos os testes — inclusive nas chamadas
 * do fixture `request`, que compartilha o cookie com o navegador.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3123";
const EMAIL = "e2e@ontarget.local";
const PASSWORD = "senha-e2e-bem-longa";
// O Playwright carrega o `globalSetup` com o próprio transpiler (sem
// `import.meta.dir` do Bun), então o caminho sai do diretório de trabalho.
const STATE_PATH = path.resolve(process.cwd(), "e2e/.auth/user.json");

async function waitForHealth(context: APIRequestContext): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await context.get("/api/health");
      if (res.ok()) return;
    } catch {
      // servidor ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`servidor não respondeu em ${BASE_URL}/api/health`);
}

export default async function globalSetup(): Promise<void> {
  const context = await request.newContext({ baseURL: BASE_URL });

  try {
    await waitForHealth(context);

    const state = await context.get("/api/auth/state");
    const { needsSetup } = (await state.json()) as { needsSetup: boolean };

    if (needsSetup) {
      const created = await context.post("/api/auth/setup", {
        data: { email: EMAIL, name: "E2E", password: PASSWORD, confirmPassword: PASSWORD },
      });
      if (created.status() !== 201) {
        throw new Error(`primeiro acesso falhou: ${created.status()} ${await created.text()}`);
      }
    } else {
      const login = await context.post("/api/auth/login", {
        data: { email: EMAIL, password: PASSWORD },
      });
      if (login.status() !== 200) {
        throw new Error(
          `não consegui entrar com a conta do E2E em ${BASE_URL} — ` +
            `provavelmente há um servidor reaproveitado com outro banco. ` +
            `Pare o servidor em :3123 e rode o E2E de novo.`,
        );
      }
    }

    const storageState = await context.storageState();
    mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(storageState, null, 2));
    console.log(`[e2e] sessão gravada em ${STATE_PATH}`);
  } finally {
    await context.dispose();
  }
}
