import { createApp } from "../../src/app";
import type { Db } from "../../src/db/index";
import type * as t from "../../src/db/schema";
import { AccountsError, createUser } from "../../src/services/accounts";
import { SESSION_COOKIE, issueSession } from "../../src/services/sessions";

/**
 * Sessão de teste para as suítes de contrato.
 *
 * A proteção das rotas não tem flag de desligamento (design.md): os testes
 * autenticam como qualquer cliente real.
 */

export interface TestSession {
  user: t.User;
  token: string;
  cookie: string;
}

let sequence = 0;

/** Cria (ou reaproveita) uma conta e devolve o cookie de sessão. */
export async function seedSession(
  db: Db,
  options: { email?: string; name?: string; password?: string } = {},
): Promise<TestSession> {
  const email = options.email ?? `teste-${Date.now()}-${sequence++}@example.org`;
  const password = options.password ?? "senha-bem-longa";

  let user: t.User;
  try {
    user = await createUser(db, { email, name: options.name ?? "Usuário Teste", password });
  } catch (error) {
    if (!(error instanceof AccountsError) || error.code !== "email_taken") throw error;
    throw new Error(`seedSession: e-mail já usado em outro teste — ${email}`);
  }

  const { token } = issueSession(db, user.id);
  return { user, token, cookie: `${SESSION_COOKIE}=${token}` };
}

export type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * `fetch` que injeta o cookie da sessão em toda requisição.
 *
 * O cookie é gravado direto no `Request` original: happy-dom (registrado
 * pelos testes do cliente) descarta `cookie` em `new Request(req, { headers })`,
 * porque trata o nome como header proibido.
 */
export function authedFetch(
  session: TestSession,
  app: { fetch: (r: Request) => Response | Promise<Response> },
): AuthedFetch {
  return (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    request.headers.set("cookie", session.cookie);
    return app.fetch(request) as Promise<Response>;
  };
}

export interface AuthedAppOptions {
  email?: string;
  name?: string;
  password?: string;
  avatarsDir?: string;
}

/**
 * App real + primeira sessão autenticada. `fetch` autentica; `app.fetch` fica
 * disponível para os casos que precisam provar 401 sem cookie.
 */
export async function createAuthedApp(db: Db, options: AuthedAppOptions = {}) {
  const app = createApp({ db, avatarsDir: options.avatarsDir });
  const session = await seedSession(db, options);
  return { app, session, fetch: authedFetch(session, app) };
}

/** Entrada pela API: cria a conta se preciso e devolve o cookie. */
export async function loginViaApi(
  app: { fetch: (r: Request) => Response | Promise<Response> },
  email: string,
  password: string,
): Promise<string> {
  const res = await app.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  if (res.status !== 200) throw new Error(`login falhou: ${res.status}`);
  const cookie = res.headers.get("set-cookie") ?? "";
  const pair = cookie.split(";")[0] ?? "";
  if (!pair.startsWith(`${SESSION_COOKIE}=`)) throw new Error("cookie de sessão ausente");
  return pair;
}
