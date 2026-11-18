/** Stub de `fetch` para os testes do cliente (happy-dom restaura o nativo). */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function unauthorized(message = "Sessão inválida ou expirada"): Response {
  return json({ error: { code: "unauthorized", message } }, 401);
}

type Handler = (url: string, init?: RequestInit) => Response | undefined;

/**
 * Substitui `globalThis.fetch` e devolve a função de restauração. Rotas não
 * respondidas viram 404 com o caminho no corpo, para o teste falhar alto.
 */
export function stubFetch(handler: Handler): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = handler(url, init);
    if (response) return response;
    return json({ error: { code: "not_found", message: `rota não stubada: ${url}` } }, 404);
  }) as typeof globalThis.fetch;

  return () => {
    globalThis.fetch = original;
  };
}

/** Corpo JSON enviado em `init`, para os testes inspecionarem a requisição. */
export function sentBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}
