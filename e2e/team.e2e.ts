import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Painel de equipe (specs/resources): marcação do período conflitante com a
 * razão demanda/capacidade, marcação no Gantt, reatribuição por arrastar e a
 * verificação adiada da tarefa 6.5 — tarefas inativas fora do cálculo de
 * superalocação.
 */

interface AssignmentRow {
  id: string;
  taskId: string;
  resourceId: string;
  units: number;
}

async function assignmentsOf(
  request: APIRequestContext,
  projectId: string,
): Promise<AssignmentRow[]> {
  const body = (await (await request.get(`/api/projects/${projectId}`)).json()) as {
    data: { assignments: AssignmentRow[] };
  };
  return body.data.assignments;
}

async function seed(request: APIRequestContext): Promise<{
  projectId: string;
  ids: { ana: string; bia: string; t1: string; t2: string; t3: string };
}> {
  const created = await request.post("/api/projects", {
    data: { name: `Equipe E2E ${Date.now()}`, templateKey: "vazio" },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const projectId = project.id;

  const uid = Date.now().toString(36);
  const ids = { ana: `${uid}-ana`, bia: `${uid}-bia`, t1: `${uid}-t1`, t2: `${uid}-t2`, t3: `${uid}-t3` };
  const now = Date.now();
  const MON = Date.UTC(2026, 0, 5); // segunda-feira fixa

  const task = (
    id: string,
    name: string,
    start: number,
    finish: number,
    duration: number,
    sortOrder: number,
    isInactive = false,
  ) => ({
    id,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(sortOrder + 1),
    sortOrder,
    name,
    start,
    finish,
    duration,
    durationUnit: "day",
    percentComplete: 0,
    isSummary: false,
    isMilestone: false,
    isInactive,
    schedulingMode: "auto",
    taskType: "fixed_duration",
    effortDriven: true,
    priority: 500,
    createdAt: now,
    updatedAt: now,
  });

  const person = (id: string, name: string, initials: string, rate: number) => ({
    id,
    projectId,
    teamId: null,
    name,
    initials,
    color: "#6366f1",
    type: "work",
    maxUnits: 1,
    standardRate: rate,
    costPerUse: 0,
    calendarId: null,
    email: null,
    active: true,
    notes: null,
  });

  const assignment = (id: string, taskId: string, resourceId: string) => ({
    id,
    projectId,
    taskId,
    resourceId,
    units: 1,
  });

  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [
          // Ana (100%) com tarefas sobrepostas de terça a quinta → conflito 2/1
          task(ids.t1, "Tarefa um", MON, MON + 4 * DAY, 5 * WORKDAY, 0),
          task(ids.t2, "Tarefa dois", MON + DAY, MON + 3 * DAY, 3 * WORKDAY, 1),
          // inativa no mesmo intervalo: não pode inflar a demanda (tarefa 6.5)
          task(ids.t3, "Inativa", MON + DAY, MON + 3 * DAY, 3 * WORKDAY, 2, true),
        ],
        resources: [person(ids.ana, "Ana Silva", "AS", 100), person(ids.bia, "Bia Souza", "BS", 150)],
        assignments: [
          assignment(`${uid}-a1`, ids.t1, ids.ana),
          assignment(`${uid}-a2`, ids.t2, ids.ana),
          assignment(`${uid}-a3`, ids.t3, ids.ana),
        ],
      },
    },
  });
  expect(synced.status()).toBe(200);

  return { projectId, ids };
}

function personRow(page: Page, resourceId: string) {
  return page.locator(
    `[data-testid="team-person-row"][data-resource-id="${resourceId}"]`,
  );
}

test("painel de equipe: superalocação 2/1, inativa fora e reatribuição por arraste", async ({
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
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "3");

  // --- abre o painel de equipe ----------------------------------------------
  await page.getByTestId("team-toggle").click();
  await expect(page.getByTestId("team-panel")).toBeVisible();

  const anaRow = personRow(page, ids.ana);
  const biaRow = personRow(page, ids.bia);
  await expect(anaRow).toContainText("Ana Silva");
  await expect(biaRow).toContainText("Bia Souza");

  // --- faixa da Ana: só as tarefas ativas (a inativa fica de fora) ----------
  await expect(anaRow.getByTestId("team-assignment-bar")).toHaveCount(2);
  await expect(anaRow.getByTestId("person-summary")).toContainText("capacidade");

  // --- período conflitante com a razão demanda/capacidade -------------------
  // sobreposição de terça a quinta (mesclada em um segmento), demanda 2,1
  // — se a inativa contasse, a demanda seria 3
  const conflict = anaRow.getByTestId("overallocation");
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toHaveAttribute("data-demand", "2");
  await expect(conflict).toHaveAttribute("data-capacity", "1");
  await expect(conflict).toHaveAttribute("data-ratio", "2");
  await expect(conflict).toContainText("2,0×");

  // a Bia (sem conflito) não tem marcação
  await expect(biaRow.getByTestId("overallocation")).toHaveCount(0);

  // --- sinalização também no Gantt ------------------------------------------
  const ganttBar = (taskId: string) =>
    page.locator(`[data-testid="gantt-bar"][data-task-id="${taskId}"]`);
  await expect(ganttBar(ids.t1)).toHaveAttribute("data-overallocated", "true");
  await expect(ganttBar(ids.t2)).toHaveAttribute("data-overallocated", "true");
  // a inativa é exibida, mas nunca sinalizada como superalocada
  await expect(ganttBar(ids.t3)).not.toHaveAttribute("data-overallocated", "true");

  // --- reatribuição por arraste: T2 da Ana para a Bia -----------------------
  const sourceBar = anaRow.locator(
    `[data-testid="team-assignment-bar"][data-task-id="${ids.t2}"]`,
  );
  const sourceBox = (await sourceBar.boundingBox())!;
  const targetBox = (await biaRow.boundingBox())!;

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + Math.min(sourceBox.width / 2 + 240, targetBox.width - 60),
    targetBox.y + targetBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  // a atribuição muda de responsável e ambas as linhas são atualizadas
  await expect
    .poll(async () => {
      const rows = await assignmentsOf(request, projectId);
      return rows.find((row) => row.taskId === ids.t2)?.resourceId;
    })
    .toBe(ids.bia);

  await expect(anaRow.getByTestId("team-assignment-bar")).toHaveCount(1);
  await expect(biaRow.getByTestId("team-assignment-bar")).toHaveCount(1);
  // sem sobreposição, a superalocação da Ana desaparece (ambas as linhas mudam)
  await expect(anaRow.getByTestId("overallocation")).toHaveCount(0);
  await expect(biaRow.getByTestId("overallocation")).toHaveCount(0);
  await expect(ganttBar(ids.t1)).not.toHaveAttribute("data-overallocated", "true");

  await expect(page.getByTestId("team-close")).toBeVisible();
  expect(errors).toEqual([]);
});
