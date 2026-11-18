import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { newId } from "@ontarget/shared";
import { REPO_ROOT, type Db } from "../db/index";
import * as t from "../db/schema";

/**
 * Contas locais (specs/user-auth).
 *
 * A senha é guardada como hash Argon2id (padrão do `Bun.password`); o e-mail
 * é normalizado em minúsculas antes de qualquer uso, porque o índice único é
 * a única guarda contra duplicidade (specs/user-auth — "Entrada com e-mail e
 * senha").
 */

/** Mínimo da política de senha (specs/user-auth — "Política de senha"). */
export const MIN_PASSWORD_LENGTH = 10;

/** Nome de exibição: 1..200 caracteres após recortar espaços (specs/user-profile). */
export const MIN_NAME_LENGTH = 1;
export const MAX_NAME_LENGTH = 200;

export class AccountsError extends Error {
  constructor(
    readonly code: "email_taken" | "password_too_short" | "invalid_name" | "user_not_found",
    message: string,
  ) {
    super(message);
    this.name = "AccountsError";
  }
}

/** Trim + minúsculas: a forma canônica gravada no banco. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Política de senha: comprimento mínimo. Recusa vazias e só com espaços. */
export function isPasswordAcceptable(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/** Nome recortado, validado na faixa 1..200. */
export function normalizeName(raw: string): string {
  return raw.trim();
}

export function assertName(raw: string): string {
  const name = normalizeName(raw);
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    throw new AccountsError("invalid_name", "Nome deve ter de 1 a 200 caracteres");
  }
  return name;
}

export async function hashPassword(password: string): Promise<string> {
  if (!isPasswordAcceptable(password)) {
    throw new AccountsError(
      "password_too_short",
      `Senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres`,
    );
  }
  return Bun.password.hash(password);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export function countUsers(db: Db): number {
  const row = db
    .select({ value: t.users.id })
    .from(t.users)
    .limit(1)
    .all();
  return row.length;
}

export function getUserById(db: Db, id: string): t.User | undefined {
  return db.select().from(t.users).where(eq(t.users.id, id)).get();
}

export function getUserByEmail(db: Db, email: string): t.User | undefined {
  return db
    .select()
    .from(t.users)
    .where(eq(t.users.email, normalizeEmail(email)))
    .get();
}

/** Cria a conta; e-mail duplicado vira `AccountsError` (índice único). */
export async function createUser(
  db: Db,
  input: { email: string; name: string; password: string },
): Promise<t.User> {
  const email = normalizeEmail(input.email);
  if (email === "") throw new AccountsError("invalid_name", "Informe um e-mail");
  const name = assertName(input.name);
  const passwordHash = await hashPassword(input.password);
  const now = Date.now();

  if (getUserByEmail(db, email)) {
    throw new AccountsError("email_taken", "E-mail já cadastrado");
  }

  const inserted = db
    .insert(t.users)
    .values({ id: newId(), email, name, passwordHash, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return inserted;
}

export function updateUserProfile(db: Db, id: string, name: string): t.User | undefined {
  const trimmed = assertName(name);
  return db
    .update(t.users)
    .set({ name: trimmed, updatedAt: Date.now() })
    .where(eq(t.users.id, id))
    .returning()
    .get();
}

export function updateUserPassword(db: Db, id: string, passwordHash: string): void {
  db.update(t.users)
    .set({ passwordHash, updatedAt: Date.now() })
    .where(eq(t.users.id, id))
    .run();
}

export interface AppearancePatch {
  theme?: string;
  density?: string;
  palette?: string;
}

export function updateUserPreferences(db: Db, id: string, patch: AppearancePatch): t.User | undefined {
  const allowed: Partial<Pick<t.User, "theme" | "density" | "palette">> = {};
  if (patch.theme !== undefined) allowed.theme = patch.theme;
  if (patch.density !== undefined) allowed.density = patch.density;
  if (patch.palette !== undefined) allowed.palette = patch.palette;
  if (Object.keys(allowed).length === 0) return getUserById(db, id);

  return db
    .update(t.users)
    .set({ ...allowed, updatedAt: Date.now() })
    .where(eq(t.users.id, id))
    .returning()
    .get();
}

export function setAvatarPath(db: Db, id: string, avatarPath: string | null): void {
  db.update(t.users)
    .set({ avatarPath, updatedAt: Date.now() })
    .where(eq(t.users.id, id))
    .run();
}

/**
 * Exclui a conta; as sessões e chaves caem em cascata (migração 0005) e a
 * foto de perfil sai do disco junto (specs/user-profile — "Foto com recorte").
 */
export function deleteUser(db: Db, id: string): void {
  const user = getUserById(db, id);
  if (user?.avatarPath) {
    const file = path.join(REPO_ROOT, user.avatarPath);
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch {
        // disco ocupado por outro processo: a conta sai mesmo assim
      }
    }
  }
  db.delete(t.users).where(eq(t.users.id, id)).run();
}
