import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createDb, type Db } from "../src/db/index";
import { createAuthedApp } from "./helpers/auth";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "import-"));
const dbPath = path.join(dir, "import.db");
const db: Db = createDb(dbPath);
const { fetch } = await createAuthedApp(db);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const now = Date.now();

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(
    new Request(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** GET sem corpo (o Request do happy-dom rejeita corpo em GET). */
async function get(url: string) {
  const res = await fetch(new Request(url));
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function createProject(name: string): Promise<string> {
  const { status, body } = await post("http://localhost/api/projects", { name });
  expect(status).toBe(201);
  return body.project.id as string;
}

function taskRow(id: string, projectId: string, outlineNumber: string, name: string, sortOrder: number) {
  return {
    id,
    projectId,
    parentId: null,
    outlineLevel: outlineNumber.split(".").length - 1,
    outlineNumber,
    sortOrder,
    name,
    notes: null,
    isSummary: false,
    isMilestone: false,
    isInactive: false,
    schedulingMode: "auto",
    isPlaceholder: false,
    taskType: "fixed_duration",
    effortDriven: true,
    constraintType: null,
    constraintDate: null,
    deadline: null,
    manualStart: null,
    manualFinish: null,
    manualDuration: null,
    start: null,
    finish: null,
    duration: null,
    durationUnit: null,
    work: null,
    cost: null,
    fixedCost: null,
    actualStart: null,
    actualFinish: null,
    actualDuration: null,
    actualWork: null,
    actualCost: null,
    percentComplete: 0,
    physicalPercent: null,
    durationEstimated: false,
    priority: 500,
    calendarId: null,
    wbsCode: null,
    recurrence: null,
    segments: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function syncTasks(projectId: string, rows: ReturnType<typeof taskRow>[]): Promise<void> {
  const res = await post(`http://localhost/api/projects/${projectId}/sync`, {
    upserts: { tasks: rows },
  });
  expect(res.status).toBe(200);
}

async function taskNames(projectId: string): Promise<string[]> {
  const res = await get(`http://localhost/api/projects/${projectId}`);
  return (res.body.data.tasks as Array<{ name: string }>).map((task) => task.name);
}

async function taskSortOrders(projectId: string): Promise<number[]> {
  const res = await get(`http://localhost/api/projects/${projectId}`);
  return (res.body.data.tasks as Array<{ sortOrder: number }>)
    .map((task) => task.sortOrder)
    .sort((a, b) => a - b);
}

describe("POST /api/projects/:id/import", () => {
  it("substituição apaga o que o arquivo carrega e grava as linhas novas", async () => {
    const projectId = await createProject("Import Substituição");
    await syncTasks(projectId, [
      taskRow("old-1", projectId, "1", "Velha 1", 0),
      taskRow("old-2", projectId, "2", "Velha 2", 1),
    ]);

    const res = await post(`http://localhost/api/projects/${projectId}/import`, {
      mode: "replace",
      replaceEntities: ["tasks"],
      upserts: {
        tasks: [
          taskRow("new-1", projectId, "1", "Nova 1", 0),
          taskRow("new-2", projectId, "1.1", "Nova Filha", 1),
        ],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.upserted.tasks).toBe(2);
    expect(await taskNames(projectId)).toEqual(["Nova 1", "Nova Filha"]);
  });

  it("mesclagem convive com o índice único de ordem e renumera a árvore", async () => {
    const projectId = await createProject("Import Mesclagem");
    await syncTasks(projectId, [
      taskRow("old-1", projectId, "1", "Raiz", 0),
      taskRow("old-2", projectId, "1.1", "Filha", 1),
    ]);

    // sortOrder 0 duplicado com o existente: só passa com a neutralização
    const res = await post(`http://localhost/api/projects/${projectId}/import`, {
      mode: "merge",
      replaceEntities: [],
      upserts: {
        tasks: [
          taskRow("added", projectId, "1.2", "Nova irmã", 0),
          taskRow("old-1", projectId, "1", "Raiz", 1),
          taskRow("old-2", projectId, "1.1", "Filha", 2),
        ],
      },
    });

    expect(res.status).toBe(200);
    const names = await taskNames(projectId);
    expect(names).toHaveLength(3);
    expect(names).toContain("Nova irmã");
    // renumeração final: ordem WBS sem colisão de sortOrder
    expect(await taskSortOrders(projectId)).toEqual([0, 1, 2]);

    const detail = await get(`http://localhost/api/projects/${projectId}`);
    const byName = new Map(
      (detail.body.data.tasks as Array<{ name: string; sortOrder: number; outlineNumber: string }>).map(
        (task) => [task.name, task],
      ),
    );
    expect(byName.get("Raiz")!.sortOrder).toBe(0);
    expect(byName.get("Filha")!.sortOrder).toBe(1);
    expect(byName.get("Nova irmã")!.sortOrder).toBe(2);
  });

  it("falha no meio desfaz tudo (nada de estado parcial)", async () => {
    const projectId = await createProject("Import Atômico");
    await syncTasks(projectId, [
      taskRow("keep-1", projectId, "1", "Keep 1", 0),
      taskRow("keep-2", projectId, "2", "Keep 2", 1),
    ]);
    await post(`http://localhost/api/projects/${projectId}/sync`, {
      upserts: {
        task_links: [
          {
            id: "l-orig",
            projectId,
            predecessorId: "keep-1",
            successorId: "keep-2",
            type: "fs",
            lagMs: 0,
            crossProjectRef: null,
          },
        ],
      },
    });

    // a tarefa é gravada primeiro e o vínculo viola o índice único
    // (predecessor+sucessor+tipo já existe): a transação inteira desfaz
    const res = await post(`http://localhost/api/projects/${projectId}/import`, {
      mode: "merge",
      replaceEntities: [],
      upserts: {
        tasks: [taskRow("sneaky", projectId, "9", "Não deveria entrar", 0)],
        task_links: [
          {
            id: "l-dup",
            projectId,
            predecessorId: "keep-1",
            successorId: "keep-2",
            type: "fs",
            lagMs: 0,
            crossProjectRef: null,
          },
        ],
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("import_failed");
    // rollback completo: a tarefa intermediária não ficou para trás
    expect(await taskNames(projectId)).toEqual(["Keep 1", "Keep 2"]);
  });

  it("valida mode, upserts e replaceEntities", async () => {
    const projectId = await createProject("Import Validação");

    const badMode = await post(`http://localhost/api/projects/${projectId}/import`, {
      mode: "teleporte",
      upserts: {},
    });
    expect(badMode.status).toBe(400);

    const noUpserts = await post(`http://localhost/api/projects/${projectId}/import`, {
      mode: "merge",
    });
    expect(noUpserts.status).toBe(400);

    const noEntities = await post(`http://localhost/api/projects/${projectId}/import`, {
      mode: "replace",
      upserts: {},
    });
    expect(noEntities.status).toBe(400);

    const unknownEntity = await post(`http://localhost/api/projects/${projectId}/import`, {
      mode: "replace",
      replaceEntities: ["tasks"],
      upserts: { extraterrestre: [] },
    });
    expect(unknownEntity.status).toBe(400);
    expect(unknownEntity.body.error.code).toBe("unknown_entity");

    const notFound = await post(`http://localhost/api/projects/sumiu/import`, {
      mode: "merge",
      replaceEntities: [],
      upserts: {},
    });
    expect(notFound.status).toBe(404);
  });
});
