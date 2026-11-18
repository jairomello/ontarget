import { expect, test, type APIRequestContext } from "@playwright/test";

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "entrega-software" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

/**
 * Escopo de foco e rolagem compartilhada (specs/gantt-view "Escopo de foco"
 * + specs/task-sheet "sincronia"): `+` recolhe na grade e amplia no Gantt.
 */
test("+ recolhe a hierarquia na grade e amplia o zoom no Gantt", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Foco E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("gantt")).toBeVisible();

  const rows = page.getByTestId("task-row");
  const gantt = page.getByTestId("gantt");
  const expandedCount = await rows.count();

  // --- foco na Task Sheet: `+` recolhe ------------------------------------
  await page.getByTestId("task-sheet-scroll").click();
  await expect(page.getByTestId("status-focus")).toContainText("Task Sheet");

  await rows.first().click();
  await page.keyboard.press("+");

  const collapsedCount = await rows.count();
  expect(collapsedCount).toBeLessThan(expandedCount);
  const zoomAfterCollapse = await gantt.getAttribute("data-zoom");
  expect(zoomAfterCollapse).toBe("26"); // zoom intacto

  await page.keyboard.press("+");
  await expect(rows).toHaveCount(expandedCount);

  // --- foco no Gantt: `+` amplia ------------------------------------------
  await gantt.click();
  await expect(page.getByTestId("status-focus")).toContainText("Gantt");

  const zoomBefore = Number(await gantt.getAttribute("data-zoom"));
  await page.keyboard.press("+");
  await expect
    .poll(async () => Number(await gantt.getAttribute("data-zoom")))
    .toBeGreaterThan(zoomBefore);

  const rowsAfterZoom = await rows.count();
  expect(rowsAfterZoom).toBe(expandedCount); // hierarquia intacta

  // --- F6 alterna o escopo -------------------------------------------------
  await page.keyboard.press("F6");
  await expect(page.getByTestId("status-focus")).toContainText("Task Sheet");
  await page.keyboard.press("F6");
  await expect(page.getByTestId("status-focus")).toContainText("Gantt");

  expect(errors).toEqual([]);
});

test("a rolagem vertical é compartilhada entre os painéis", async ({ page, request }) => {
  const projectId = await createProject(request, `Rolagem E2E ${Date.now()}`);

  // semeia tarefas suficientes para exigir rolagem
  const detail = await (await request.get(`/api/projects/${projectId}`)).json();
  const startBase = Date.now();
  const now = Date.now();
  const extra = Array.from({ length: 60 }, (_, index) => ({
    id: `scroll-${now}-${index}`,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 10),
    sortOrder: index + 100,
    name: `Extra ${index + 1}`,
    start: startBase + index * 86_400_000,
    finish: startBase + index * 86_400_000, // conv. inclusive: 1 dia
    duration: 8 * 60 * 60 * 1000,
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
  }));
  expect(detail.data.tasks.length).toBeGreaterThan(0);
  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: { upserts: { tasks: extra } },
  });
  expect(synced.status()).toBe(200);

  await page.goto(`/p/${projectId}`);

  const rows = page.getByTestId("task-row");
  await expect(rows.first()).toBeVisible();

  const firstBefore = await rows.first().getAttribute("data-task-id");

  // rola o Gantt → a Task Sheet acompanha
  await page.getByTestId("gantt").evaluate((node) => {
    node.scrollTop = 300;
  });
  await expect.poll(async () => rows.first().getAttribute("data-task-id")).not.toBe(firstBefore);

  const firstAfterGantt = await rows.first().getAttribute("data-task-id");

  // rola a Task Sheet → o Gantt acompanha (mesma linha superior)
  await page.getByTestId("task-sheet-scroll").evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect.poll(async () => rows.first().getAttribute("data-task-id")).not.toBe(firstAfterGantt);

  // e a linha inicial volta a ser a primeira
  await expect(rows.first()).toHaveAttribute("data-task-id", firstBefore!);

  // as duas linhas visíveis mais altas coincidem nos dois painéis
  const sheetTop = await rows.first().getAttribute("data-task-id");
  const ganttBars = page.getByTestId("gantt-bar");
  expect(await ganttBars.count()).toBeGreaterThan(0);
  expect(sheetTop).toBeTruthy();
});
