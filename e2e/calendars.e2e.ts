import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const WORKDAY = 9 * 60 * 60 * 1000; // turno padrão 09:00–18:00

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatDate(value: number): string {
  return dateFormatter.format(new Date(value));
}

function toIso(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Próxima quarta-feira (a partir de amanhã), em epoch ms UTC-naive. */
function nextWednesday(): number {
  const now = new Date();
  let day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY;
  while (new Date(day).getUTCDay() !== 3) day += DAY;
  return day;
}

async function seed(
  request: APIRequestContext,
): Promise<{ projectId: string; holiday: number }> {
  const created = await request.post("/api/projects", {
    data: { name: `Calendários E2E ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const holiday = nextWednesday();
  const now = Date.now();

  const task = {
    id: `${Date.now().toString(36)}-t0`,
    projectId: project.id,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: "1",
    sortOrder: 0,
    name: "Tarefa afetada pelo feriado",
    start: holiday,
    finish: holiday + 2 * DAY,
    duration: 3 * WORKDAY, // tarefa ocupa qua, sex e seg (3 dias úteis)
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

  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: { upserts: { tasks: [task] } },
  });
  expect(synced.status()).toBe(200);

  return { projectId: project.id, holiday };
}

/**
 * Interface de calendários (specs/calendars): adicionar um feriado reagenda
 * as tarefas afetadas e sombreia (e rotula) a coluna no Gantt
 * (specs/gantt-view — "Tempo não útil sombreado").
 */
test("adicionar um feriado reagenda as tarefas e sombreia a coluna no Gantt", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const { projectId, holiday } = await seed(request);
  await page.goto(`/p/${projectId}`);

  const startCell = page
    .getByTestId("task-row")
    .first()
    .locator('[data-testid="cell-start"]');
  const finishCell = page
    .getByTestId("task-row")
    .first()
    .locator('[data-testid="cell-finish"]');

  // --- estado inicial: quarta é dia útil, sem sombra ------------------------
  await expect(startCell).toHaveText(formatDate(holiday));
  await expect(finishCell).toHaveText(formatDate(holiday + 2 * DAY));
  await expect(
    page.locator(`[data-testid="nonworking-block"][data-date="${holiday}"]`),
  ).toHaveCount(0);

  // --- abre a interface de calendários -------------------------------------
  await page.getByTestId("calendars-toggle").click();
  await expect(page.getByTestId("calendars-panel")).toBeVisible();

  // dias úteis seg–sex configuráveis
  await expect(page.getByTestId("weekday-seg")).toBeChecked();
  await expect(page.getByTestId("weekday-sab")).not.toBeChecked();

  // --- cadastra o feriado na quarta-feira ----------------------------------
  await page.getByTestId("exception-date").fill(toIso(holiday));
  await page.getByTestId("exception-name").fill("Feriado Nacional");
  await page.getByTestId("exception-add").click();

  await expect(page.getByTestId("exception-row")).toHaveCount(1);

  // --- 1) a tarefa afetada é reagendada ------------------------------------
  // início avança para a quinta; a duração útil de 3 dias se recompõe
  // qui, sex e seg seguinte (feriado quarta + fim de semana)
  await expect(startCell).toHaveText(formatDate(holiday + DAY));
  await expect(finishCell).toHaveText(formatDate(holiday + 5 * DAY));

  // --- 2) a coluna do feriado é sombreada e rotulada no cabeçalho ----------
  await expect(
    page.locator(`[data-testid="nonworking-block"][data-date="${holiday}"]`),
  ).toHaveCount(1);
  await expect(page.getByTestId(`gantt-holiday-${holiday}`)).toHaveText(
    "Feriado Nacional",
  );

  await page.getByTestId("calendars-close").click();
  await expect(page.getByTestId("calendars-panel")).toHaveCount(0);

  // --- persistência: reabrir mantém o calendário e as datas ----------------
  await expect(page.getByTestId("status-save")).toHaveText("Salvo");
  await page.reload();

  await expect(startCell).toHaveText(formatDate(holiday + DAY));
  await expect(
    page.locator(`[data-testid="nonworking-block"][data-date="${holiday}"]`),
  ).toHaveCount(1);
  await expect(page.getByTestId(`gantt-holiday-${holiday}`)).toHaveText(
    "Feriado Nacional",
  );

  expect(errors).toEqual([]);
});
