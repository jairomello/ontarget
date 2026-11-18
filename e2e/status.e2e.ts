import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Data de status e atualização em lote (specs/tracking): classificar tarefas
 * atrasadas com o desvio em dias, atualizar progresso proporcional pela
 * seleção e pelo projeto, e persistir a data (inclusive o modo automático).
 */

interface Detail {
  data: {
    tasks: Array<{ id: string; name: string; percentComplete: number }>;
  };
  project: { statusDate: number | null; statusAuto: boolean };
}

async function detail(request: APIRequestContext, projectId: string): Promise<Detail> {
  return (await (await request.get(`/api/projects/${projectId}`)).json()) as Detail;
}

test("classificar atrasadas, atualizar progresso e persistir a data de status", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const created = await request.post("/api/projects", {
    data: { name: `Status E2E ${Date.now()}`, templateKey: "vazio" },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const projectId = project.id;

  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const WED = MON + 2 * DAY;

  const task = (
    index: number,
    name: string,
    start: number,
    finish: number,
    duration: number,
    percentComplete: number,
  ) => ({
    id: `${uid}-t${index}`,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    start,
    finish,
    duration,
    durationUnit: "day",
    percentComplete,
    isSummary: false,
    isMilestone: false,
    isInactive: false,
    schedulingMode: "auto",
    taskType: "fixed_duration",
    effortDriven: true,
    priority: 500,
    createdAt: now,
    updatedAt: now,
  });

  const ids = { late: `${uid}-t0`, running: `${uid}-t1`, done: `${uid}-t2` };
  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [
          // plano terminou terça (06/01) e não concluiu → atrasada na quinta
          task(0, "Tarefa atrasada", MON, MON + DAY, 2 * WORKDAY, 0),
          // em andamento: 5 dias úteis (qua–ter), termina só na semana seguinte
          task(1, "Tarefa em andamento", WED, WED + 6 * DAY, 5 * WORKDAY, 0),
          // já concluída: nunca atrasa nem é atualizada
          task(2, "Tarefa concluída", MON, MON + DAY, 2 * WORKDAY, 100),
        ],
      },
    },
  });
  expect(synced.status()).toBe(200);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "3");

  // seleciona a tarefa em andamento ANTES do modal (para "Atualizar tarefas")
  await page.getByTestId("task-row").nth(1).locator('[data-testid="cell-name"]').click();

  await page.getByTestId("statusdate-toggle").click();
  await expect(page.getByTestId("statusdate-panel")).toBeVisible();

  // --- define a data de status (quinta, 08/01) -------------------------------
  await page.getByTestId("status-date").fill("2026-01-08");

  // --- classificação: só a atrasada, com o desvio em dias --------------------
  const delayed = page.getByTestId("delayed-row");
  await expect(delayed).toHaveCount(1);
  await expect(delayed.first()).toHaveAttribute("data-deviation", "2");
  await expect(delayed.first()).toContainText("Tarefa atrasada");
  await expect(delayed.first()).toContainText("2d de atraso");
  // em andamento termina no futuro e a concluída nunca atrasa
  await expect(delayed).not.toContainText("Tarefa em andamento");
  await expect(delayed).not.toContainText("Tarefa concluída");

  // --- atualizar SOMENTE a seleção -------------------------------------------
  await page.getByTestId("update-tasks").click();
  await expect(page.getByTestId("update-result")).toContainText("1 tarefa");

  // 2 de 5 dias úteis transcorridos (qua e qui) = 40%
  await expect
    .poll(async () => (await detail(request, projectId)).data.tasks.map((t) => t.percentComplete))
    .toEqual([0, 40, 100]);

  // --- atualizar o projeto inteiro -------------------------------------------
  await page.getByTestId("update-project").click();
  await expect(page.getByTestId("update-result")).toContainText("atualizada");

  await expect
    .poll(async () => (await detail(request, projectId)).data.tasks.map((t) => t.percentComplete))
    .toEqual([100, 40, 100]);

  // a tarefa atrasada foi concluída: sai da lista e a grade mostra 100%
  await expect(page.getByTestId("no-delays")).toBeVisible();
  await expect(page.getByTestId("task-row").nth(0).getByTestId("cell-percent")).toHaveText("100%");

  // --- persistência ------------------------------------------------------------
  await page.getByTestId("statusdate-close").click();
  await page.reload();
  await expect(page.getByTestId("task-sheet")).toBeVisible();
  await page.getByTestId("statusdate-toggle").click();
  await expect(page.getByTestId("status-date")).toHaveValue("2026-01-08");

  // --- modo automático: segue a data corrente ----------------------------------
  // (click + toHaveChecked: o estado só muda depois do PATCH)
  await page.getByTestId("status-auto").click();
  await expect(page.getByTestId("status-auto")).toBeChecked();
  await expect(page.getByTestId("status-date")).toHaveValue(new Date().toISOString().slice(0, 10));
  const after = await detail(request, projectId);
  expect(after.project.statusAuto).toBe(true);

  expect(errors).toEqual([]);
});
