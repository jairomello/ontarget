import { expect, test, type APIRequestContext } from "@playwright/test";
import { visibleRows } from "../packages/core/src/views/visibleRows";

/** Monta as entradas de `visibleRows` a partir do aggregate da API. */
async function visibleCount(
  request: APIRequestContext,
  projectId: string,
  collapsed: Record<string, boolean> = {},
): Promise<number> {
  const response = await request.get(`/api/projects/${projectId}`);
  expect(response.ok()).toBe(true);
  const detail = (await response.json()) as {
    data: {
      tasks: Array<{ id: string; parentId: string | null; isSummary: boolean }>;
    };
  };

  const tasks = detail.data.tasks;
  const parents: Record<string, string | null> = {};
  const summaries: Record<string, boolean> = {};
  for (const task of tasks) {
    parents[task.id] = task.parentId;
    summaries[task.id] = task.isSummary;
  }

  return visibleRows({
    order: tasks.map((task) => task.id),
    parents,
    summaries,
    collapsed,
  }).length;
}

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "entrega-software" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

/**
 * Divisor entre a grade e o Gantt (specs/task-sheet — "Layout dividido"):
 * arrastável, ajustável pelo teclado, com duplo clique para o padrão e
 * a largura lembrada entre sessões.
 */
test("o divisor entre a grade e o Gantt é arrastável e lembrado", async ({
  page,
  request,
}) => {
  const projectId = await createProject(request, `Divisor E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);

  // começa do estado automático, sem o que sessões anteriores deixaram
  await page.evaluate(() => localStorage.removeItem("ontarget.layout"));
  await page.reload();

  const splitter = page.getByTestId("workspace-splitter");
  const sheet = page.locator('section[aria-label="Task Sheet"]');
  await expect(splitter).toBeVisible();
  await expect(splitter).toHaveAttribute("role", "separator");
  await expect(splitter).toHaveAttribute("aria-orientation", "vertical");

  const widthOf = async () => Math.round((await sheet.boundingBox())!.width);
  const auto = await widthOf();

  // arraste: a grade cresce na proporção do movimento
  const box = (await splitter.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + 200, { steps: 10 });
  await page.mouse.up();

  const dragged = await widthOf();
  expect(dragged).toBeGreaterThan(auto + 60);

  // a largura sobrevive ao recarregamento
  await page.reload();
  await expect(splitter).toBeVisible();
  expect(await widthOf()).toBe(dragged);

  // duplo clique devolve a divisão automática
  await splitter.dblclick();
  expect(Math.abs((await widthOf()) - auto)).toBeLessThan(4);

  // teclado: uma seta move, Home/Eend levam aos limites
  await splitter.focus();
  await page.keyboard.press("ArrowLeft");
  expect(await widthOf()).toBeLessThan(auto);
  await page.keyboard.press("Home");
  expect(await widthOf()).toBe(340);
  await page.keyboard.press("End");
  const max = (await page.getByTestId("workspace").boundingBox())!.width - 320;
  expect(Math.abs((await widthOf()) - Math.round(max))).toBeLessThan(4);
});

/**
 * Task Sheet (specs/task-sheet): as linhas renderizadas são exatamente as
 * devolvidas por `visibleRows` — a fonte única compartilhada com o Gantt.
 */
test("a grade renderiza exatamente as linhas de visibleRows", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Grade E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);

  await expect(page.getByTestId("task-sheet")).toBeVisible();

  // cabeçalho fixo com as colunas padrão
  await expect(page.getByRole("columnheader", { name: "WBS" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Nome da tarefa" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Duração" })).toBeVisible();

  const rows = page.getByTestId("task-row");

  // 1) todas as linhas visíveis (nada recolhido)
  const expectedExpanded = await visibleCount(request, projectId);
  expect(expectedExpanded).toBe(12);
  await expect(rows).toHaveCount(expectedExpanded);

  // 2) recolher um resumo → a grade esconde os descendentes
  const detail = await (await request.get(`/api/projects/${projectId}`)).json();
  const summary = detail.data.tasks.find((task: { isSummary: boolean }) => task.isSummary);
  expect(summary).toBeTruthy();

  const toggle = page.locator(
    `[data-testid="task-row"][data-task-id="${summary.id}"] [data-testid="row-toggle"]`,
  );
  await toggle.click();

  const expectedCollapsed = await visibleCount(request, projectId, { [summary.id]: true });
  expect(expectedCollapsed).toBe(expectedExpanded - 2);
  await expect(rows).toHaveCount(expectedCollapsed);

  // o nó recolhido informa quantos descendentes estão ocultos
  const summaryRow = page.locator(`[data-testid="task-row"][data-task-id="${summary.id}"]`);
  await expect(summaryRow.getByTestId("hidden-count")).toHaveText("+2");

  // 3) expandir de volta restaura a contagem
  await toggle.click();
  await expect(rows).toHaveCount(expectedExpanded);

  expect(errors).toEqual([]);
});
