import { afterAll, describe, expect, it } from "bun:test";
import { and, eq, gt } from "drizzle-orm";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createApp } from "../src/app";
import { createDb, type Db } from "../src/db/index";
import * as schema from "../src/db/schema";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "changelog-"));
const dbPath = path.join(dir, "changelog.db");
const db: Db = createDb(dbPath);
const app = createApp({ db });

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const now = Date.now();

async function post(url: string, body: unknown) {
  const res = await app.fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function createProject(name: string): Promise<string> {
  const { status, body } = await post("http://localhost/api/projects", { name });
  expect(status).toBe(201);
  return body.project.id as string;
}

function taskRow(id: string, projectId: string, name: string, sortOrder = 0) {
  return {
    id,
    projectId,
    name,
    sortOrder,
    outlineLevel: 0,
    outlineNumber: String(sortOrder + 1),
    createdAt: now,
    updatedAt: now,
  };
}

function entriesFor(projectId: string, entityId?: string) {
  const rows = db
    .select()
    .from(schema.changeLog)
    .where(eq(schema.changeLog.projectId, projectId))
    .all();
  return entityId ? rows.filter((row) => row.entityId === entityId) : rows;
}

describe("change_log junto ao sync", () => {
  it("registra criação com valor anterior nulo, valor novo e data", async () => {
    const projectId = await createProject("Log de Criação");
    const before = Date.now();

    await post(`http://localhost/api/projects/${projectId}/sync`, {
      upserts: { tasks: [taskRow("log-1", projectId, "Primeira versão")] },
    });

    const entries = entriesFor(projectId, "log-1");
    const nameEntry = entries.find((entry) => entry.field === "name");
    expect(nameEntry).toBeDefined();
    expect(nameEntry?.entityType).toBe("tasks");
    expect(nameEntry?.oldValue).toBeNull();
    expect(JSON.parse(nameEntry!.newValue!)).toBe("Primeira versão");
    expect(nameEntry!.changedAt).toBeGreaterThanOrEqual(before);
    expect(nameEntry!.changedAt).toBeLessThanOrEqual(Date.now());
  });

  it("registra o valor anterior e o novo quando o campo muda", async () => {
    const projectId = await createProject("Log de Atualização");

    await post(`http://localhost/api/projects/${projectId}/sync`, {
      upserts: { tasks: [taskRow("log-2", projectId, "Antes")] },
    });
    await post(`http://localhost/api/projects/${projectId}/sync`, {
      upserts: { tasks: [taskRow("log-2", projectId, "Depois")] },
    });

    const nameEntries = entriesFor(projectId, "log-2").filter(
      (entry) => entry.field === "name",
    );
    expect(nameEntries).toHaveLength(2);
    expect(JSON.parse(nameEntries[0]!.oldValue!)).toBeNull();
    expect(JSON.parse(nameEntries[0]!.newValue!)).toBe("Antes");
    expect(JSON.parse(nameEntries[1]!.oldValue!)).toBe("Antes");
    expect(JSON.parse(nameEntries[1]!.newValue!)).toBe("Depois");
  });

  it("não registra nada ao reenviar um lote sem mudança", async () => {
    const projectId = await createProject("Log Idempotente");
    const url = `http://localhost/api/projects/${projectId}/sync`;
    const batch = { upserts: { tasks: [taskRow("log-3", projectId, "Estável")] } };

    await post(url, batch);
    const afterFirst = entriesFor(projectId).length;
    expect(afterFirst).toBeGreaterThan(0);

    await post(url, batch);
    await post(url, batch);
    expect(entriesFor(projectId)).toHaveLength(afterFirst);
  });

  it("registra a remoção com valor novo nulo", async () => {
    const projectId = await createProject("Log de Remoção");
    const url = `http://localhost/api/projects/${projectId}/sync`;

    await post(url, { upserts: { tasks: [taskRow("log-4", projectId, "Removida")] } });
    await post(url, { deletes: { tasks: ["log-4"] } });

    const nameEntries = entriesFor(projectId, "log-4").filter(
      (entry) => entry.field === "name",
    );
    expect(nameEntries).toHaveLength(2);
    expect(JSON.parse(nameEntries.at(-1)!.newValue!)).toBeNull();
    expect(JSON.parse(nameEntries.at(-1)!.oldValue!)).toBe("Removida");
  });

  it("permite filtrar as alterações posteriores a uma data (change highlighting)", async () => {
    const projectId = await createProject("Log por Data");
    const url = `http://localhost/api/projects/${projectId}/sync`;

    await post(url, { upserts: { tasks: [taskRow("log-5", projectId, "Inicial")] } });
    const cutoff = Date.now();
    // Duas gravações no mesmo milissegundo têm o mesmo `changedAt` e ficam
    // indistinguíveis pelo filtro; espera o relógio virar antes da segunda.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await post(url, { upserts: { tasks: [taskRow("log-5", projectId, "Tarde")] } });

    const since = db
      .select()
      .from(schema.changeLog)
      .where(
        and(
          eq(schema.changeLog.projectId, projectId),
          gt(schema.changeLog.changedAt, cutoff),
        ),
      )
      .all();

    expect(since.length).toBeGreaterThan(0);
    expect(since.every((entry) => entry.changedAt > cutoff)).toBe(true);
  });
});
