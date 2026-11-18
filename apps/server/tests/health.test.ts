import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createApp } from "../src/app";
import { createDb } from "../src/db/index";
import { createAuthedApp } from "./helpers/auth";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "health-"));
const db = createDb(path.join(dir, "health.db"));
const app = createApp({ db });
const authed = await createAuthedApp(createDb(path.join(dir, "auth.db")));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/health", () => {
  it("responde 200 com status ok sem exigir sessão", async () => {
    const res = await app.fetch(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; name: string; version: string };
    expect(body.status).toBe("ok");
    expect(body.name).toBe("ontarget");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("retorna 404 JSON para rota de API inexistente (com sessão)", async () => {
    const res = await authed.fetch(new Request("http://localhost/api/inexistente"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("recusa rota de API inexistente sem sessão", async () => {
    const res = await app.fetch(new Request("http://localhost/api/inexistente"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });
});
