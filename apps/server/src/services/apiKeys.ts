import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { newId } from "@ontarget/shared";
import type { Db } from "../db/index";
import * as t from "../db/schema";

/**
 * Chaves de API para agentes (specs/api-keys).
 *
 * O valor completo existe só na resposta de criação: o banco guarda o SHA-256
 * (chave já tem 256 bits de entropia, então hash rápido é suficiente —
 * design.md).
 */

export const API_KEY_PREFIX = "ont_";
export const MIN_KEY_NAME_LENGTH = 1;
export const MAX_KEY_NAME_LENGTH = 100;

export class ApiKeyError extends Error {
  constructor(
    readonly code: "invalid_name" | "not_found" | "already_revoked",
    message: string,
  ) {
    super(message);
    this.name = "ApiKeyError";
  }
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Valor bruto: `ont_` + 32 bytes aleatórios em base64url. */
export function createApiKeyValue(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isValidKeyName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= MIN_KEY_NAME_LENGTH && trimmed.length <= MAX_KEY_NAME_LENGTH;
}

/** Cria a chave e devolve a linha junto com o valor bruto (exibido uma vez). */
export function issueApiKey(
  db: Db,
  userId: string,
  name: string,
  now: number = Date.now(),
): { row: t.ApiKeyRow; key: string } {
  const trimmed = name.trim();
  if (!isValidKeyName(trimmed)) {
    throw new ApiKeyError("invalid_name", "Nome deve ter de 1 a 100 caracteres");
  }
  const key = createApiKeyValue();
  const row: t.ApiKeyRow = {
    id: newId(),
    userId,
    name: trimmed,
    keyHash: hashApiKey(key),
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
  };
  db.insert(t.apiKeys).values(row).run();
  return { row, key };
}

/** Lista as chaves do usuário, nunca com valor nem hash. */
export function listApiKeys(db: Db, userId: string): t.ApiKeyRow[] {
  return db.select().from(t.apiKeys).where(eq(t.apiKeys.userId, userId)).all();
}

/**
 * Revoga a chave do usuário dono. `userId` acompanha a chamada de propósito:
 * revogar a chave de outra conta é `not_found` (anti-IDOR, specs/api-keys).
 */
export function revokeApiKey(db: Db, userId: string, id: string, now = Date.now()): t.ApiKeyRow {
  const row = db
    .select()
    .from(t.apiKeys)
    .where(and(eq(t.apiKeys.id, id), eq(t.apiKeys.userId, userId)))
    .get();
  if (!row) throw new ApiKeyError("not_found", "Chave não encontrada");
  if (row.revokedAt !== null) throw new ApiKeyError("already_revoked", "Chave já revogada");

  return db
    .update(t.apiKeys)
    .set({ revokedAt: now })
    .where(eq(t.apiKeys.id, row.id))
    .returning()
    .get();
}

export interface VerifiedApiKey {
  row: t.ApiKeyRow;
  user: t.User;
}

/**
 * Verifica uma chave apresentada (specs/api-keys — "Verificação de chave").
 *
 * Revogada e desconhecida são indistinguíveis: os dois casos devolvem `null`
 * e não revelam o dono. Valida atualiza `last_used_at`.
 */
export function verifyApiKey(db: Db, raw: string, now = Date.now()): VerifiedApiKey | null {
  if (!raw.startsWith(API_KEY_PREFIX)) return null;

  const row = db
    .select()
    .from(t.apiKeys)
    .where(and(eq(t.apiKeys.keyHash, hashApiKey(raw)), isNull(t.apiKeys.revokedAt)))
    .get();
  if (!row) return null;

  const user = db.select().from(t.users).where(eq(t.users.id, row.userId)).get();
  if (!user) return null;

  const updated = db
    .update(t.apiKeys)
    .set({ lastUsedAt: now })
    .where(eq(t.apiKeys.id, row.id))
    .returning()
    .get();

  return { row: updated, user };
}
