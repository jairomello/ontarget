import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import path from "node:path";
import { CORE_VERSION } from "@ontarget/core";
import { createDb, type Db } from "./db/index";
import { projectsRoutes } from "./routes/projects";

/** Build do client servido pelo servidor em produção (SPA). */
export const WEB_DIST = path.resolve(import.meta.dir, "../../web/dist");
export const INDEX_HTML = path.join(WEB_DIST, "index.html");

export interface AppOptions {
  /** Banco usado pela aplicação; criado sob demanda quando ausente. */
  db?: Db;
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

  app.route("/api/projects", projectsRoutes(getDb));

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

export type App = ReturnType<typeof createApp>;
