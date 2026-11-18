import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { newId } from "@ontarget/shared";
import type { Db } from "../db/index";
import * as t from "../db/schema";

/**
 * Sessão opaca por cookie (specs/user-auth — "Sessão por cookie").
 *
 * O cookie carrega o token em claro; o banco guarda só o SHA-256, de modo que
 * revogação é uma linha no banco e uma leitura de token não devolve nada.
 */

export const SESSION_COOKIE = "ontarget_session";

/** Validade padrão de 30 dias. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Renovação deslizante no máximo uma vez por dia (design.md). */
export const SESSION_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface IssuedSession {
  token: string;
  session: t.Session;
}

/** Emite uma sessão nova para o usuário. */
export function issueSession(
  db: Db,
  userId: string,
  now: number = Date.now(),
): IssuedSession {
  const token = createToken();
  const session: t.Session = {
    id: newId(),
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
  };
  db.insert(t.sessions).values(session).run();
  return { token, session };
}

export interface ResolvedSession {
  session: t.Session;
  user: t.User;
}

/**
 * Resolve o token para usuário. Devolve `null` para token ausente,
 * desconhecido ou expirado — o chamador nunca distingue os casos.
 * Estende o prazo no máximo uma vez por dia (renovação deslizante).
 */
export function resolveSession(
  db: Db,
  token: string,
  now: number = Date.now(),
): ResolvedSession | null {
  if (!token) return null;

  const row = db
    .select()
    .from(t.sessions)
    .where(eq(t.sessions.tokenHash, hashToken(token)))
    .get();
  if (!row) return null;

  if (row.expiresAt <= now) {
    db.delete(t.sessions).where(eq(t.sessions.id, row.id)).run();
    return null;
  }

  const user = getUserById(db, row.userId);
  if (!user) return null;

  let session = row;
  if (now - row.lastSeenAt >= SESSION_RENEW_INTERVAL_MS) {
    session = db
      .update(t.sessions)
      .set({ lastSeenAt: now, expiresAt: now + SESSION_TTL_MS })
      .where(eq(t.sessions.id, row.id))
      .returning()
      .get();
  }

  return { session, user };
}

function getUserById(db: Db, id: string): t.User | undefined {
  return db.select().from(t.users).where(eq(t.users.id, id)).get();
}

/** Revoga uma sessão pelo token (logout). Retorna se alguma linha mudou. */
export function revokeSessionByToken(db: Db, token: string): boolean {
  if (!token) return false;
  const hash = hashToken(token);
  const row = db.select().from(t.sessions).where(eq(t.sessions.tokenHash, hash)).get();
  if (!row) return false;
  db.delete(t.sessions).where(eq(t.sessions.tokenHash, hash)).run();
  return true;
}

/** Revoga todas as sessões do usuário, exceto a atual (troca de senha). */
export function revokeOtherSessions(db: Db, userId: string, keepSessionId?: string): void {
  const rows = db.select().from(t.sessions).where(eq(t.sessions.userId, userId)).all();
  for (const row of rows) {
    if (keepSessionId && row.id === keepSessionId) continue;
    db.delete(t.sessions).where(eq(t.sessions.id, row.id)).run();
  }
}
