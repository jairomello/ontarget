import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";

const app = createApp();

describe("GET /api/health", () => {
  it("responde 200 com status ok", async () => {
    const res = await app.fetch(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; name: string; version: string };
    expect(body.status).toBe("ok");
    expect(body.name).toBe("ontarget");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("retorna 404 JSON para rota de API inexistente", async () => {
    const res = await app.fetch(new Request("http://localhost/api/inexistente"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});
