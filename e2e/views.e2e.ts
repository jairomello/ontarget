import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Visões nomeadas e biblioteca global (specs/views-and-filters): trocar de
 * visão restaura colunas, filtros, layout e zoom; renomear/duplicar/excluir
 * funcionam; e um filtro salvo na biblioteca global fica disponível em
 * todos os projetos.
 */

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

/** Semeia tarefas planas (Alfa, Beta…) via sync, como nos demais E2E. */
async function seedTasks(
  request: APIRequestContext,
  projectId: string,
  names: string[],
): Promise<Record<string, string>> {
  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const ids: Record<string, string> = {};

  const tasks = names.map((name, index) => {
    const id = `${uid}-${index}`;
    ids[name] = id;
    return {
      id,
      projectId,
      parentId: null,
      outlineLevel: 0,
      outlineNumber: String(index + 1),
      sortOrder: index,
      name,
      start: MON + index * DAY,
      finish: MON + index * DAY,
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
    };
  });

  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);
  return ids;
}

test("visões nomeadas restauram colunas, filtros, layout e zoom", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectIdA = await createProject(request, `Visões E2E A ${Date.now()}`);
  const idsA = await seedTasks(request, projectIdA, ["Alfa", "Beta", "Gama"]);
  // O banco do E2E é compartilhado entre execuções e itens da biblioteca
  // global persistem: nomes únicos evitam colisão com execuções anteriores.
  const uid = Date.now().toString(36);
  const globalFilterName = `Filtro Beta global ${uid}`;
  const localFilterName = `Filtro Beta local ${uid}`;

  await page.goto(`/p/${projectIdA}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "3");

  const rowIds = async () =>
    page.locator('[data-testid="task-row"]').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.taskId ?? ""),
    );

  const viewRow = (name: string) =>
    page.locator(`[data-testid="view-row"][data-name="${name}"]`);
  const filterRow = (name: string) =>
    page.locator(`[data-testid="filter-lib-row"][data-name="${name}"]`);

  /* --- Visão A: gantt, sem Duração, filtro "beta", detalhes, zoom meses --- */
  await page.getByTestId("columns-toggle").click();
  await page.getByTestId("column-toggle-duration").uncheck();
  await page.getByTestId("columns-toggle").click();

  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("condition-new-field").selectOption("name");
  await page.getByTestId("condition-add").click();
  await page.getByTestId("condition-value").first().fill("beta");
  await expect.poll(rowIds).toEqual([idsA.Beta]);
  await page.getByTestId("filters-close").click();

  await page.getByTestId("details-toggle").click();
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("zoom-preset").selectOption("months");
  await expect(page.getByTestId("zoom-value")).toHaveText("12 px/dia");

  await page.getByTestId("views-toggle").click();
  await expect(page.getByTestId("views-panel")).toBeVisible();
  await page.getByTestId("view-name").fill("Visão Alfa");
  await page.getByTestId("view-scope").selectOption("project");
  await page.getByTestId("view-save").click();
  await expect(viewRow("Visão Alfa")).toHaveCount(1);
  await page.getByTestId("views-close").click();

  /* --- Visão B: tarefa, com Duração, sem filtro, sem detalhes, zoom dias -- */
  await page.getByTestId("view-select").selectOption("task_sheet");
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-view", "task_sheet");

  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("filter-clear").click();
  await page.getByTestId("filters-close").click();

  await page.getByTestId("details-toggle").click();
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("zoom-preset").selectOption("days");
  await expect(page.getByTestId("zoom-value")).toHaveText("150 px/dia");

  await page.getByTestId("views-toggle").click();
  await page.getByTestId("view-name").fill("Visão Beta");
  await page.getByTestId("view-scope").selectOption("project");
  await page.getByTestId("view-save").click();
  await expect(viewRow("Visão Beta")).toHaveCount(1);
  await page.getByTestId("views-close").click();

  /* --- trocar para Visão Alfa restaura tudo ------------------------------- */
  await page.getByTestId("views-toggle").click();
  await viewRow("Visão Alfa").getByTestId("view-apply").click();

  await expect(page.getByTestId("views-panel")).toHaveCount(0); // aplica e fecha
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-view", "gantt");
  await expect(page.getByTestId("header-duration")).toHaveCount(0); // coluna oculta
  await expect.poll(rowIds).toEqual([idsA.Beta]); // filtro restaurado
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("zoom-value")).toHaveText("12 px/dia");

  // o filtro restaurado aparece no painel de filtros
  await page.getByTestId("filters-toggle").click();
  await expect(page.getByTestId("condition-row")).toHaveCount(1);
  await expect(page.getByTestId("condition-value").first()).toHaveValue("beta");
  await page.getByTestId("filters-close").click();

  /* --- trocar para Visão Beta restaura o outro estado --------------------- */
  await page.getByTestId("views-toggle").click();
  await viewRow("Visão Beta").getByTestId("view-apply").click();

  await expect(page.getByTestId("workspace")).toHaveAttribute("data-view", "task_sheet");
  await expect(page.getByTestId("gantt-slot")).toHaveCount(0);
  await expect(page.getByTestId("header-duration")).toBeVisible(); // coluna de volta
  await expect.poll(rowIds).toEqual([idsA.Alfa, idsA.Beta, idsA.Gama]); // sem filtro
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("zoom-value")).toHaveText("150 px/dia");

  /* --- renomear, duplicar e excluir --------------------------------------- */
  await page.getByTestId("views-toggle").click();
  await viewRow("Visão Alfa").getByTestId("view-rename").click();
  await page.getByTestId("view-rename-input").fill("Visão Controle");
  await page.getByTestId("view-rename-confirm").click();
  await expect(viewRow("Visão Alfa")).toHaveCount(0);
  await expect(viewRow("Visão Controle")).toHaveCount(1);

  await viewRow("Visão Beta").getByTestId("view-duplicate").click();
  await expect(viewRow("Visão Beta (cópia)")).toHaveCount(1);
  await viewRow("Visão Beta (cópia)").getByTestId("view-delete").click();
  await expect(viewRow("Visão Beta (cópia)")).toHaveCount(0);
  await page.getByTestId("views-close").click();

  /* --- "Atualizar com o estado atual" grava a configuração corrente ------- */
  await page.getByTestId("zoom-preset").selectOption("years");
  await expect(page.getByTestId("zoom-value")).toHaveText("2 px/dia");
  await page.getByTestId("views-toggle").click();
  await viewRow("Visão Beta").getByTestId("view-update").click();
  await page.getByTestId("views-close").click();

  await page.getByTestId("zoom-preset").selectOption("days");
  await expect(page.getByTestId("zoom-value")).toHaveText("150 px/dia");
  await page.getByTestId("views-toggle").click();
  await viewRow("Visão Beta").getByTestId("view-apply").click();
  await expect(page.getByTestId("zoom-value")).toHaveText("2 px/dia"); // zoom atualizado

  /* --- biblioteca global: filtro disponível em todos os projetos ---------- */
  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("condition-new-field").selectOption("name");
  await page.getByTestId("condition-add").click();
  await page.getByTestId("condition-value").first().fill("beta");
  await page.getByTestId("filters-close").click();

  await page.getByTestId("views-toggle").click();
  await page.getByTestId("filter-lib-name").fill(globalFilterName);
  await page.getByTestId("filter-lib-scope").selectOption("global");
  await page.getByTestId("filter-lib-save").click();
  await expect(filterRow(globalFilterName)).toHaveCount(1);
  await expect(
    filterRow(globalFilterName).getByTestId("filter-lib-row-scope"),
  ).toHaveAttribute("data-scope", "global");

  await page.getByTestId("filter-lib-name").fill(localFilterName);
  await page.getByTestId("filter-lib-scope").selectOption("project");
  await page.getByTestId("filter-lib-save").click();
  await expect(filterRow(localFilterName)).toHaveCount(1);
  await expect(
    filterRow(localFilterName).getByTestId("filter-lib-row-scope"),
  ).toHaveAttribute("data-scope", "project");
  await page.getByTestId("views-close").click();

  // espera a persistência (debounce de 800 ms) antes de navegar
  const libraryNames = async () => {
    const body = (await (
      await request.get(`/api/projects/${projectIdA}`)
    ).json()) as { data: { libraryItems: Array<{ name: string }> } };
    return body.data.libraryItems.map((entry) => entry.name);
  };
  await expect.poll(libraryNames).toContain("Visão Controle");
  await expect.poll(libraryNames).toContain("Visão Beta");
  await expect.poll(libraryNames).toContain(globalFilterName);
  await expect.poll(libraryNames).toContain(localFilterName);

  /* --- em outro projeto, só o item global aparece e funciona -------------- */
  const projectIdB = await createProject(request, `Visões E2E B ${Date.now()}`);
  const idsB = await seedTasks(request, projectIdB, ["Alfa", "Beta"]);

  await page.goto(`/p/${projectIdB}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "2");

  await page.getByTestId("views-toggle").click();
  await expect(page.getByTestId("view-row")).toHaveCount(0); // visões são do projeto A
  await expect(filterRow(localFilterName)).toHaveCount(0); // filtro local não passa
  await expect(filterRow(globalFilterName)).toHaveCount(1); // global sim

  await filterRow(globalFilterName).getByTestId("filter-lib-apply").click();
  await expect(page.getByTestId("views-panel")).toHaveCount(0);
  await expect.poll(rowIds).toEqual([idsB.Beta]); // o filtro vale aqui também

  /* --- de volta ao projeto A: tudo persistido ----------------------------- */
  await page.goto(`/p/${projectIdA}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "3");

  await page.getByTestId("views-toggle").click();
  await expect(page.getByTestId("view-row")).toHaveCount(2);
  await expect(viewRow("Visão Controle")).toHaveCount(1);
  await expect(viewRow("Visão Beta")).toHaveCount(1);
  // filtrado por nome: a biblioteca global acumula itens de outras execuções
  await expect(filterRow(globalFilterName)).toHaveCount(1);
  await expect(filterRow(localFilterName)).toHaveCount(1);

  expect(errors).toEqual([]);
});
