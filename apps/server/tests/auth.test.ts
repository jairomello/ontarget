import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createApp } from "../src/app";
import { createDb, type Db } from "../src/db/index";
import { LOGIN_MAX_ATTEMPTS, resetLoginLimiter } from "../src/routes/auth";
import { SESSION_COOKIE } from "../src/services/sessions";
import { createAuthedApp } from "./helpers/auth";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "auth-"));
const db: Db = createDb(path.join(dir, "auth.db"));
const app = createApp({ db });

const SETUP = { email: "dono@exemplo.org", name: "Dono", password: "senha-bem-longa" };

function request(pathName: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathName}`, init);
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function readBody(res: Response): Promise<any> {
  return res.json();
}

/** `set-cookie` pode vir como lista quando o happy-dom registra os globais. */
function setCookieOf(res: Response): string {
  const headers = res.headers as unknown as {
    get?: (name: string) => string | string[] | null;
    getSetCookie?: () => string[];
  };
  const single = headers.get?.("set-cookie");
  if (Array.isArray(single)) return single.join("; ");
  if (typeof single === "string") return single;
  const list = headers.getSetCookie?.();
  return Array.isArray(list) ? list.join("; ") : "";
}

beforeAll(() => {
  resetLoginLimiter();
});

afterAll(() => {
  resetLoginLimiter();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/auth/state", () => {
  it("informa que falta a conta inicial", async () => {
    const res = await app.fetch(request("/api/auth/state"));
    expect(res.status).toBe(200);
    expect(await readBody(res)).toEqual({ needsSetup: true });
  });
});

describe("POST /api/auth/setup", () => {
  it("recusa senha com confirmação divergente", async () => {
    const res = await app.fetch(request("/api/auth/setup", json("POST", {
      email: "outra@exemplo.org",
      name: "Outra",
      password: "senha-bem-longa",
      confirmPassword: "senha-diferente",
    })));
    expect(res.status).toBe(400);
    expect((await readBody(res)).error.message).toMatch(/confirmação/);
  });

  it("cria a conta inicial e devolve sessão", async () => {
    const res = await app.fetch(request("/api/auth/setup", json("POST", {
      ...SETUP,
      confirmPassword: SETUP.password,
    })));

    expect(res.status).toBe(201);
    const body = await readBody(res);
    expect(body.user.email).toBe(SETUP.email);
    expect(body.user.name).toBe("Dono");
    expect(body.user.passwordHash).toBeUndefined();
    expect(setCookieOf(res)).toContain(`${SESSION_COOKIE}=`);
    expect(setCookieOf(res)).toContain("HttpOnly");
  });

  it("fecha o cadastro depois do primeiro usuário (409)", async () => {
    const res = await app.fetch(request("/api/auth/setup", json("POST", {
      email: "segunda@exemplo.org",
      name: "Segunda",
      password: "senha-bem-longa",
      confirmPassword: "senha-bem-longa",
    })));
    expect(res.status).toBe(409);
    expect((await readBody(res)).error.code).toBe("setup_completed");
  });

  it("o estado passa a indicar conta criada", async () => {
    const res = await app.fetch(request("/api/auth/state"));
    expect(await readBody(res)).toEqual({ needsSetup: false });
  });
});

describe("POST /api/auth/login", () => {
  it("autentica com e-mail e senha e devolve o cookie", async () => {
    const res = await app.fetch(request("/api/auth/login", json("POST", {
      email: "  Dono@Exemplo.ORG ",
      password: SETUP.password,
    })));
    expect(res.status).toBe(200);
    expect((await readBody(res)).user.email).toBe(SETUP.email);
    expect(setCookieOf(res)).toContain(`${SESSION_COOKIE}=`);
  });

  it("responde 401 com a mesma mensagem para senha errada e e-mail inexistente", async () => {
    const wrongPassword = await app.fetch(request("/api/auth/login", json("POST", {
      email: SETUP.email,
      password: "senha-completamente-errada",
    })));
    const unknownEmail = await app.fetch(request("/api/auth/login", json("POST", {
      email: "ninguem@exemplo.org",
      password: SETUP.password,
    })));

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await readBody(wrongPassword)).toEqual(await readBody(unknownEmail));
  });
});

describe("limite de tentativas de login", () => {
  it("bloqueia após o número máximo de falhas com 429", async () => {
    resetLoginLimiter();

    for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS; attempt += 1) {
      const res = await app.fetch(request("/api/auth/login", json("POST", {
        email: SETUP.email,
        password: "senha-sempre-errada",
      })));
      expect(res.status).toBe(401);
    }

    const blocked = await app.fetch(request("/api/auth/login", json("POST", {
      email: SETUP.email,
      password: SETUP.password,
    })));
    expect(blocked.status).toBe(429);
    const body = await readBody(blocked);
    expect(body.error.code).toBe("too_many_attempts");
    expect(body.error.retryAfterMs).toBeGreaterThan(0);

    resetLoginLimiter();
  });

  it("acerto limpa as falhas acumuladas", async () => {
    resetLoginLimiter();
    for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS - 1; attempt += 1) {
      await app.fetch(request("/api/auth/login", json("POST", {
        email: SETUP.email,
        password: "senha-sempre-errada",
      })));
    }

    const ok = await app.fetch(request("/api/auth/login", json("POST", {
      email: SETUP.email,
      password: SETUP.password,
    })));
    expect(ok.status).toBe(200);

    // As falhas anteriores foram apagadas: a próxima errada responde 401.
    const after = await app.fetch(request("/api/auth/login", json("POST", {
      email: SETUP.email,
      password: "senha-sempre-errada",
    })));
    expect(after.status).toBe(401);
    resetLoginLimiter();
  });
});

describe("sessão e proteção das rotas", () => {
  it("GET /api/auth/me devolve 401 sem sessão e 200 com sessão", async () => {
    const withoutSession = await app.fetch(request("/api/auth/me"));
    expect(withoutSession.status).toBe(401);

    const authed = await createAuthedApp(createDb(path.join(dir, "me.db")));
    const withSession = await authed.fetch(request("/api/auth/me"));
    expect(withSession.status).toBe(200);
    expect((await readBody(withSession)).user.email).toBe(authed.session.user.email);
  });

  it("/api/projects exige sessão: 401 sem cookie e 200 com cookie", async () => {
    const withoutSession = await app.fetch(request("/api/projects"));
    expect(withoutSession.status).toBe(401);
    expect((await readBody(withoutSession)).error.code).toBe("unauthorized");

    const authed = await createAuthedApp(createDb(path.join(dir, "projects.db")));
    const withSession = await authed.fetch(request("/api/projects"));
    expect(withSession.status).toBe(200);
  });

  it("logout revoga a sessão no servidor", async () => {
    const authed = await createAuthedApp(createDb(path.join(dir, "logout.db")));

    expect((await authed.fetch(request("/api/auth/me"))).status).toBe(200);

    const logout = await authed.fetch(request("/api/auth/logout", json("POST", {})));
    expect(logout.status).toBe(200);

    // O cookie continua no cliente, mas o servidor já não o aceita.
    expect((await authed.fetch(request("/api/auth/me"))).status).toBe(401);
    expect((await authed.fetch(request("/api/projects"))).status).toBe(401);
  });

  it("cookie de sessão desconhecido é recusado", async () => {
    const res = await app.fetch(
      request("/api/projects", {
        headers: { cookie: `${SESSION_COOKIE}=${"x".repeat(43)}` },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("Content-Type nas rotas de escrita", () => {
  it("recusa escrita sem application/json com 415", async () => {
    const authed = await createAuthedApp(createDb(path.join(dir, "ctype.db")));
    const res = await authed.fetch(
      request("/api/projects", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "nome=Projeto",
      }),
    );
    expect(res.status).toBe(415);
    expect((await readBody(res)).error.code).toBe("unsupported_media_type");
  });

  it("aceita application/json normalmente", async () => {
    const authed = await createAuthedApp(createDb(path.join(dir, "ctype2.db")));
    const res = await authed.fetch(
      request("/api/projects", json("POST", { name: "Com JSON" })),
    );
    expect(res.status).toBe(201);
  });
});
