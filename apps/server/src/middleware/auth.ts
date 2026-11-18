import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Db } from "../db/index";
import type * as t from "../db/schema";
import { SESSION_COOKIE, resolveSession } from "../services/sessions";

/** Estado que o middleware anexa a cada requisição autenticada. */
export interface AuthState {
  user: t.User;
  session: t.Session;
}

/** Env tipado das rotas protegidas: `c.var.auth` existe depois do middleware. */
export type AuthEnv = { Variables: { auth: AuthState } };

/** Rotas públicas mesmo sem sessão (specs/user-auth — "Proteção das rotas"). */
const PUBLIC_PATHS = ["/api/health", "/api/auth", "/api/auth/"];

export function getAuth(c: Context<AuthEnv>): AuthState {
  return c.get("auth");
}

/**
 * Protege `/api/*` (specs/user-auth — "Proteção das rotas de API").
 *
 * Sem cookie, com cookie desconhecido ou sessão expirada, responde 401 no
 * formato de erro da API. Saúde e autenticação ficam livres por lista.
 */
export function authMiddleware(options: { getDb: () => Db }) {
  const { getDb } = options;

  return async (c: Context<AuthEnv>, next: Next): Promise<void | Response> => {
    const path = new URL(c.req.url).pathname;
    if (PUBLIC_PATHS.some((publicPath) => path === publicPath || path.startsWith(publicPath + "/"))) {
      await next();
      return;
    }

    const token = getCookie(c, SESSION_COOKIE) ?? "";
    const resolved = resolveSession(getDb(), token);

    if (!resolved) {
      return c.json({ error: { code: "unauthorized", message: "Sessão inválida ou expirada" } }, 401);
    }

    c.set("auth", { user: resolved.user, session: resolved.session });
    await next();
  };
}
