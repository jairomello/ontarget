import { Hono, type Context } from "hono";
import type { Db } from "../db/index";
import type { AuthEnv } from "../middleware/auth";
import {
  ApiKeyError,
  issueApiKey,
  listApiKeys,
  revokeApiKey,
} from "../services/apiKeys";

/**
 * Chaves de API para agentes (specs/api-keys): listar, gerar e revogar.
 * O valor completo só aparece na resposta de criação.
 */

function publicKey(row: import("../db/schema").ApiKeyRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export function apiKeysRoutes(getDb: () => Db) {
  const app = new Hono<AuthEnv>();
  const authed = (c: Context<AuthEnv>) => c.get("auth");

  /** Lista as chaves ativas do usuário, sem valor nem hash. */
  app.get("/", (c) => {
    const { user } = authed(c);
    const keys = listApiKeys(getDb(), user.id).filter((row) => row.revokedAt === null);
    return c.json({ keys: keys.map(publicKey) });
  });

  /** Gera uma nova chave; o valor completo é devolvido só aqui. */
  app.post("/", async (c) => {
    const { user } = authed(c);
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    if (!body || typeof body.name !== "string") {
      return c.json({ error: { code: "invalid_body", message: "Informe o nome da chave" } }, 400);
    }

    try {
      const { row, key } = issueApiKey(getDb(), user.id, body.name);
      return c.json({ key: publicKey(row), value: key }, 201);
    } catch (error) {
      if (error instanceof ApiKeyError) {
        return c.json({ error: { code: error.code, message: error.message } }, 400);
      }
      throw error;
    }
  });

  /** Revoga a chave; chave de outra conta responde 404 (anti-IDOR). */
  app.delete("/:id", (c) => {
    const { user } = authed(c);
    const id = c.req.param("id");
    try {
      const row = revokeApiKey(getDb(), user.id, id);
      return c.json({ key: { ...publicKey(row), revokedAt: row.revokedAt } });
    } catch (error) {
      if (error instanceof ApiKeyError) {
        if (error.code === "already_revoked") {
          return c.json({ error: { code: error.code, message: error.message } }, 409);
        }
        return c.json({ error: { code: "not_found", message: "Chave não encontrada" } }, 404);
      }
      throw error;
    }
  });

  return app;
}
