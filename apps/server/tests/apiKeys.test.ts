import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../src/db/index";
import { createApp } from "../src/app";
import * as schema from "../src/db/schema";
import { createAuthedApp } from "./helpers/auth";
import { createUser } from "../src/services/accounts";
import {
  ApiKeyError,
  createApiKeyValue,
  hashApiKey,
  issueApiKey,
  listApiKeys,
  revokeApiKey,
  verifyApiKey,
} from "../src/services/apiKeys";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "apikeys-"));
const db: Db = createDb(path.join(dir, "apikeys.db"));
let owner: string;
let other: string;

beforeAll(async () => {
  owner = (
    await createUser(db, {
      email: "dono@exemplo.org",
      name: "Dono",
      password: "senha-bem-longa",
    })
  ).id;
  other = (
    await createUser(db, {
      email: "outra@exemplo.org",
      name: "Outra",
      password: "senha-bem-longa",
    })
  ).id;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const app = createApp({ db });
const authed = await createAuthedApp(db, { email: "http-chaves@exemplo.org", name: "HTTP" });

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

describe("criação de chave", () => {
  it("gera valor com prefixo ont_ e 32 bytes de entropia", () => {
    const key = createApiKeyValue();
    expect(key.startsWith("ont_")).toBe(true);
    expect(key.length).toBeGreaterThan(4 + 40);
    expect(key).toMatch(/^ont_[A-Za-z0-9_-]+$/);
  });

  it("chaves distintas têm valores distintos", () => {
    expect(createApiKeyValue()).not.toBe(createApiKeyValue());
  });

  it("guarda apenas o hash e devolve o valor uma vez", () => {
    const { row, key } = issueApiKey(db, owner, "Agente de teste");
    const stored = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, row.id)).get();

    expect(stored?.keyHash).toBe(hashApiKey(key));
    expect(stored?.keyHash).not.toBe(key);
    expect(row.name).toBe("Agente de teste");
  });

  it("recusa nome vazio ou longo demais", () => {
    expect(() => issueApiKey(db, owner, "   ")).toThrow(ApiKeyError);
    expect(() => issueApiKey(db, owner, "a".repeat(101))).toThrow(ApiKeyError);
    expect(() => issueApiKey(db, owner, "a".repeat(100))).not.toThrow();
  });
});

describe("listagem", () => {
  it("lista só as chaves do usuário, sem valor nem hash", () => {
    const rows = listApiKeys(db, owner);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("key");
      expect(row.keyHash).toBeTruthy();
    }
    expect(listApiKeys(db, other)).toHaveLength(0);
  });
});

describe("revogação", () => {
  it("chave revogada não verifica mais", () => {
    const { row, key } = issueApiKey(db, owner, "Para revogar");
    expect(verifyApiKey(db, key)).not.toBeNull();

    revokeApiKey(db, owner, row.id);
    expect(verifyApiKey(db, key)).toBeNull();
  });

  it("revogar a chave de outro usuário responde not_found", () => {
    const { row } = issueApiKey(db, owner, "Protegida");
    try {
      revokeApiKey(db, other, row.id);
      throw new Error("não deveria revogar");
    } catch (error) {
      expect((error as ApiKeyError).code).toBe("not_found");
    }
    const stillActive = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, row.id)).get();
    expect(stillActive?.revokedAt).toBeNull();
  });

  it("revogada e desconhecida são indistinguíveis (null nos dois casos)", () => {
    const { row, key } = issueApiKey(db, owner, "Indistinguível");
    revokeApiKey(db, owner, row.id);
    expect(verifyApiKey(db, key)).toBeNull();
    expect(verifyApiKey(db, "ont_desconhecida")).toBeNull();
    expect(verifyApiKey(db, "sem-prefixo")).toBeNull();
  });
});

describe("verifyApiKey", () => {
  it("devolve o dono e registra o último uso", () => {
    const { key, row } = issueApiKey(db, owner, "Em uso");
    expect(row.lastUsedAt).toBeNull();

    const now = Date.now();
    const verified = verifyApiKey(db, key, now);
    expect(verified?.user.id).toBe(owner);
    expect(verified?.row.lastUsedAt).toBe(now);

    // Cada verificação atualiza de novo o último uso.
    verifyApiKey(db, key, now + 5_000);
    const stored = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, row.id)).get();
    expect(stored?.lastUsedAt).toBe(now + 5_000);
  });
});

describe("rotas HTTP de chaves (specs/api-keys)", () => {
  it("exige sessão", async () => {
    const res = await app.fetch(request("/api/api-keys"));
    expect(res.status).toBe(401);
  });

  it("gera a chave exibindo o valor uma única vez", async () => {
    const created = await authed.fetch(
      request("/api/api-keys", json("POST", { name: "Agente HTTP" })),
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.value).toMatch(/^ont_/);
    expect(body.key.name).toBe("Agente HTTP");
    expect(body.key.id).toBeTruthy();

    const listed = await authed.fetch(request("/api/api-keys"));
    const keys = (await listed.json()).keys as Array<Record<string, unknown>>;
    const found = keys.find((key) => key.id === body.key.id);
    expect(found).toBeTruthy();
    expect(JSON.stringify(found)).not.toContain(body.value);
    expect(JSON.stringify(found)).not.toContain("keyHash");
  });

  it("recusa nome ausente ou longo demais", async () => {
    const missing = await authed.fetch(request("/api/api-keys", json("POST", {})));
    expect(missing.status).toBe(400);

    const long = await authed.fetch(
      request("/api/api-keys", json("POST", { name: "a".repeat(101) })),
    );
    expect(long.status).toBe(400);
  });

  it("revoga com confirmação e some da lista", async () => {
    const created = await authed.fetch(
      request("/api/api-keys", json("POST", { name: "Para revogar via HTTP" })),
    );
    const { key } = await created.json();

    const again = await authed.fetch(
      request(`/api/api-keys/${key.id}`, { method: "DELETE" }),
    );
    expect(again.status).toBe(200);

    const listed = await authed.fetch(request("/api/api-keys"));
    const keys = (await listed.json()).keys as Array<{ id: string }>;
    expect(keys.some((row) => row.id === key.id)).toBe(false);

    const twice = await authed.fetch(
      request(`/api/api-keys/${key.id}`, { method: "DELETE" }),
    );
    expect(twice.status).toBe(409);
  });

  it("revogar chave de outra conta responde 404 (anti-IDOR)", async () => {
    const mine = await authed.fetch(
      request("/api/api-keys", json("POST", { name: "Minha chave" })),
    );
    const { key } = await mine.json();

    const { fetch: otherFetch } = await createAuthedApp(db, {
      email: "outra-conta@exemplo.org",
      name: "Outra Conta",
    });
    const stolen = await otherFetch(
      request(`/api/api-keys/${key.id}`, { method: "DELETE" }),
    );
    expect(stolen.status).toBe(404);

    const stored = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id)).get();
    expect(stored?.revokedAt).toBeNull();
  });
});
