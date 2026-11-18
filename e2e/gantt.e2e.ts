import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const WORKDAY = 9 * 60 * 60 * 1000; // turno padrão 09:00–18:00
const TASK_COUNT = 60;

async function seed(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/projects", {
    data: { name: `Gantt E2E ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const today = new Date();
  const start0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 10 * DAY;
  const now = Date.now();

  const uid = Date.now().toString(36);
  const tasks = Array.from({ length: TASK_COUNT }, (_, index) => {
    const start = start0 + index * 5 * DAY;
    return {
      id: `${uid}-t${index}`,
      projectId: project.id,
      parentId: null,
      outlineLevel: 0,
      outlineNumber: String(index + 1),
      sortOrder: index,
      name: `Tarefa ${index + 1}`,
      start,
      finish: start + 4 * DAY,
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
    };
  });

  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);
  return project.id;
}

/**
 * Gantt com virtualização em duas dimensões (specs/gantt-view):
 * só linhas e datas visíveis entram no DOM.
 */
test("o Gantt renderiza apenas linhas e datas visíveis", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await seed(request);
  await page.goto(`/p/${projectId}`);

  const gantt = page.getByTestId("gantt");
  await expect(gantt).toBeVisible();
  await expect(page.getByTestId("gantt-header")).toBeVisible();
  await expect(page.getByTestId("gantt-band-month")).toBeVisible();

  // --- virtualização vertical --------------------------------------------
  const rows = page.getByTestId("task-row");
  const renderedRows = await rows.count();
  expect(renderedRows).toBeGreaterThan(5);
  expect(renderedRows).toBeLessThan(TASK_COUNT);

  // --- barras: linhas visíveis E datas visíveis ---------------------------
  const bars = page.getByTestId("gantt-bar");
  const renderedBars = await bars.count();
  expect(renderedBars).toBeGreaterThan(0);
  expect(renderedBars).toBeLessThanOrEqual(renderedRows);
  expect(renderedBars).toBeLessThan(TASK_COUNT);

  const beforeIds = await bars.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-task-id")),
  );

  // --- rolagem horizontal troca as barras do intervalo --------------------
  await gantt.evaluate((node) => {
    node.scrollLeft = 2_500;
  });
  await expect
    .poll(async () => bars.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-task-id"))))
    .not.toEqual(beforeIds);

  const afterHorizontal = await bars.count();
  expect(afterHorizontal).toBeLessThan(TASK_COUNT);

  // --- rolagem vertical sincroniza a Task Sheet ---------------------------
  const firstRowBefore = await rows.first().getAttribute("data-task-id");
  await gantt.evaluate((node) => {
    node.scrollTop = 600;
  });

  await expect
    .poll(async () => rows.first().getAttribute("data-task-id"))
    .not.toBe(firstRowBefore);

  // --- tempo não útil e linha de hoje presentes ---------------------------
  await expect(page.getByTestId("gantt-nonworking")).toBeVisible();
  await expect(page.getByTestId("today-line")).toBeVisible();

  // --- zoom muda a densidade das barras ----------------------------------
  const zoomBefore = await gantt.getAttribute("data-zoom");
  await page.getByTestId("gantt").focus();
  await page.keyboard.press("-");
  await expect(gantt).not.toHaveAttribute("data-zoom", zoomBefore ?? "");

  expect(errors).toEqual([]);
});
