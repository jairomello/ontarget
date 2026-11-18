import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { REPO_ROOT, type Db } from "../db/index";
import type { AuthEnv } from "../middleware/auth";
import {
  AccountsError,
  getUserById,
  hashPassword,
  setAvatarPath,
  updateUserPassword,
  updateUserPreferences,
  updateUserProfile,
  verifyPassword,
} from "../services/accounts";
import { revokeOtherSessions } from "../services/sessions";

/**
 * Conta do usuário autenticado (specs/user-profile): nome, preferências,
 * senha e foto. Todas as rotas usam o `auth` anexado pelo middleware.
 */

/** Limite do arquivo de foto (specs/user-profile — "Foto com recorte"). */
export const MAX_AVATAR_BYTES = 512 * 1024;

/** Diretório padrão das fotos; sobrescrevível nos testes. */
export const DEFAULT_AVATARS_DIR = path.join(REPO_ROOT, "data", "uploads", "avatars");

export interface UsersRoutesOptions {
  avatarsDir?: string;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  avif: "image/avif",
};

/** Assinaturas binárias aceitas (PNG, JPEG, GIF, BMP, WebP e AVIF). */
export function sniffImage(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF") {
    if (String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp";
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (brand === "avif" || brand === "avis") return "avif";
  }
  return null;
}

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

export function usersRoutes(getDb: () => Db, options: UsersRoutesOptions = {}) {
  const avatarsDir = options.avatarsDir ?? DEFAULT_AVATARS_DIR;
  const app = new Hono<AuthEnv>();
  const authed = (c: Context<AuthEnv>) => c.get("auth");

  /** Caminho absoluto da foto guardada (relativo à raiz do repositório). */
  const avatarFileOf = (avatarPath: string | null): string | null =>
    avatarPath ? path.join(REPO_ROOT, avatarPath) : null;

  /** PATCH /api/users/me — nome de exibição e preferências de aparência. */
  app.patch("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      name?: unknown;
      theme?: unknown;
      density?: unknown;
      palette?: unknown;
    } | null;
    if (!body) return c.json({ error: { code: "invalid_body", message: "JSON inválido" } }, 400);

    const { user } = authed(c);
    const patch: { name?: string; theme?: string; density?: string; palette?: string } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        return c.json({ error: { code: "invalid_body", message: "Nome inválido" } }, 400);
      }
      patch.name = body.name;
    }
    for (const field of ["theme", "density", "palette"] as const) {
      const value = body[field];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        return c.json({ error: { code: "invalid_body", message: `${field} inválido` } }, 400);
      }
      patch[field] = value;
    }

    try {
      let updated = user;
      if (patch.name !== undefined) {
        updated = updateUserProfile(getDb(), user.id, patch.name) ?? updated;
      }
      if (patch.theme !== undefined || patch.density !== undefined || patch.palette !== undefined) {
        updated = updateUserPreferences(getDb(), user.id, patch) ?? updated;
      }
      return c.json({ user: publicUser(updated) });
    } catch (error) {
      if (error instanceof AccountsError) {
        return c.json({ error: { code: error.code, message: error.message } }, 400);
      }
      throw error;
    }
  });

  /** PATCH /api/users/me/password — troca exigindo a senha atual. */
  app.patch("/password", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      currentPassword?: unknown;
      newPassword?: unknown;
      confirmPassword?: unknown;
    } | null;
    if (!body) return c.json({ error: { code: "invalid_body", message: "JSON inválido" } }, 400);

    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body.newPassword === "string" ? body.newPassword : "";
    const confirm = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    const { user, session } = authed(c);

    if (!(await verifyPassword(current, user.passwordHash))) {
      return c.json({ error: { code: "unauthorized", message: "Senha atual incorreta" } }, 401);
    }
    if (next !== confirm) {
      return c.json(
        { error: { code: "invalid_body", message: "A confirmação não confere com a senha" } },
        400,
      );
    }
    if (next.length < 10) {
      return c.json(
        { error: { code: "password_too_short", message: "Senha deve ter no mínimo 10 caracteres" } },
        400,
      );
    }

    try {
      updateUserPassword(getDb(), user.id, await hashPassword(next));
    } catch (error) {
      if (error instanceof AccountsError) {
        return c.json({ error: { code: error.code, message: error.message } }, 400);
      }
      throw error;
    }

    // A sessão atual continua; as outras encerram (specs/user-auth).
    revokeOtherSessions(getDb(), user.id, session.id);
    return c.json({ ok: true });
  });

  /** PUT /api/users/me/avatar — upload multipart (a única rota não-JSON). */
  app.put("/avatar", async (c) => {
    const { user } = authed(c);

    const form = await c.req.formData().catch(() => null);
    const file = form?.get("avatar");
    if (!file || typeof file === "string") {
      return c.json(
        { error: { code: "invalid_body", message: "Envie o arquivo no campo avatar" } },
        400,
      );
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return c.json({ error: { code: "avatar_too_large", message: "Imagem acima de 512 KB" } }, 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) {
      return c.json(
        { error: { code: "invalid_image", message: "Formato de imagem não aceito" } },
        415,
      );
    }

    // Remove a foto anterior (o formato pode ter mudado ao trocar a imagem).
    const previous = avatarFileOf(user.avatarPath);
    if (previous && existsSync(previous)) unlinkSync(previous);

    mkdirSync(avatarsDir, { recursive: true });
    const target = path.join(avatarsDir, `${user.id}.${kind}`);
    writeFileSync(target, bytes);
    setAvatarPath(getDb(), user.id, path.relative(REPO_ROOT, target));

    const updated = getUserById(getDb(), user.id) ?? user;
    return c.json({ user: publicUser(updated) }, 200);
  });

  /** GET /api/users/me/avatar — serve a foto com ETag derivado do updated_at. */
  app.get("/avatar", (c) => {
    const { user } = authed(c);
    const file = avatarFileOf(user.avatarPath);
    if (!file || !existsSync(file)) {
      return c.json({ error: { code: "not_found", message: "Sem foto de perfil" } }, 404);
    }

    const etag = `"${user.id}-${user.updatedAt}"`;
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);

    const ext = path.extname(file).slice(1);
    return new Response(Bun.file(file).stream(), {
      headers: {
        "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream",
        etag,
        "cache-control": "private, max-age=0, must-revalidate",
      },
    });
  });

  /** DELETE /api/users/me/avatar — apaga o arquivo e volta às iniciais. */
  app.delete("/avatar", (c) => {
    const { user } = authed(c);
    const file = avatarFileOf(user.avatarPath);
    if (file && existsSync(file)) unlinkSync(file);
    setAvatarPath(getDb(), user.id, null);
    const updated = getUserById(getDb(), user.id) ?? user;
    return c.json({ user: publicUser(updated) });
  });

  return app;
}
