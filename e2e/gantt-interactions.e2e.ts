import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const WORKDAY = 8 * 60 * 60 * 1000;

interface TaskSeed {
  id: string;
  projectId: string;
  parentId: string | null;
  sortOrder: number;
  outlineLevel: number;
  outlineNumber: string;
  name: string;
  start: number;
  finish: number;
  duration: number;
  durationUnit: string;
  percentComplete: number;
  isSummary: boolean;
  isMilestone: boolean;
  isInactive: boolean;
  schedulingMode: string;
  taskType: string;
  effortDriven: boolean;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

async function seed(request: APIRequestContext) {
  const created = await request.post("/api/projects", {
    data: { name: `Interações E2E ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const uid = Date.now().toString(36);
  const ids = { A: `${uid}-A`, A1: `${uid}-A1`, B: `${uid}-B`, C: `${uid}-C` };
  const base = Date.now() - 30 * DAY;
  const now = Date.now();

  const make = (
    key: keyof typeof ids,
    offsetDays: number,
    options: Partial<TaskSeed> = {},
  ): TaskSeed => {
    const start = base + offsetDays * DAY;
    return {
      id: ids[key],
      projectId: project.id,
      parentId: null,
      sortOrder: 0,
      outlineLevel: 0,
      outlineNumber: "1",
      name: `Tarefa ${key}`,
      start,
      finish: start + 4 * DAY, // conv. inclusive: 5 dias (0..4)
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
      ...options,
    };
  };

  const tasks: TaskSeed[] = [
    make("A", 0, {
      parentId: null,
      isSummary: true,
      sortOrder: 0,
      outlineNumber: "1",
      name: "Tarefa A",
    }),
    make("A1", 6, {
      parentId: ids.A,
      outlineLevel: 1,
      outlineNumber: "1.1",
      sortOrder: 1,
      name: "Tarefa A1",
    }),
    make("B", 12, {
      parentId: null,
      sortOrder: 2,
      outlineNumber: "2",
      name: "Tarefa B",
    }),
    make("C", 18, {
      parentId: null,
      sortOrder: 3,
      outlineNumber: "3",
      name: "Tarefa C",
    }),
  ];

  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);

  return { projectId: project.id, ids };
}

async function taskOf(
  request: APIRequestContext,
  projectId: string,
  taskId: string,
): Promise<Record<string, any>> {
  const body = (await (await request.get(`/api/projects/${projectId}`)).json()) as {
    data: { tasks: Array<Record<string, any>> };
  };
  return body.data.tasks.find((task) => task.id === taskId)!;
}

/** A gravação é em lote (debounce de 800 ms): espera o estado chegar ao servidor. */
async function pollTask(
  request: APIRequestContext,
  projectId: string,
  taskId: string,
  predicate: (task: Record<string, any>) => boolean,
): Promise<void> {
  await expect
    .poll(async () => predicate(await taskOf(request, projectId, taskId)), { timeout: 8_000 })
    .toBe(true);
}

const barOf = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`[data-testid="gantt-bar"][data-task-id="${id}"]`);

async function drag(
  page: import("@playwright/test").Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** Garante que o elemento está dentro da área visível do Gantt. */
async function visibleBox(
  locator: ReturnType<typeof barOf>,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function handleBox(bar: ReturnType<typeof barOf>) {
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.getByTestId("link-handle").boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/**
 * Interações do Gantt (specs/gantt-view): criar vínculo, recusar vínculo
 * inválido e a escolha oferecida ao arrastar tarefa automática.
 */
test("criar vínculo válido e recusar vínculo inválido", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const { projectId, ids } = await seed(request);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("gantt")).toBeVisible();

  const links = page.getByTestId("gantt-link");
  await expect(links).toHaveCount(0);

  // --- inválido: descendente (A → A1) -------------------------------------
  const sourceBox = await visibleBox(barOf(page, ids.A));
  const handleBoxA = await handleBox(barOf(page, ids.A));
  const targetBox = await visibleBox(barOf(page, ids.A1));

  await drag(
    page,
    { x: handleBoxA.x + handleBoxA.width / 2, y: handleBoxA.y + handleBoxA.height / 2 },
    { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
  );

  await expect(barOf(page, ids.A1)).toHaveAttribute("data-shake", "true");
  await expect(links).toHaveCount(0);

  // --- válido: B → C -------------------------------------------------------
  const sourceB = await visibleBox(barOf(page, ids.B));
  const handleB = await handleBox(barOf(page, ids.B));
  const targetC = await visibleBox(barOf(page, ids.C));

  await drag(
    page,
    { x: handleB.x + handleB.width / 2, y: handleB.y + handleB.height / 2 },
    { x: targetC.x + targetC.width / 2, y: targetC.y + targetC.height / 2 },
  );

  await expect(links).toHaveCount(1);

  // --- duplicata: B → C de novo -------------------------------------------
  const handleB2 = await handleBox(barOf(page, ids.B));
  const targetC2 = await visibleBox(barOf(page, ids.C));

  await drag(
    page,
    { x: handleB2.x + handleB2.width / 2, y: handleB2.y + handleB2.height / 2 },
    { x: targetC2.x + targetC2.width / 2, y: targetC2.y + targetC2.height / 2 },
  );

  await expect(links).toHaveCount(1);

  // --- ciclo: C → B --------------------------------------------------------
  const handleC = await handleBox(barOf(page, ids.C));
  const targetB = await visibleBox(barOf(page, ids.B));

  await drag(
    page,
    { x: handleC.x + handleC.width / 2, y: handleC.y + handleC.height / 2 },
    { x: targetB.x + targetB.width / 2, y: targetB.y + targetB.height / 2 },
  );

  await expect(links).toHaveCount(1);
  await expect(barOf(page, ids.B)).toHaveAttribute("data-shake", "true");

  expect(errors).toEqual([]);
});

test("arrastar tarefa automática oferece escolha antes de alterar", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const { projectId, ids } = await seed(request);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("gantt")).toBeVisible();

  // --- opção "converter para manual" --------------------------------------
  const boxC = await visibleBox(barOf(page, ids.C));
  await drag(
    page,
    { x: boxC.x + boxC.width / 2, y: boxC.y + boxC.height / 2 },
    { x: boxC.x + boxC.width / 2 + 96, y: boxC.y + boxC.height / 2 },
  );

  const choice = page.getByTestId("schedule-choice");
  await expect(choice).toBeVisible();

  // nada foi alterado enquanto a escolha não é feita
  expect((await taskOf(request, projectId, ids.C)).schedulingMode).toBe("auto");

  await page.getByTestId("choice-manual").click();
  await expect(choice).toHaveCount(0);

  await pollTask(request, projectId, ids.C, (task) => task.schedulingMode === "manual");
  expect((await taskOf(request, projectId, ids.C)).manualStart).not.toBeNull();

  // --- opção "manter automático" ------------------------------------------
  const boxB = await visibleBox(barOf(page, ids.B));
  await drag(
    page,
    { x: boxB.x + boxB.width / 2, y: boxB.y + boxB.height / 2 },
    { x: boxB.x + boxB.width / 2 + 120, y: boxB.y + boxB.height / 2 },
  );

  await expect(page.getByTestId("schedule-choice")).toBeVisible();
  await page.getByTestId("choice-auto").click();

  await pollTask(request, projectId, ids.B, (task) => task.constraintType === "snet");
  const taskB = await taskOf(request, projectId, ids.B);
  expect(taskB.schedulingMode).toBe("auto");
  expect(taskB.constraintDate).not.toBeNull();

  // --- cancelar ------------------------------------------------------------
  const boxA1 = await visibleBox(barOf(page, ids.A1));
  await drag(
    page,
    { x: boxA1.x + boxA1.width / 2, y: boxA1.y + boxA1.height / 2 },
    { x: boxA1.x + boxA1.width / 2 + 60, y: boxA1.y + boxA1.height / 2 },
  );

  await expect(page.getByTestId("schedule-choice")).toBeVisible();
  await page.getByTestId("choice-cancel").click();
  await expect(page.getByTestId("schedule-choice")).toHaveCount(0);

  const taskA1 = await taskOf(request, projectId, ids.A1);
  expect(taskA1.schedulingMode).toBe("auto");
  expect(taskA1.constraintType).toBeNull();

  expect(errors).toEqual([]);
});

test("menu de contexto no Gantt executa ações", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const { projectId, ids } = await seed(request);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("gantt")).toBeVisible();

  await barOf(page, ids.B).click({ button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("menu-details")).toBeVisible();
  await expect(page.getByTestId("menu-inactive")).toBeVisible();

  // inativar pela tarefa mantém a barra visível, mas sai do cálculo
  await page.getByTestId("menu-inactive").click();
  await expect(menu).toHaveCount(0);

  await pollTask(request, projectId, ids.B, (task) => task.isInactive === true);

  // abrir detalhes pelo menu
  await barOf(page, ids.C).click({ button: "right" });
  await page.getByTestId("menu-details").click();
  await expect(page.getByTestId("task-form")).toBeVisible();

  expect(errors).toEqual([]);
});
