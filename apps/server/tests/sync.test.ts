import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createApp } from "../src/app";
import { createDb, type Db } from "../src/db/index";
import * as schema from "../src/db/schema";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "sync-"));
const dbPath = path.join(dir, "sync.db");
const db: Db = createDb(dbPath);
const app = createApp({ db });

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const now = Date.now();

function taskRow(id: string, projectId: string, name: string, sortOrder: number) {
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

async function post(url: string, body: unknown, method = "POST") {
  const res = await app.fetch(
    new Request(url, {
      method,
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

function countTasks(projectId: string): number {
  return db
    .select({ value: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, projectId))
    .all().length;
}

describe("POST /api/projects/:id/sync", () => {
  it("reenviar o mesmo lote não duplica registros", async () => {
    const projectId = await createProject("Sync Idempotente");
    const url = `http://localhost/api/projects/${projectId}/sync`;

    const batch = {
      upserts: {
        tasks: [
          taskRow("t1", projectId, "Tarefa um", 0),
          taskRow("t2", projectId, "Tarefa dois", 1),
          taskRow("t3", projectId, "Tarefa três", 2),
        ],
      },
    };

    const first = await post(url, batch);
    expect(first.status).toBe(200);
    expect(first.body.upserted.tasks).toBe(3);
    expect(countTasks(projectId)).toBe(3);

    // reenvio idêntico
    const second = await post(url, batch);
    expect(second.status).toBe(200);
    expect(countTasks(projectId)).toBe(3);

    const names = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .all()
      .map((row) => row.name)
      .sort();
    expect(names).toEqual(["Tarefa dois", "Tarefa três", "Tarefa um"]);
  });

  it("atualiza a linha existente em vez de criar outra", async () => {
    const projectId = await createProject("Sync Atualização");
    const url = `http://localhost/api/projects/${projectId}/sync`;

    await post(url, { upserts: { tasks: [taskRow("a1", projectId, "Antes", 0)] } });
    await post(url, { upserts: { tasks: [taskRow("a1", projectId, "Depois", 0)] } });

    const rows = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Depois");
  });

  it("apaga por chave primária de forma idempotente", async () => {
    const projectId = await createProject("Sync Delete");
    const url = `http://localhost/api/projects/${projectId}/sync`;

    await post(url, {
      upserts: {
        tasks: [taskRow("d1", projectId, "Removível 1", 0), taskRow("d2", projectId, "Removível 2", 1)],
      },
    });
    expect(countTasks(projectId)).toBe(2);

    const first = await post(url, { deletes: { tasks: ["d1"] } });
    expect(first.body.deleted.tasks).toBe(1);
    expect(countTasks(projectId)).toBe(1);

    const second = await post(url, { deletes: { tasks: ["d1"] } });
    expect(second.body.deleted.tasks).toBe(0);
    expect(countTasks(projectId)).toBe(1);
  });

  it("delete e upsert na mesma posição do índice único não colidem", async () => {
    const projectId = await createProject("Sync Delete + Upsert");
    const url = `http://localhost/api/projects/${projectId}/sync`;

    await post(url, {
      upserts: {
        tasks: [taskRow("s1", projectId, "Fica", 0), taskRow("s2", projectId, "Sai", 1)],
      },
    });

    // a nova tarefa assume o `sort_order` liberado pela removida no mesmo lote
    const res = await post(url, {
      upserts: { tasks: [taskRow("s3", projectId, "Entra", 1)] },
      deletes: { tasks: ["s2"] },
    });

    expect(res.status).toBe(200);
    expect(res.body.upserted.tasks).toBe(1);
    expect(res.body.deleted.tasks).toBe(1);

    const rows = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder);

    expect(rows.map((row) => ({ id: row.id, sortOrder: row.sortOrder }))).toEqual([
      { id: "s1", sortOrder: 0 },
      { id: "s3", sortOrder: 1 },
    ]);
  });

  it("reordenar tarefas em lote não viola o índice único de sort_order", async () => {
    const projectId = await createProject("Sync Reordenação");
    const url = `http://localhost/api/projects/${projectId}/sync`;

    await post(url, {
      upserts: {
        tasks: [
          taskRow("r1", projectId, "Alfa", 0),
          taskRow("r2", projectId, "Beta", 1),
          taskRow("r3", projectId, "Gama", 2),
        ],
      },
    });

    // inversão completa: cada upsert isolado colidiria com a posição vizinha
    const res = await post(url, {
      upserts: {
        tasks: [
          taskRow("r2", projectId, "Beta", 0),
          taskRow("r3", projectId, "Gama", 1),
          taskRow("r1", projectId, "Alfa", 2),
        ],
      },
    });

    expect(res.status).toBe(200);

    const rows = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder);

    expect(rows.map((row) => [row.name, row.sortOrder])).toEqual([
      ["Beta", 0],
      ["Gama", 1],
      ["Alfa", 2],
    ]);
  });

  it("rejeita entidade desconhecida, chave ausente e escrita cruzada", async () => {
    const projectId = await createProject("Sync Validação");
    const url = `http://localhost/api/projects/${projectId}/sync`;

    const unknown = await post(url, { upserts: { extraterrestre: [] } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("unknown_entity");

    const missingKey = await post(url, { upserts: { tasks: [{ name: "sem id" }] } });
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe("missing_key");

    const other = await createProject("Outro Projeto");
    const cross = await post(url, { upserts: { tasks: [taskRow("x1", other, "Intruso", 0)] } });
    expect(cross.status).toBe(400);
    expect(cross.body.error.code).toBe("cross_project_write");
    expect(countTasks(other)).toBe(0);
  });

  it("o lote inteiro é atômico: falha não deixa meio estado", async () => {
    const projectId = await createProject("Sync Atômico");
    const url = `http://localhost/api/projects/${projectId}/sync`;

    const res = await app.fetch(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          upserts: { tasks: [taskRow("ok1", projectId, "Válida", 0)] },
          deletes: { tarefas_inexistentes: ["zzz"] },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(countTasks(projectId)).toBe(0);
  });

  it("responde 404 para projeto inexistente", async () => {
    const res = await post("http://localhost/api/projects/desaparecido/sync", { upserts: {} });
    expect(res.status).toBe(404);
  });
});

describe("biblioteca global (library_items)", () => {
  async function get(url: string) {
    const res = await app.fetch(new Request(url));
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }

  function libraryRow(id: string) {
    return db.select().from(schema.libraryItems).where(eq(schema.libraryItems.id, id)).get();
  }

  function item(id: string, projectId: string | null, name: string, kind = "filter") {
    return { id, kind, name, projectId, config: "{}", createdAt: now };
  }

  it("item global fica sem projeto e aparece no detalhe de qualquer projeto", async () => {
    const projectA = await createProject("Biblioteca Global A");
    const projectB = await createProject("Biblioteca Global B");

    const res = await post(`http://localhost/api/projects/${projectA}/sync`, {
      upserts: {
        library_items: [
          item("lib-global", null, "Global"),
          item("lib-owned", projectA, "Do projeto A", "view"),
        ],
      },
    });
    expect(res.status).toBe(200);

    expect(libraryRow("lib-global")?.projectId).toBeNull();
    expect(libraryRow("lib-owned")?.projectId).toBe(projectA);

    const detailA = await get(`http://localhost/api/projects/${projectA}`);
    const detailB = await get(`http://localhost/api/projects/${projectB}`);
    const names = (body: any) =>
      body.data.libraryItems.map((entry: any) => entry.name).sort();
    // A vê os dois; B vê apenas o global (não herdou o item do projeto A)
    expect(names(detailA.body)).toEqual(["Do projeto A", "Global"]);
    expect(names(detailB.body)).toEqual(["Global"]);
  });

  it("exclui o item global e protege os itens de outros projetos", async () => {
    const projectA = await createProject("Biblioteca Exclusão A");
    const projectB = await createProject("Biblioteca Exclusão B");
    const syncA = `http://localhost/api/projects/${projectA}/sync`;
    const syncB = `http://localhost/api/projects/${projectB}/sync`;

    await post(syncA, { upserts: { library_items: [item("lib-g2", null, "Global 2")] } });
    await post(syncA, { upserts: { library_items: [item("lib-a", projectA, "Do A", "view")] } });
    await post(syncB, { upserts: { library_items: [item("lib-b", projectB, "Do B", "view")] } });

    // B não alcança o item do projeto A (escopo por projeto)
    const crossDelete = await post(syncB, { deletes: { library_items: ["lib-a"] } });
    expect(crossDelete.body.deleted.library_items).toBe(0);
    expect(libraryRow("lib-a")).toBeDefined();

    // mas alcança o item global, que é de todos os projetos
    const globalDelete = await post(syncB, { deletes: { library_items: ["lib-g2"] } });
    expect(globalDelete.body.deleted.library_items).toBe(1);
    expect(libraryRow("lib-g2")).toBeUndefined();

    // escrita cruzada continua rejeitada
    const cross = await post(syncB, {
      upserts: { library_items: [{ ...item("lib-a", projectA, "Invasão", "view") }] },
    });
    expect(cross.status).toBe(400);
    expect(cross.body.error.code).toBe("cross_project_write");
    expect(libraryRow("lib-a")?.name).toBe("Do A");
  });
});
