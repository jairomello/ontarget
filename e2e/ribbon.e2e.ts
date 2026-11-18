import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Ribbon da barra de comandos (docs/Design.md §3; tarefas 12.1/12.2):
 * abas funcionais com grupos por aba, ordenação de tarefas por botão,
 * por `Alt+↑/↓` (specs/task-structure) e por arrastar na grade.
 */

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

async function seedTasks(request: APIRequestContext, projectId: string): Promise<void> {
  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5);
  const names = ["Alfa", "Beta", "Gama"];
  const tasks = names.map((name, index) => ({
    id: `${uid}-${index}`,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    start: MON + index * 14 * DAY,
    finish: MON + index * 14 * DAY + 4 * DAY,
    duration: 5 * WORKDAY,
    durationUnit: "day",
    percentComplete: 0,
    isSummary: false,
    isMilestone: false,
    isInactive: false,
    isPlaceholder: false,
    schedulingMode: "auto",
    taskType: "fixed_duration",
    effortDriven: true,
    priority: 500,
    createdAt: now,
    updatedAt: now,
  }));
  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);
}

test("ribbon: abas funcionais e ordenação por botão, tecla e arraste", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Ribbon E2E ${Date.now()}`);
  await seedTasks(request, projectId);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "3");

  const row = (index: number) => page.getByTestId("task-row").nth(index);
  const rowNames = async () =>
    page
      .getByTestId("task-row")
      .locator('[data-testid="cell-name"]')
      .allInnerTexts();

  /* --- aba Tarefa ativa por padrão, botões desabilitados sem seleção ----- */
  await expect(page.getByTestId("ribbon-tab-tarefa")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("ribbon-content")).toBeVisible();
  await expect(page.getByTestId("ribbon-indent")).toBeDisabled();
  await expect(page.getByTestId("ribbon-insert")).toBeEnabled();

  /* --- botões de recuo (indentar/outdentar) ------------------------------- */
  await row(1).getByTestId("cell-name").click();
  await expect(page.getByTestId("ribbon-indent")).toBeEnabled();
  await page.getByTestId("ribbon-indent").click();
  await expect(row(1)).toHaveAttribute("data-depth", "1");
  await page.getByTestId("ribbon-outdent").click();
  await expect(row(1)).toHaveAttribute("data-depth", "0");

  /* --- botões de mover (pra cima / pra baixo) ----------------------------- */
  await row(0).getByTestId("cell-name").click(); // Alfa selecionada
  await page.getByTestId("ribbon-move-down").click();
  expect(await rowNames()).toEqual(["Beta", "Alfa", "Gama"]);
  await page.getByTestId("ribbon-move-up").click();
  expect(await rowNames()).toEqual(["Alfa", "Beta", "Gama"]);

  /* --- Alt+↑/Alt+↓ (specs/task-structure — "Ordenação de tarefas") -------- */
  await page.keyboard.press("Alt+ArrowDown");
  expect(await rowNames()).toEqual(["Beta", "Alfa", "Gama"]);
  await page.keyboard.press("Alt+ArrowUp");
  expect(await rowNames()).toEqual(["Alfa", "Beta", "Gama"]);

  /* --- arrastar para reordenar (mesmo nível) ------------------------------ */
  // Alfa solta no meio de Gama = antes dela
  await row(0).dragTo(row(2));
  expect(await rowNames()).toEqual(["Beta", "Alfa", "Gama"]);

  // Gama solta na metade de baixo de Beta = depois dela
  // (Beta é a row 0 desde o arraste anterior)
  const betaBox = (await row(0).boundingBox())!;
  await row(2).dragTo(row(0), {
    targetPosition: { x: betaBox.width / 2, y: betaBox.height - 4 },
  });
  expect(await rowNames()).toEqual(["Beta", "Gama", "Alfa"]);

  /* --- inserir, inserir subtarefa e apagar -------------------------------- */
  await page.getByTestId("ribbon-insert").click();
  await expect(page.getByTestId("task-row")).toHaveCount(4);
  await expect(row(3).getByTestId("cell-name")).toHaveText("Nova tarefa");

  await page.getByTestId("ribbon-insert-sub").click();
  await expect(page.getByTestId("task-row")).toHaveCount(5);
  await expect(row(4)).toHaveAttribute("data-depth", "1");

  await page.getByTestId("ribbon-delete").click();
  await expect(page.getByTestId("task-row")).toHaveCount(4);

  // cada operação é um passo de desfazer (specs/editing-history)
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("task-row")).toHaveCount(5);

  /* --- as outras abas mostram seus grupos e executam ---------------------- */
  await page.getByTestId("ribbon-tab-recurso").click();
  await expect(page.getByTestId("ribbon-resources")).toBeVisible();
  await expect(page.getByTestId("ribbon-indent")).toHaveCount(0); // conteúdo trocou
  await page.getByTestId("ribbon-resources").click();
  await expect(page.getByTestId("resources-panel")).toBeVisible();
  await page.getByTestId("resources-close").click();

  await page.getByTestId("ribbon-tab-projeto").click();
  await expect(page.getByTestId("ribbon-baseline")).toBeVisible();
  await expect(page.getByTestId("import-open")).toBeVisible();
  await expect(page.getByTestId("export-json")).toBeVisible();
  await expect(page.getByTestId("export-csv")).toBeVisible();
  await expect(page.getByTestId("print-open")).toBeVisible();

  await page.getByTestId("ribbon-tab-ver").click();

  /* --- toggle do caminho crítico (ligado por padrão) ---------------------- */
  await expect(page.getByTestId("ribbon-critical")).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.locator('[data-testid="gantt-bar"][data-critical]').count(),
  ).toBeGreaterThan(0);
  expect(
    await page.locator('[data-testid="task-row"][data-critical]').count(),
  ).toBeGreaterThan(0);

  await page.getByTestId("ribbon-critical").click();
  await expect(page.getByTestId("ribbon-critical")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-testid="gantt-bar"][data-critical]')).toHaveCount(0);
  await expect(page.locator('[data-testid="task-row"][data-critical]')).toHaveCount(0);

  await page.getByTestId("ribbon-critical").click();
  await expect(page.locator('[data-testid="gantt-bar"][data-critical]').first()).toBeVisible();

  /* --- painéis pela aba Ver ---------------------------------------------- */
  await page.getByTestId("ribbon-filters").click();
  await expect(page.getByTestId("filters-panel")).toBeVisible();
  await page.getByTestId("filters-close").click();

  await page.getByTestId("ribbon-tab-formatar").click();
  await expect(page.getByTestId("ribbon-theme-dark")).toBeVisible();
  await page.getByTestId("ribbon-theme-dark").click();
  await page.getByTestId("profile-menu").click();
  await expect(page.getByTestId("theme-select")).toHaveValue("dark");
  await page.keyboard.press("Escape");

  // Clicar fora fecha o menu, então reabre para ler a densidade.
  await page.getByTestId("ribbon-density-compact").click();
  await page.getByTestId("profile-menu").click();
  await expect(page.getByTestId("density-select")).toHaveValue("compact");
  await page.keyboard.press("Escape");

  expect(errors).toEqual([]);
});
