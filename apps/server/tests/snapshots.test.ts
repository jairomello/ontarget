import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createApp } from "../src/app";
import { createDb, type Db } from "../src/db/index";
import * as schema from "../src/db/schema";
import { createSnapshot, listSnapshots, maybeSnapshot } from "../src/services/snapshot";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "snapshots-"));
const dbPath = path.join(dir, "snapshots.db");
const db: Db = createDb(dbPath);
const app = createApp({ db });

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const now = Date.now();

async function post(url: string, body?: unknown) {
  const res = await app.fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function createProject(name: string): Promise<string> {
  const { status, body } = await post("http://localhost/api/projects", { name });
  expect(status).toBe(201);
  return body.project.id as string;
}

async function addTask(projectId: string, id: string, name: string, sortOrder: number) {
  const { status } = await post(`http://localhost/api/projects/${projectId}/sync`, {
    upserts: {
      tasks: [
        {
          id,
          projectId,
          name,
          sortOrder,
          outlineLevel: 0,
          outlineNumber: String(sortOrder + 1),
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
  });
  expect(status).toBe(200);
}

describe("snapshots automáticos", () => {
  it("mantém apenas os 5 mais recentes por projeto", async () => {
    const projectId = await createProject("Retenção de Snapshots");

    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const info = createSnapshot(db, projectId);
      expect(info).toBeDefined();
      ids.push(info!.id);
    }

    const remaining = listSnapshots(db, projectId);
    expect(remaining).toHaveLength(5);
    // os removidos são os mais antigos (7 criados → sobram os últimos 5)
    expect(remaining.map((s) => s.id)).not.toContain(ids[0]);
    expect(remaining.map((s) => s.id)).not.toContain(ids[1]);
    expect(remaining.at(-1)?.id).toBe(ids[2]);
    expect(remaining[0]?.id).toBe(ids[6]);
  });

  it("respeita o intervalo ao criar snapshot automático", async () => {
    const projectId = await createProject("Intervalo de Snapshot");

    const first = maybeSnapshot(db, projectId, 60_000);
    expect(first).toBeDefined();

    // dentro do intervalo: nada novo
    expect(maybeSnapshot(db, projectId, 60_000)).toBeUndefined();

    // com intervalo zerado: cria outro
    expect(maybeSnapshot(db, projectId, 0)).toBeDefined();
  });
});

describe("recuperação após dados corrompidos", () => {
  it("sinaliza a corrupção com os snapshots e recupera o estado anterior", async () => {
    const projectId = await createProject("Para Recuperar");
    await addTask(projectId, "task-1", "Tarefa íntegra", 0);

    const { body: created } = await post(
      `http://localhost/api/projects/${projectId}/snapshot`,
    );
    const snapshotId = created.snapshot.id as string;
    expect(snapshotId).toBeTruthy();

    // altera depois do snapshot e corrompe um campo estruturado
    await addTask(projectId, "task-1", "Tarefa alterada depois", 0);
    db.update(schema.tasks)
      .set({ recurrence: "{isso não é json" })
      .where(eq(schema.tasks.id, "task-1"))
      .run();

    // abertura normal falha e informa os snapshots disponíveis
    const opened = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}`),
    );
    expect(opened.status).toBe(409);
    const payload = (await opened.json()) as any;
    expect(payload.error.code).toBe("project_corrupt");
    expect(payload.error.snapshots.length).toBeGreaterThanOrEqual(1);
    expect(payload.error.snapshots.map((s: any) => s.id)).toContain(snapshotId);
    const listed = payload.error.snapshots.find((s: any) => s.id === snapshotId);
    expect(typeof listed.createdAt).toBe("number");

    // recuperação a partir do snapshot
    const recovered = await post(`http://localhost/api/projects/${projectId}/recover`, {
      snapshotId,
    });
    expect(recovered.status).toBe(200);

    const after = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}`),
    );
    expect(after.status).toBe(200);

    const task = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, "task-1"))
      .get();
    expect(task?.name).toBe("Tarefa íntegra");
    expect(task?.recurrence).toBeNull();
  });

  it("responde 404 para snapshot inexistente", async () => {
    const projectId = await createProject("Snapshot Fantasma");
    const res = await post(`http://localhost/api/projects/${projectId}/recover`, {
      snapshotId: "auto:nao-existe",
    });
    expect(res.status).toBe(404);
  });

  it("responde 400 quando falta o snapshotId", async () => {
    const projectId = await createProject("Sem SnapshotId");
    const res = await post(`http://localhost/api/projects/${projectId}/recover`, {});
    expect(res.status).toBe(400);
  });
});
