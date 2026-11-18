import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Três caminhos de criação de vínculo (specs/task-dependencies — "Criação de
 * vínculo por interface"): coluna de predecessores, formulário e Gantt devem
 * gerar o mesmo registro determinístico e refletir na grade.
 */

const DAY = 86_400_000;
const WORKDAY = 9 * 60 * 60 * 1000;

interface SeedResult {
  projectId: string;
  ids: { a: string; b: string; c: string };
}

async function seed(request: APIRequestContext): Promise<SeedResult> {
  const created = await request.post("/api/projects", {
    data: { name: `Vínculos E2E ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const uid = Date.now().toString(36);
  const ids = { a: `${uid}-a`, b: `${uid}-b`, c: `${uid}-c` };
  const now = Date.now();
  const start = Date.UTC(2026, 0, 5); // segunda-feira fixa

  const base = (index: number, key: string, name: string) => ({
    id: key,
    projectId: project.id,
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

  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: {
      upserts: {
        tasks: [base(0, ids.a, "Tarefa A"), base(1, ids.b, "Tarefa B"), base(2, ids.c, "Tarefa C")],
      },
    },
  });
  expect(synced.status()).toBe(200);
  return { projectId: project.id, ids };
}

async function linkIds(request: APIRequestContext, projectId: string): Promise<string[]> {
  const body = (await (await request.get(`/api/projects/${projectId}`)).json()) as {
    data: { taskLinks: Array<{ id: string }> };
  };
  return body.data.taskLinks.map((link) => link.id).sort();
}

/** Registro completo de um vínculo (tipo, latência). */
async function linkOf(
  request: APIRequestContext,
  projectId: string,
  linkId: string,
): Promise<{ type: string; lagMs: number } | undefined> {
  const body = (await (await request.get(`/api/projects/${projectId}`)).json()) as {
    data: { taskLinks: Array<{ id: string; type: string; lagMs: number }> };
  };
  return body.data.taskLinks.find((link) => link.id === linkId);
}

const barOf = (page: Page, id: string) =>
  page.locator(`[data-testid="gantt-bar"][data-task-id="${id}"]`);

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("coluna, formulário e Gantt geram o mesmo registro de vínculo", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const { projectId, ids } = await seed(request);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("task-row")).toHaveCount(3);

  const rowOf = (index: number) => page.getByTestId("task-row").nth(index);

  // --- caminho 1: coluna de predecessores ---------------------------------
  await rowOf(1).locator('[data-testid="cell-pred"]').dblclick();
  const editor = page.getByTestId("cell-editor");
  await editor.fill("1");
  await editor.press("Enter");
  await expect(rowOf(1).locator('[data-testid="cell-pred"]')).toHaveText("1");

  await expect
    .poll(() => linkIds(request, projectId))
    .toContain(`link:${ids.a}:${ids.b}:fs`);

  // --- caminho 2: formulário de detalhes -----------------------------------
  await rowOf(2).locator('[data-testid="cell-name"]').click();
  await page.keyboard.press("F4");
  await expect(page.getByTestId("task-form")).toBeVisible();
  await page.getByTestId("form-predecessors").fill("1");
  await page.getByTestId("form-predecessors").press("Tab");

  await expect(rowOf(2).locator('[data-testid="cell-pred"]')).toHaveText("1");
  await expect
    .poll(() => linkIds(request, projectId))
    .toContain(`link:${ids.a}:${ids.c}:fs`);

  // --- caminho 3: arraste no Gantt -----------------------------------------
  const source = await barOf(page, ids.b).boundingBox();
  const handle = await barOf(page, ids.b).getByTestId("link-handle").boundingBox();
  const target = await barOf(page, ids.c).boundingBox();
  expect(source).not.toBeNull();
  expect(handle).not.toBeNull();
  expect(target).not.toBeNull();

  await drag(
    page,
    { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 },
    { x: target!.x + target!.width / 2, y: target!.y + target!.height / 2 },
  );

  await expect
    .poll(() => linkIds(request, projectId))
    .toContain(`link:${ids.b}:${ids.c}:fs`);

  // a criação pelo Gantt atualiza a coluna da grade (C: "1, 2")
  await expect(rowOf(2).locator('[data-testid="cell-pred"]')).toHaveText("1, 2");

  // --- remoção pelo formulário altera a grade -------------------------------
  await page.getByTestId("form-predecessors").fill("2");
  await page.getByTestId("form-predecessors").press("Tab");

  await expect(rowOf(2).locator('[data-testid="cell-pred"]')).toHaveText("2");
  await expect
    .poll(() => linkIds(request, projectId))
    .toEqual([`link:${ids.a}:${ids.b}:fs`, `link:${ids.b}:${ids.c}:fs`].sort());

  // --- recusa na coluna: nada muda e o motivo aparece ----------------------
  await rowOf(1).locator('[data-testid="cell-pred"]').dblclick();
  await page.getByTestId("cell-editor").fill("9");
  await page.getByTestId("cell-editor").press("Enter");
  await expect(page.getByTestId("sheet-notice")).toContainText("Predecessor não encontrado: 9");
  await expect(rowOf(1).locator('[data-testid="cell-pred"]')).toHaveText("1");

  // --- recusa no formulário (reseleciona C: o duplo-clique anterior mudou a seleção)
  await rowOf(2).locator('[data-testid="cell-name"]').click();
  await expect(page.getByTestId("form-predecessors")).toHaveValue("2");
  await page.getByTestId("form-predecessors").fill("9");
  await page.getByTestId("form-predecessors").press("Tab");
  await expect(page.getByTestId("form-predecessors-error")).toContainText(
    "Predecessor não encontrado: 9",
  );
  // nada foi alterado pela recusa
  await expect(page.getByTestId("form-predecessors")).toHaveValue("2");
  await expect
    .poll(() => linkIds(request, projectId))
    .toEqual([`link:${ids.a}:${ids.b}:fs`, `link:${ids.b}:${ids.c}:fs`].sort());

  expect(errors).toEqual([]);
});

/**
 * Tipo e latência pelo sufixo no código WBS (padrão MS Project):
 * `1SS`, `1FF+2d` — usados na coluna da grade e no formulário de detalhes.
 */
test("o campo de predecessores aceita tipo e latência por sufixo", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const { projectId, ids } = await seed(request);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("task-row")).toHaveCount(3);

  const cell = page.getByTestId("task-row").nth(1).locator('[data-testid="cell-pred"]');

  // --- Início-Início com latência ----------------------------------------
  await cell.dblclick();
  await page.getByTestId("cell-editor").fill("1SS+2d");
  await page.getByTestId("cell-editor").press("Enter");

  await expect(cell).toHaveText("1SS+2d");
  await expect
    .poll(() => linkIds(request, projectId))
    .toContain(`link:${ids.a}:${ids.b}:ss`);

  const detail = await linkOf(request, projectId, `link:${ids.a}:${ids.b}:ss`);
  expect(detail).toMatchObject({ type: "ss", lagMs: 2 * DAY });

  // --- trocar o tipo recria o vínculo (o id leva o tipo) -------------------
  await cell.dblclick();
  await page.getByTestId("cell-editor").fill("1FF");
  await page.getByTestId("cell-editor").press("Enter");

  await expect(cell).toHaveText("1FF");
  await expect.poll(() => linkIds(request, projectId)).toEqual([
    `link:${ids.a}:${ids.b}:ff`,
  ]);

  // --- tipo inválido é recusado com o motivo e nada muda -------------------
  await cell.dblclick();
  await page.getByTestId("cell-editor").fill("1XX");
  await page.getByTestId("cell-editor").press("Enter");

  await expect(page.getByTestId("sheet-notice")).toContainText("Tipo de vínculo inválido");
  await expect(cell).toHaveText("1FF");

  expect(errors).toEqual([]);
});
