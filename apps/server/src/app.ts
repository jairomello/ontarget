import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import path from "node:path";
import { CORE_VERSION } from "@e-project/core";

/** Build do client servido pelo servidor em produção (SPA). */
export const WEB_DIST = path.resolve(import.meta.dir, "../../web/dist");
export const INDEX_HTML = path.join(WEB_DIST, "index.html");

/**
 * Aplicação HTTP do e-project.
 * Exportada sem escutar porta para permitir testes de contrato via `app.fetch`.
 */
export function createApp() {
  const app = new Hono();

  app.get("/api/health", (c) =>
    c.json({
      status: "ok",
      name: "e-project",
      version: CORE_VERSION,
      time: new Date().toISOString(),
    }),
  );

  // Assets do client (JS, CSS, imagens) quando já construídos.
  app.use("/assets/*", serveStatic({ root: WEB_DIST }));
  app.get("/", serveStatic({ path: INDEX_HTML }));

  app.notFound(async (c) => {
    const url = new URL(c.req.url);
    const isApi = url.pathname.startsWith("/api/");
    const isGet = c.req.method === "GET";

    // SPA fallback: qualquer rota não-API devolve o index.html.
    if (!isApi && isGet && existsSync(INDEX_HTML)) {
      return c.html(await Bun.file(INDEX_HTML).text());
    }

    return c.json(
      { error: { code: isApi ? "not_found" : "not_found", message: "Recurso não encontrado" } },
      404,
    );
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
