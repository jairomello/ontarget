import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Filtros, ordenação múltipla e agrupamento com sumário
 * (specs/views-and-filters): combinadores E/OU, estado vazio mantendo o
 * filtro ativo (na grade e no Gantt), ordenação de irmãos com a hierarquia
 * preservada e cabeçalhos de grupo com contagem e soma de trabalho.
 */

interface Detail {
  data: {
    tasks: Array<{ id: string; sortOrder: number; duration: number; work: number | null }>;
  };
}

async function detail(request: APIRequestContext, projectId: string): Promise<Detail> {
  return (await (await request.get(`/api/projects/${projectId}`)).json()) as Detail;
}

test("filtros E/OU, estado vazio, ordenação e agrupamento", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const created = await request.post("/api/projects", {
    data: { name: `Consulta E2E ${Date.now()}`, templateKey: "vazio" },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const projectId = project.id;

  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5); // segunda-feira fixa

  const ids = {
    root: `${uid}-root`,
    a: `${uid}-a`,
    b: `${uid}-b`,
    c: `${uid}-c`,
    ana: `${uid}-ana`,
  };

  const task = (
    id: string,
    name: string,
    index: number,
    patch: Record<string, unknown>,
  ) => ({
    id,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    start: MON,
    finish: MON,
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
    ...patch,
  });

  const summary = task(ids.root, "Projeto", 0, {
    isSummary: true,
    start: MON,
    finish: MON + 5 * DAY,
    duration: 7 * WORKDAY,
    outlineNumber: "1",
    outlineLevel: 0,
  });
  const sub = (
    id: string,
    name: string,
    sortOrder: number,
    outline: string,
    start: number,
    finish: number,
    duration: number,
    work: number,
    patch: Record<string, unknown> = {},
  ) =>
    task(id, name, sortOrder, {
      parentId: ids.root,
      outlineLevel: 1,
      outlineNumber: outline,
      start,
      finish,
      duration,
      work,
      ...patch,
    });

  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [
          summary,
          // irmãos com durações diferentes (1d, 2d, 3d) para a ordenação
          sub(ids.a, "Alfa", 1, "1.1", MON, MON, 1 * WORKDAY, 1 * WORKDAY),
          sub(ids.b, "Beta", 2, "1.2", MON + DAY, MON + DAY, 2 * WORKDAY, 2 * WORKDAY, {
            isMilestone: false,
          }),
          sub(ids.c, "Gama", 3, "1.3", MON + 2 * DAY, MON + 4 * DAY, 3 * WORKDAY, 3 * WORKDAY),
        ],
        resources: [
          {
            id: ids.ana,
            projectId,
            teamId: null,
            name: "Ana",
            initials: "AN",
            color: "#6366f1",
            type: "work",
            maxUnits: 1,
            standardRate: 100,
            costPerUse: 0,
            calendarId: null,
            email: null,
            active: true,
            notes: null,
          },
        ],
        assignments: [
          { id: `${uid}-as1`, projectId, taskId: ids.b, resourceId: ids.ana, units: 1 },
          { id: `${uid}-as2`, projectId, taskId: ids.c, resourceId: ids.ana, units: 1 },
        ],
      },
    },
  });
  expect(synced.status()).toBe(200);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "4");

  // as durações do seed sobrevivem ao write-back do motor
  await expect
    .poll(async () => (await detail(request, projectId)).data.tasks.map((t) => t.duration).sort((a, b) => a - b))
    .toEqual([1 * WORKDAY, 2 * WORKDAY, 3 * WORKDAY, 7 * WORKDAY]);

  const rowIds = async () =>
    page.locator('[data-testid="task-row"]').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.taskId ?? ""),
    );

  await page.getByTestId("filters-toggle").click();
  await expect(page.getByTestId("filters-panel")).toBeVisible();

  // --- combinador E: name contém "beta" E duração > 1d -----------------------
  await page.getByTestId("condition-add").click();
  await page.getByTestId("condition-value").first().fill("beta");
  await page.getByTestId("condition-new-field").selectOption("duration");
  await page.getByTestId("condition-add").click();

  const secondRow = page.getByTestId("condition-row").nth(1);
  await secondRow.getByTestId("condition-operator").selectOption("gt");
  await secondRow.getByTestId("condition-value").fill("1d");

  // só o Beta satisfaz as duas condições
  await expect
    .poll(rowIds)
    .toEqual([ids.b]);
  // grade e Gantt com as mesmas linhas
  await expect(page.getByTestId("gantt-bar")).toHaveCount(1);
  await expect(
    page.locator(`[data-testid="gantt-bar"][data-task-id="${ids.b}"]`),
  ).toBeVisible();

  // --- combinador OU: name contém "beta" OU "gama" ---------------------------
  await page.getByTestId("filter-clear").click();
  await page.getByTestId("condition-new-field").selectOption("name");
  await page.getByTestId("condition-add").click();
  await page.getByTestId("condition-value").first().fill("beta");
  await page.getByTestId("condition-add").click();
  await page.getByTestId("condition-value").nth(1).fill("gama");

  // com E (padrão), nenhuma tarefa contém os dois nomes → vazio
  await expect.poll(rowIds).toEqual([]);
  // trocando para OU: Beta ou Gama
  await page.getByTestId("filter-combinator").last().check();
  await expect.poll(rowIds).toEqual([ids.b, ids.c]);

  // --- estado vazio: nenhuma correspondência, filtro ativo -------------------
  await page.getByTestId("filter-clear").click();
  await page.getByTestId("condition-new-field").selectOption("duration");
  await page.getByTestId("condition-add").click();
  await page.getByTestId("condition-operator").selectOption("gt");
  await page.getByTestId("condition-value").fill("99d");

  await expect(page.getByTestId("task-row")).toHaveCount(0);
  await expect(page.getByTestId("query-empty")).toContainText(
    "Nenhum item corresponde aos filtros ativos",
  );
  await expect(page.getByTestId("gantt-query-empty")).toBeVisible();
  // o filtro permanece ativo no painel
  await expect(page.getByTestId("condition-row")).toHaveCount(1);

  await page.getByTestId("filter-clear").click();
  await expect.poll(rowIds).toHaveLength(4);

  // --- ordenação múltipla com hierarquia preservada --------------------------
  await page.getByTestId("sort-new-field").selectOption("duration");
  await page.getByTestId("sort-add").click();
  await expect.poll(rowIds).toEqual([ids.root, ids.a, ids.b, ids.c]); // asc

  await page.getByTestId("sort-direction").click(); // → desc
  await expect.poll(rowIds).toEqual([ids.root, ids.c, ids.b, ids.a]);

  // --- agrupamento por recurso (cabeçalho com contagem e soma) ---------------
  await page.getByTestId("group-new-field").selectOption("res");
  await page.getByTestId("group-add").click();

  const groups = page.getByTestId("group-row");
  await expect(groups).toHaveCount(2);

  const noResource = page.locator('[data-testid="group-row"][data-group-label="(sem valor)"]');
  const withResource = page.locator('[data-testid="group-row"][data-group-label="Ana"]');
  await expect(noResource.getByTestId("group-count")).toContainText("2 tarefas");
  await expect(withResource.getByTestId("group-count")).toContainText("2 tarefas");
  // soma de trabalho do grupo: Beta (2d) + Gama (3d) = 5d
  await expect(withResource.getByTestId("group-work")).toContainText("Σ");
  await expect(withResource.getByTestId("group-work")).toContainText("45h");

  // o Gantt exibe os mesmos cabeçalhos de grupo
  await expect(page.getByTestId("gantt-group")).toHaveCount(2);

  // --- limpar tudo restaura ordem e linhas -----------------------------------
  await page.getByTestId("filter-clear").click();
  await expect(groups).toHaveCount(0);
  await expect.poll(rowIds).toEqual([ids.root, ids.a, ids.b, ids.c]);

  expect(errors).toEqual([]);
});
