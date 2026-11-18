import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Linhas de base e planos provisórios (specs/tracking): salvar com escopo de
 * projeto e por seleção, persistir, listar e remover (specs/tracking —
 * "Linhas de base múltiplas" e "Planos provisórios").
 */

interface Detail {
  data: {
    baselines: Array<{ id: string; name: string; kind: string; scope: string }>;
    baselineValues: Array<{
      baselineId: string;
      taskId: string;
      start: number | null;
      duration: number | null;
    }>;
  };
}

async function detail(request: APIRequestContext, projectId: string): Promise<Detail> {
  return (await (await request.get(`/api/projects/${projectId}`)).json()) as Detail;
}

test("salvar baseline por projeto e por seleção, persistir e remover", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const created = await request.post("/api/projects", {
    data: { name: `Baselines E2E ${Date.now()}`, templateKey: "vazio" },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const projectId = project.id;

  const now = Date.now();
  const uid = Date.now().toString(36);
  const start = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const tasks = [0, 1, 2].map((index) => ({
    id: `${uid}-t${index}`,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name: `Tarefa ${index + 1}`,
    start: start + index * DAY,
    finish: start + index * DAY,
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
  }));

  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "3");

  // seleciona a linha ANTES de abrir o modal (o painel cobre a grade)
  await page.getByTestId("task-row").nth(1).locator('[data-testid="cell-name"]').click();

  await page.getByTestId("baseline-toggle").click();
  await expect(page.getByTestId("baselines-panel")).toBeVisible();
  await expect(page.getByTestId("baselines-empty")).toBeVisible();

  // --- salvar do projeto inteiro --------------------------------------------
  await page.getByTestId("baseline-name").fill("Baseline 1");
  await page.getByTestId("baseline-save").click();

  const rows = page.getByTestId("baseline-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Baseline 1");
  await expect(rows.first()).toContainText("Linha de base");
  await expect(rows.first()).toContainText("3 tarefas");

  // --- seleção de 1 tarefa + plano provisório --------------------------------
  await page.getByTestId("baseline-name").fill("Plano X");
  await page.getByTestId("baseline-kind").selectOption({ label: "Plano provisório" });
  await page.getByTestId("baseline-scope").selectOption({ index: 1 }); // Seleção atual (1)
  await page.getByTestId("baseline-save").click();

  await expect(rows).toHaveCount(2);
  const interimRow = rows.filter({ hasText: "Plano X" });
  await expect(interimRow).toContainText("Plano provisório");
  await expect(interimRow).toContainText("1 tarefas");
  await expect(interimRow).toContainText("Seleção");

  // --- persistência (lote de sync) -------------------------------------------
  await expect
    .poll(async () => (await detail(request, projectId)).data.baselines.length)
    .toBe(2);

  const after = await detail(request, projectId);
  const first = after.data.baselines.find((b) => b.name === "Baseline 1")!;
  const interim = after.data.baselines.find((b) => b.name === "Plano X")!;
  expect(first).toMatchObject({ kind: "baseline", scope: "project" });
  expect(interim).toMatchObject({ kind: "interim", scope: "selection" });

  const firstValues = after.data.baselineValues.filter((v) => v.baselineId === first.id);
  const interimValues = after.data.baselineValues.filter((v) => v.baselineId === interim.id);
  expect(firstValues).toHaveLength(3);
  expect(interimValues).toHaveLength(1);
  // o valor fotografa o estado atual da tarefa
  expect(firstValues.find((v) => v.taskId === tasks[0]!.id)).toMatchObject({
    start: start,
    duration: WORKDAY,
  });

  // --- recarrega: tudo restaurado pelo aggregate ------------------------------
  await page.reload();
  await expect(page.getByTestId("task-sheet")).toBeVisible();
  await page.getByTestId("baseline-toggle").click();
  await expect(page.getByTestId("baseline-row")).toHaveCount(2);

  // --- remover ----------------------------------------------------------------
  await page
    .getByTestId("baseline-row")
    .filter({ hasText: "Plano X" })
    .getByTestId("baseline-remove")
    .click();
  await expect(page.getByTestId("baseline-row")).toHaveCount(1);

  await expect
    .poll(async () => (await detail(request, projectId)).data.baselines.length)
    .toBe(1);
  const emptied = await detail(request, projectId);
  const survivor = emptied.data.baselines[0]!;
  expect(survivor.name).toBe("Baseline 1");
  // os valores do plano removido sumiram junto (cascata por chave composta)
  expect(emptied.data.baselineValues.filter((v) => v.baselineId === survivor.id)).toHaveLength(3);
  expect(emptied.data.baselineValues.filter((v) => v.baselineId !== survivor.id)).toHaveLength(0);

  expect(errors).toEqual([]);
});
