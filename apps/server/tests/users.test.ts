import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createApp } from "../src/app";
import { createDb, type Db } from "../src/db/index";
import { SESSION_COOKIE, issueSession } from "../src/services/sessions";
import { deleteUser, getUserById } from "../src/services/accounts";
import { createAuthedApp } from "./helpers/auth";
import { MAX_AVATAR_BYTES } from "../src/routes/users";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "users-"));
const db: Db = createDb(path.join(dir, "users.db"));
const avatarsDir = path.join(dir, "avatars");

const app = createApp({ db });
const authed = await createAuthedApp(db, {
  email: "perfil@exemplo.org",
  name: "Perfil",
  avatarsDir,
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

/** PNG 1×1 válido (assinatura + IEND). */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function avatarRequest(fetch: TestFetch, bytes: Uint8Array<ArrayBuffer>): Promise<Response> {
  const form = new FormData();
  form.append("avatar", new Blob([bytes], { type: "image/png" }), "foto.png");
  return fetch(request("/api/users/me/avatar", { method: "PUT", body: form }));
}

describe("PATCH /api/users/me", () => {
  it("altera o nome de exibição", async () => {
    const res = await authed.fetch(
      request("/api/users/me", json("PATCH", { name: "Jairo Mello" })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).toBe("Jairo Mello");
    expect(body.user.email).toBe("perfil@exemplo.org");
  });

  it("recusa nome vazio ou longo demais", async () => {
    const empty = await authed.fetch(
      request("/api/users/me", json("PATCH", { name: "   " })),
    );
    expect(empty.status).toBe(400);

    const long = await authed.fetch(
      request("/api/users/me", json("PATCH", { name: "a".repeat(201) })),
    );
    expect(long.status).toBe(400);
  });

  it("atualiza preferências de aparência", async () => {
    const res = await authed.fetch(
      request("/api/users/me", json("PATCH", { theme: "dark", palette: "emerald" })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.theme).toBe("dark");
    expect(body.user.palette).toBe("emerald");
    expect(body.user.density).toBe("comfortable");
  });

  it("recusa JSON malformado", async () => {
    const res = await authed.fetch(
      request("/api/users/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{ sem json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/users/me/password", () => {
  it("recusa a senha atual errada com 401", async () => {
    const res = await authed.fetch(
      request("/api/users/me/password", json("PATCH", {
        currentPassword: "senha-completamente-errada",
        newPassword: "outra-senha-bem-longa",
        confirmPassword: "outra-senha-bem-longa",
      })),
    );
    expect(res.status).toBe(401);
  });

  it("recusa confirmação divergente e senha curta", async () => {
    const mismatch = await authed.fetch(
      request("/api/users/me/password", json("PATCH", {
        currentPassword: "senha-bem-longa",
        newPassword: "outra-senha-bem-longa",
        confirmPassword: "senha-totalmente-diferente",
      })),
    );
    expect(mismatch.status).toBe(400);

    const short = await authed.fetch(
      request("/api/users/me/password", json("PATCH", {
        currentPassword: "senha-bem-longa",
        newPassword: "curta",
        confirmPassword: "curta",
      })),
    );
    expect(short.status).toBe(400);
    expect((await short.json()).error.code).toBe("password_too_short");
  });

  it("troca a senha, mantém a sessão atual e revoga as outras", async () => {
    // Segunda sessão da MESMA conta, aberta em outro "navegador".
    const second = issueSession(db, authed.session.user.id);
    const otherFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const other = input instanceof Request ? input : new Request(input, init);
      other.headers.set("cookie", `${SESSION_COOKIE}=${second.token}`);
      return app.fetch(other);
    };

    const res = await authed.fetch(
      request("/api/users/me/password", json("PATCH", {
        currentPassword: "senha-bem-longa",
        newPassword: "senha-nova-bem-longa",
        confirmPassword: "senha-nova-bem-longa",
      })),
    );
    expect(res.status).toBe(200);

    // Sessão atual continua viva.
    expect((await authed.fetch(request("/api/auth/me"))).status).toBe(200);

    // A outra sessão foi revogada.
    expect((await otherFetch(request("/api/auth/me"))).status).toBe(401);

    // Senha antiga deixa de entrar; a nova entra.
    const oldLogin = await app.fetch(
      request("/api/auth/login", json("POST", {
        email: "perfil@exemplo.org",
        password: "senha-bem-longa",
      })),
    );
    expect(oldLogin.status).toBe(401);

    const newLogin = await app.fetch(
      request("/api/auth/login", json("POST", {
        email: "perfil@exemplo.org",
        password: "senha-nova-bem-longa",
      })),
    );
    expect(newLogin.status).toBe(200);
  });
});

describe("foto de perfil", () => {
  it("aceita imagem válida, serve com ETag e apaga no DELETE", async () => {
    const upload = await avatarRequest(authed.fetch, PNG_BYTES);
    expect(upload.status).toBe(200);
    const uploaded = await upload.json();
    expect(uploaded.user.hasAvatar).toBe(true);

    const file = path.join(avatarsDir, `${authed.session.user.id}.png`);
    expect(existsSync(file)).toBe(true);

    const get = await authed.fetch(request("/api/users/me/avatar"));
    expect(get.status).toBe(200);
    const etag = get.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(new Uint8Array(await get.arrayBuffer()).byteLength).toBe(PNG_BYTES.byteLength);

    const cached = await authed.fetch(
      request("/api/users/me/avatar", { headers: { "if-none-match": etag! } }),
    );
    expect(cached.status).toBe(304);

    const removed = await authed.fetch(
      request("/api/users/me/avatar", { method: "DELETE" }),
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).user.hasAvatar).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect((await authed.fetch(request("/api/users/me/avatar"))).status).toBe(404);
  });

  it("recusa formato que não é imagem", async () => {
    const upload = await avatarRequest(authed.fetch, Buffer.from("não é imagem nenhuma"));
    expect(upload.status).toBe(415);
    expect((await upload.json()).error.code).toBe("invalid_image");
  });

  it("recusa arquivo acima do limite", async () => {
    const huge = new Uint8Array(MAX_AVATAR_BYTES + 1);
    huge.set([0x89, 0x50, 0x4e, 0x47], 0);
    const upload = await avatarRequest(authed.fetch, huge);
    expect(upload.status).toBe(413);
    expect((await upload.json()).error.code).toBe("avatar_too_large");
  });

  it("apagar a conta remove o arquivo da foto", async () => {
    const temp = await createAuthedApp(db, {
      email: "apaga-foto@exemplo.org",
      avatarsDir,
    });
    const upload = await avatarRequest(temp.fetch, PNG_BYTES);
    expect(upload.status).toBe(200);

    const file = path.join(avatarsDir, `${temp.session.user.id}.png`);
    expect(existsSync(file)).toBe(true);

    deleteUser(db, temp.session.user.id);
    expect(existsSync(file)).toBe(false);
    expect(getUserById(db, temp.session.user.id)).toBeUndefined();
  });

  it("sem sessão o avatar não é acessível", async () => {
    const res = await app.fetch(request("/api/users/me/avatar"));
    expect(res.status).toBe(401);
  });
});
