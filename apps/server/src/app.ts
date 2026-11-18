import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import path from "node:path";
import { CORE_VERSION } from "@ontarget/core";
import { createDb, type Db } from "./db/index";
import { authMiddleware, type AuthEnv } from "./middleware/auth";
import { jsonBodyMiddleware } from "./middleware/jsonBody";
import { authRoutes } from "./routes/auth";
import { apiKeysRoutes } from "./routes/apiKeys";
import { usersRoutes } from "./routes/users";
import { projectsRoutes } from "./routes/projects";

/** Build do client servido pelo servidor em produção (SPA). */
export const WEB_DIST = path.resolve(import.meta.dir, "../../web/dist");
export const INDEX_HTML = path.join(WEB_DIST, "index.html");

export interface AppOptions {
  /** Banco usado pela aplicação; criado sob demanda quando ausente. */
  db?: Db;
  /** Diretório das fotos de perfil (testes usam um temporário). */
  avatarsDir?: string;
}

/**
 * Aplicação HTTP do ontarget.
 * Exportada sem escutar porta para permitir testes de contrato via `app.fetch`.
 */
export function createApp(options: AppOptions = {}) {
  let dbInstance: Db | undefined;
  const getDb = (): Db => (dbInstance ??= options.db ?? createDb());

  const app = new Hono();

  app.get("/api/health", (c) =>
    c.json({
      status: "ok",
      name: "ontarget",
      version: CORE_VERSION,
      time: new Date().toISOString(),
    }),
  );

  // Autenticação fica fora do middleware: cada rota decide o que exige sessão
  // (`/me` responde 401 sozinha, o resto é público por definição).
  app.route("/api/auth", authRoutes(getDb));

  // Todo o resto sob /api exige sessão válida (specs/user-auth).
  const secured = new Hono<AuthEnv>();
  secured.use("*", authMiddleware({ getDb }));
  secured.use("*", jsonBodyMiddleware);
  secured.route("/projects", projectsRoutes(getDb));
  secured.route("/users/me", usersRoutes(getDb, { avatarsDir: options.avatarsDir }));
  secured.route("/api-keys", apiKeysRoutes(getDb));
  app.route("/api", secured);

  // Assets do client (JS, CSS, ícones, manifest) quando já construídos.
  // O curinga vem depois das rotas de API; arquivos inexistentes caem no
  // fallback da SPA abaixo.
  app.use("/*", serveStatic({ root: WEB_DIST }));
  app.get("/", serveStatic({ path: INDEX_HTML }));

  app.notFound(async (c) => {
    const url = new URL(c.req.url);
    const isApi = url.pathname.startsWith("/api/");
    const isGet = c.req.method === "GET";

    // SPA fallback: qualquer rota não-API devolve o index.html.
    if (!isApi && isGet && existsSync(INDEX_HTML)) {
      return c.html(await Bun.file(INDEX_HTML).text());
    }

    return c.json({ error: { code: "not_found", message: "Recurso não encontrado" } }, 404);
  });

  return app;
}
