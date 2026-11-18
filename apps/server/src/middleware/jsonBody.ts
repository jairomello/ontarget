import type { Context, Next } from "hono";

/**
 * Exige `Content-Type: application/json` nas rotas de escrita (design.md —
 * "Primeiro acesso e bloqueio de rotas"), reduzindo CSRF para além do
 * `SameSite=Lax`. O upload de foto é multipart e fica de fora.
 *
 * Requisições sem corpo não são bloqueadas: `POST` de rota sem payload não
 * precisa de content-type.
 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);
const ACCEPTED = ["application/json", "multipart/form-data"];

export async function jsonBodyMiddleware(c: Context, next: Next) {
  if (!WRITE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const contentType = c.req.header("content-type") ?? "";
  const contentLength = Number(c.req.header("content-length") ?? "0");
  const hasBody = contentType !== "" || contentLength > 0;

  if (!hasBody) {
    await next();
    return;
  }

  if (ACCEPTED.some((type) => contentType.startsWith(type))) {
    await next();
    return;
  }

  return c.json(
    { error: { code: "unsupported_media_type", message: "Envie application/json" } },
    415,
  );
}
