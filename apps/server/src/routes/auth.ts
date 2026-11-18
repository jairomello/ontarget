import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/index";
import type { AuthEnv } from "../middleware/auth";
import {
  AccountsError,
  countUsers,
  createUser,
  getUserByEmail,
  normalizeEmail,
  verifyPassword,
} from "../services/accounts";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  issueSession,
  resolveSession,
  revokeSessionByToken,
} from "../services/sessions";

/**
 * Autenticação local (specs/user-auth): primeiro acesso, entrada, saída e
 * consulta de sessão.
 */

/** Falhas antes do bloqueio e janela de recuperação (specs/user-auth). */
export const LOGIN_MAX_ATTEMPTS = 8;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface FailureWindow {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

/**
 * Limite de tentativas em memória: a instalação local roda em processo único,
 * então um reinício zera o contador (design.md — Trade-offs).
 */
const failures = new Map<string, FailureWindow>();

export function resetLoginLimiter(): void {
  failures.clear();
}

function bucketKey(parts: string[]): string {
  return parts.join("|");
}

/** Retorna `null` se pode tentar; senão, quantos ms faltam para liberar. */
function blockedFor(keys: string[], now: number): number | null {
  for (const key of keys) {
    const window = failures.get(key);
    if (!window) continue;
    if (window.blockedUntil > now) return window.blockedUntil - now;
    if (now - window.firstAt > LOGIN_WINDOW_MS) failures.delete(key);
  }
  return null;
}

function registerFailure(keys: string[], now: number): void {
  for (const key of keys) {
    const window = failures.get(key);
    if (!window || now - window.firstAt > LOGIN_WINDOW_MS) {
      failures.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
      continue;
    }
    window.count += 1;
    if (window.count >= LOGIN_MAX_ATTEMPTS) window.blockedUntil = now + LOGIN_WINDOW_MS;
  }
}

function clearFailures(keys: string[]): void {
  for (const key of keys) failures.delete(key);
}

/** Forma pública da conta: nunca hash, nunca caminho de arquivo. */
function publicUser(user: import("../db/schema").User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    hasAvatar: user.avatarPath !== null,
    theme: user.theme,
    density: user.density,
    palette: user.palette,
  };
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

function badRequest(message: string) {
  return { error: { code: "invalid_body", message } } as const;
}

function unauthorized(message = "E-mail ou senha incorretos") {
  return { error: { code: "unauthorized", message } } as const;
}

export function authRoutes(getDb: () => Db) {
  const app = new Hono<AuthEnv>();

  /** Origem da tentativa (para o limite por origem), sem depender de proxy. */
  const originOf = (c: Context<AuthEnv>): string =>
    c.req.raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.raw.headers.get("remote-addr") ||
    "local";

  const startSession = (c: Context<AuthEnv>, userId: string) => {
    const { token } = issueSession(getDb(), userId);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure: c.req.url.startsWith("https://"),
    });
  };

  /** Estado público usado pelo cliente para escolher login ou primeiro acesso. */
  app.get("/state", (c) => c.json({ needsSetup: countUsers(getDb()) === 0 }));

  /**
   * Primeiro acesso: cria a conta inicial e já abre sessão. Depois do
   * primeiro usuário o cadastro público fecha (409).
   */
  app.post("/setup", async (c) => {
    if (countUsers(getDb()) > 0) {
      return c.json(
        { error: { code: "setup_completed", message: "Conta inicial já criada" } },
        409,
      );
    }

    const body = (await c.req.json().catch(() => null)) as {
      email?: unknown;
      name?: unknown;
      password?: unknown;
      confirmPassword?: unknown;
    } | null;
    if (!body) return c.json(badRequest("Informe os dados da conta"), 400);

    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const name = typeof body.name === "string" ? body.name : "";
    const password = typeof body.password === "string" ? body.password : "";
    const confirm = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (email === "" || !email.includes("@")) return c.json(badRequest("E-mail inválido"), 400);
    if (password !== confirm) {
      return c.json(badRequest("A confirmação não confere com a senha"), 400);
    }

    try {
      const user = await createUser(getDb(), { email, name, password });
      startSession(c, user.id);
      return c.json({ user: publicUser(user) }, 201);
    } catch (error) {
      if (error instanceof AccountsError) {
        const code = error.code === "password_too_short" ? "password_too_short" : "invalid_body";
        return c.json({ error: { code, message: error.message } }, 400);
      }
      throw error;
    }
  });

  /** Entrada com e-mail e senha; mensagem genérica para qualquer falha. */
  app.post("/login", async (c) => {
    const body = (await c.req.json().catch(() => null)) as LoginBody | null;
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body?.password === "string" ? body.password : "";

    const keys = [`email:${email}`, `origin:${originOf(c)}`];
    const now = Date.now();
    const wait = blockedFor(keys, now);
    if (wait !== null) {
      return c.json(
        { error: { code: "too_many_attempts", message: "Tente novamente mais tarde", retryAfterMs: wait } },
        429,
      );
    }

    const user = email === "" ? undefined : getUserByEmail(getDb(), email);
    const valid = Boolean(user) && (await verifyPassword(password, user!.passwordHash));

    if (!user || !valid) {
      registerFailure(keys, now);
      return c.json(unauthorized(), 401);
    }

    clearFailures(keys);
    startSession(c, user.id);
    return c.json({ user: publicUser(user) });
  });

  /** Sai: revoga a sessão no servidor e limpa o cookie. */
  app.post("/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE) ?? "";
    revokeSessionByToken(getDb(), token);
    setCookie(c, SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      secure: c.req.url.startsWith("https://"),
    });
    return c.json({ ok: true });
  });

  /**
   * Consulta a sessão corrente. Mantida fora do middleware: sem sessão válida
   * ela devolve 401, que é exatamente o que o cliente usa para decidir entre
   * `/login` e `/primeiro-acesso`.
   */
  app.get("/me", (c) => {
    const token = getCookie(c, SESSION_COOKIE) ?? "";
    const resolved = token ? resolveSession(getDb(), token) : null;
    if (!resolved) return c.json(unauthorized("Sessão inválida ou expirada"), 401);
    return c.json({ user: publicUser(resolved.user) });
  });

  return app;
}
