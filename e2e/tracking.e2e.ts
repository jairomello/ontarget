import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Tracking Gantt (specs/tracking — "Tracking Gantt" e "Valores de desvio por
 * baseline"): barra fantasma da baseline sob a barra atual, colunas de
 * desvio na grade (só na visão Controle) e desvio acumulado do projeto —
 * verificados após salvar uma baseline e alterar o plano.
 */

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

test("comparação visual com baseline: barra fantasma, colunas de desvio e total", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Tracking E2E ${Date.now()}`);

  const now = Date.now();
  const uid = Date.now().toString(36);
  const start = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const task = (index: number, key: string, name: string) => ({
    id: `${uid}-${key}`,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    start,
    finish: start, // 1 dia útil inclusivo
    duration: WORKDAY,
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
  });

  const seeded = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [task(0, "a", "Editada"), task(1, "b", "Intacta")],
      },
    },
  });
  expect(seeded.status()).toBe(200);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "2");

  // --- salva a Baseline 1 -----------------------------------------------------
  await page.getByTestId("baseline-toggle").click();
  await page.getByTestId("baseline-name").fill("Baseline 1");
  await page.getByTestId("baseline-save").click();
  await expect(page.getByTestId("baseline-row")).toHaveCount(1);
  await page.getByTestId("baselines-close").click();

  // --- altera o plano da primeira tarefa (1d → 3d) ---------------------------
  const rowA = page.getByTestId("task-row").nth(0);
  const rowB = page.getByTestId("task-row").nth(1);
  await rowA.getByTestId("cell-duration").dblclick();
  await page.getByTestId("cell-editor").fill("3d");
  await page.getByTestId("cell-editor").press("Enter");
  await expect(rowA.getByTestId("cell-duration")).toHaveText("3d");
  // espera o motor recalcular e o write-back chegar à grade
  // (24h em turno de 9h: seg–qua → fim = quarta, 07/01)
  await expect(rowA.getByTestId("cell-finish")).toHaveText("07/01/2026");

  // --- entra na visão Controle (Tracking) -------------------------------------
  await page.getByTestId("view-select").selectOption("tracking");

  // colunas de desvio visíveis apenas nesta visão
  await expect(page.getByTestId("header-devFinish")).toBeVisible();
  await expect(page.getByTestId("header-devStart")).toBeVisible();

  // --- barra fantasma sob a barra atual --------------------------------------
  const ghostOf = (taskId: string) =>
    page.locator(`[data-testid="baseline-bar"][data-task-id="${taskId}"]`);
  const barOf = (taskId: string) =>
    page.locator(`[data-testid="gantt-bar"][data-task-id="${taskId}"]`);

  const firstId = (await rowA.getAttribute("data-task-id"))!;
  const secondId = (await rowB.getAttribute("data-task-id"))!;

  await expect(ghostOf(firstId)).toBeVisible();
  await expect(ghostOf(secondId)).toBeVisible();

  // a tarefa editada cresceu: a barra atual é mais larga que a da baseline
  const ghostBox = (await ghostOf(firstId).boundingBox())!;
  const currentBox = (await barOf(firstId).boundingBox())!;
  expect(currentBox.width).toBeGreaterThan(ghostBox.width);

  // a intacta tem as duas no mesmo tamanho
  const ghostB = (await ghostOf(secondId).boundingBox())!;
  const currentB = (await barOf(secondId).boundingBox())!;
  expect(Math.abs(currentB.width - ghostB.width)).toBeLessThan(1);

  // --- colunas de desvio -------------------------------------------------------
  // 3d (24 h) no lugar de 1d (8 h): em turno de 9h isso ocupa seg–qua com
  // parte da quarta → início não move, término +2d, duração +2d
  await expect(rowA.getByTestId("cell-devStart")).toHaveText("0d");
  await expect(rowA.getByTestId("cell-devFinish")).toHaveText("+2d");
  // duração em dias de 8 h: (24 h − 9 h semeados) / 8 h = 1,88d
  await expect(rowA.getByTestId("cell-devDuration")).toHaveText("+1,88d");
  await expect(rowB.getByTestId("cell-devFinish")).toHaveText("0d");
  await expect(rowB.getByTestId("cell-devDuration")).toHaveText("0d");

  // desvio acumulado do projeto: o maior término andou 2 dias
  await expect(page.getByTestId("tracking-total")).toContainText("Desvio +2d");

  // --- trocar a baseline selecionada zera o desvio ----------------------------
  await page.getByTestId("baseline-toggle").click();
  await page.getByTestId("baseline-name").fill("Baseline 2");
  await page.getByTestId("baseline-save").click();
  await expect(page.getByTestId("baseline-row")).toHaveCount(2);
  await page.getByTestId("baselines-close").click();

  await page.getByTestId("tracking-baseline").selectOption({ label: "Baseline 2" });
  await expect(rowA.getByTestId("cell-devFinish")).toHaveText("0d");
  await expect(page.getByTestId("tracking-total")).toContainText("Desvio 0d");

  // --- de volta à visão Gantt: as colunas de desvio somem ---------------------
  await page.getByTestId("view-select").selectOption("gantt");
  await expect(page.getByTestId("header-devFinish")).toHaveCount(0);
  await expect(page.getByTestId("header-start")).toBeVisible();

  expect(errors).toEqual([]);
});
