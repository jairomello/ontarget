import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Linha de progresso e preenchimento das barras (specs/tracking — "Linha de
 * progresso"): na data de status, as tarefas adiantadas marcam à direita e as
 * atrasadas à esquerda, com rótulos — e o preenchimento da barra segue o
 * percentual concluído.
 */

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

test("linha de progresso marca adiantados à direita e atrasados à esquerda", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Progresso E2E ${Date.now()}`);

  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const span = 4 * DAY; // seg..sex (inclusive)

  const task = (index: number, key: string, name: string, percent: number) => ({
    id: `${uid}-${key}`,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    start: MON,
    finish: MON + span,
    duration: 5 * WORKDAY, // 45 h = seg a sex no calendário de 9h
    durationUnit: "day",
    percentComplete: percent,
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

  const ids = { ahead: `${uid}-ahead`, behind: `${uid}-behind` };
  const seeded = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [
          task(0, "ahead", "Adiantada", 90),
          task(1, "behind", "Atrasada", 10),
        ],
      },
    },
  });
  expect(seeded.status()).toBe(200);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "2");

  // --- salva a baseline e define a data de status (quarta, 07/01) -------------
  await page.getByTestId("baseline-toggle").click();
  await page.getByTestId("baseline-name").fill("Baseline 1");
  await page.getByTestId("baseline-save").click();
  await expect(page.getByTestId("baseline-row")).toHaveCount(1);
  await page.getByTestId("baselines-close").click();

  await page.getByTestId("statusdate-toggle").click();
  await page.getByTestId("status-date").fill("2026-01-07");
  await page.getByTestId("statusdate-close").click();

  // --- visão Controle ----------------------------------------------------------
  await page.getByTestId("view-select").selectOption("tracking");

  // linha da data de status + linha de progresso
  await expect(page.getByTestId("status-line")).toBeVisible();
  await expect(page.getByTestId("progress-line")).toBeVisible();

  // na quarta, o planejado é 60% (3 de 5 dias): A está em 90% (+30) e B em 10% (-50)
  const ahead = page.locator('[data-testid="progress-marker"][data-direction="ahead"]');
  const behind = page.locator('[data-testid="progress-marker"][data-direction="behind"]');
  await expect(ahead).toHaveCount(1);
  await expect(ahead).toHaveAttribute("data-task-id", ids.ahead);
  await expect(ahead).toHaveAttribute("data-delta", "30");
  await expect(behind).toHaveCount(1);
  await expect(behind).toHaveAttribute("data-task-id", ids.behind);
  await expect(behind).toHaveAttribute("data-delta", "-50");

  // --- rótulos ----------------------------------------------------------------
  await expect(
    page.locator('[data-testid="progress-label"][data-direction="ahead"]'),
  ).toHaveText("+30% adiantado");
  await expect(
    page.locator('[data-testid="progress-label"][data-direction="behind"]'),
  ).toHaveText("-50% atrasado");

  // --- adiantado fica à direita da linha; atrasado, à esquerda ---------------
  const statusBox = (await page.getByTestId("status-line").boundingBox())!;
  const aheadBox = (await ahead.boundingBox())!;
  const behindBox = (await behind.boundingBox())!;
  expect(aheadBox.x).toBeGreaterThan(statusBox.x);
  expect(behindBox.x).toBeLessThan(statusBox.x);

  // --- preenchimento das barras segue o percentual ----------------------------
  const barWidth = (await page.getByTestId("gantt-bar").first().boundingBox())!.width;
  const aheadFill = page
    .locator(`[data-testid="gantt-bar"][data-task-id="${ids.ahead}"]`)
    .getByTestId("gantt-progress");
  const behindFill = page
    .locator(`[data-testid="gantt-bar"][data-task-id="${ids.behind}"]`)
    .getByTestId("gantt-progress");

  const aheadFillBox = (await aheadFill.boundingBox())!;
  const behindFillBox = (await behindFill.boundingBox())!;
  // 90% e 10% da largura da barra (tolerância de arredondamento do geometry)
  expect(aheadFillBox.width / barWidth).toBeGreaterThan(0.85);
  expect(aheadFillBox.width / barWidth).toBeLessThanOrEqual(1);
  expect(behindFillBox.width / barWidth).toBeLessThan(0.15);

  expect(errors).toEqual([]);
});
