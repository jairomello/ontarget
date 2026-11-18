import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR; // turno padrão 09:00–18:00

/**
 * Atribuições (specs/resources — "Atribuição de tarefas a recursos",
 * "Cálculo de trabalho e custo" e "Remoção de atribuição"): criar pela coluna
 * (100%), ajustar unidades e remover pelo formulário, verificando trabalho e
 * custo por unidade e por taxa e que a tarefa permanece após remover tudo.
 */

interface Snapshot {
  data: {
    tasks: Array<{ id: string; work: number | null; cost: number | null; duration: number | null }>;
    assignments: Array<{
      resourceId: string;
      units: number;
      work: number | null;
      cost: number | null;
    }>;
    resources: Array<{ id: string; name: string; standardRate: number }>;
  };
}

async function snap(request: APIRequestContext, projectId: string): Promise<Snapshot["data"]> {
  const body = (await (await request.get(`/api/projects/${projectId}`)).json()) as Snapshot;
  return body.data;
}

test("atribuir por coluna e formulário calcula trabalho e custo e permite remover", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  // --- seed: projeto, tarefa de 5 dias e duas pessoas ------------------------
  const created = await request.post("/api/projects", {
    data: { name: `Atribuições E2E ${Date.now()}`, templateKey: "vazio" },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const projectId = project.id;

  const now = Date.now();
  const uid = Date.now().toString(36);
  const start = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const taskId = `${uid}-t`;
  const anaId = `${uid}-ana`;
  const biaId = `${uid}-bia`;

  const resource = (id: string, name: string, initials: string, rate: number) => ({
    id,
    projectId,
    teamId: null,
    name,
    initials,
    color: "#6366f1",
    type: "work",
    maxUnits: 1,
    standardRate: rate,
    costPerUse: 0,
    calendarId: null,
    email: null,
    active: true,
    notes: null,
  });

  const seeded = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [
          {
            id: taskId,
            projectId,
            parentId: null,
            outlineLevel: 0,
            outlineNumber: "1",
            sortOrder: 0,
            name: "Tarefa com gente",
            start,
            finish: start + 4 * DAY, // 5 dias úteis inclusivos (seg–sex)
            duration: 5 * WORKDAY,
            durationUnit: "day",
            percentComplete: 0,
            isSummary: false,
            isMilestone: false,
            isInactive: false,
            schedulingMode: "auto",
            taskType: "fixed_duration",
            effortDriven: true,
            priority: 500,
            createdAt: now,
            updatedAt: now,
          },
        ],
        resources: [
          resource(anaId, "Ana Silva", "AS", 100),
          resource(biaId, "Bia Souza", "BS", 150),
        ],
      },
    },
  });
  expect(seeded.status()).toBe(200);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "1");

  const row = page.getByTestId("task-row").first();

  // --- coluna Recursos: selecionar cria a atribuição a 100% -----------------
  await row.getByTestId("cell-res").dblclick();
  await page.getByTestId("cell-editor").selectOption("Ana Silva");
  await expect(row.getByTestId("cell-res")).toHaveText("Ana Silva");

  // trabalho = 45 h × 100%; custo = 45 h × R$ 100/h
  await expect
    .poll(async () => {
      const s = await snap(request, projectId);
      return s.assignments.map((a) => [a.units, a.work, a.cost]);
    })
    .toEqual([[1, 45 * HOUR, 4500]]);
  await expect
    .poll(async () => {
      const s = await snap(request, projectId);
      return [s.tasks[0]!.work, s.tasks[0]!.cost];
    })
    .toEqual([45 * HOUR, 4500]);

  // --- formulário: atribuir Bia e ajustar para 50% ---------------------------
  await row.getByTestId("cell-name").click();
  await page.keyboard.press("F4");
  await expect(page.getByTestId("task-form")).toBeVisible();
  await page.getByTestId("form-assign").selectOption({ label: "Bia Souza" });
  await expect(page.getByTestId("assignment-row")).toHaveCount(2);

  const biaUnits = page
    .getByTestId("assignment-row")
    .filter({ hasText: "Bia Souza" })
    .getByTestId("assignment-units");
  await biaUnits.fill("50");
  await biaUnits.press("Tab");

  // Bia: 50% → 22,5 h × R$ 150/h = R$ 3.375; roll-up soma as duas
  await expect
    .poll(async () => {
      const s = await snap(request, projectId);
      const bia = s.assignments.find((a) => a.resourceId === biaId);
      return bia ? [bia.units, bia.work, bia.cost] : null;
    })
    .toEqual([0.5, 22.5 * HOUR, 3375]);
  await expect
    .poll(async () => {
      const s = await snap(request, projectId);
      return [s.tasks[0]!.work, s.tasks[0]!.cost];
    })
    .toEqual([67.5 * HOUR, 7875]);

  // --- remoção: a tarefa permanece -------------------------------------------
  await page
    .getByTestId("assignment-row")
    .filter({ hasText: "Ana Silva" })
    .getByTestId("assignment-remove")
    .click();
  await expect(page.getByTestId("assignment-row")).toHaveCount(1);

  await expect
    .poll(async () => {
      const s = await snap(request, projectId);
      return [s.assignments.length, s.tasks[0]!.work, s.tasks[0]!.cost];
    })
    .toEqual([1, 22.5 * HOUR, 3375]);

  // removendo a última: trabalho e custo zerados, tarefa intacta
  await page.getByTestId("assignment-remove").click();
  await expect(page.getByTestId("assignment-row")).toHaveCount(0);
  await expect(page.getByTestId("assignments-empty")).toBeVisible();

  await expect
    .poll(async () => {
      const s = await snap(request, projectId);
      return [s.assignments.length, s.tasks[0]!.work, s.tasks[0]!.cost, s.tasks.length];
    })
    .toEqual([0, 0, 0, 1]);

  expect(errors).toEqual([]);
});
