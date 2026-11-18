import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const H = 60 * 60 * 1000;

/**
 * Calendário por tarefa (tarefa 6.10; PRD §8, item 3): criar um calendário
 * com turno de 6h, associá-lo a uma tarefa e verificar que a duração é
 * convertida — prevalecendo sobre o calendário do projeto — e que a exclusão
 * do calendário em uso é bloqueada (specs/calendars — "Gerenciamento").
 */
async function seed(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/projects", {
    data: { name: `Calendário por tarefa E2E ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const now = Date.now();
  const start = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: {
      upserts: {
        tasks: [
          {
            id: `${Date.now().toString(36)}-t`,
            projectId: project.id,
            parentId: null,
            outlineLevel: 0,
            outlineNumber: "1",
            sortOrder: 0,
            name: "Tarefa com calendário próprio",
            start,
            finish: start, // 1 dia útil inclusivo
            duration: 8 * H, // cabe em 1 dia de 9h; ocupa 2 dias em turno de 6h
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
          },
        ],
      },
    },
  });
  expect(synced.status()).toBe(200);
  return project.id;
}

test("calendário de 6h na tarefa converte a duração e não pode ser excluído em uso", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await seed(request);
  await page.goto(`/p/${projectId}`);

  const status = page.getByTestId("status-schedule");
  await expect(status).toHaveAttribute("data-tasks", "1");

  const row = page.getByTestId("task-row").first();
  const startCell = row.locator('[data-testid="cell-start"]');
  const finishCell = row.locator('[data-testid="cell-finish"]');

  // --- no calendário do projeto (9h), 8 h cabem em um dia ------------------
  await expect(startCell).toHaveText("05/01/2026");
  await expect(finishCell).toHaveText("05/01/2026");

  // --- cria um calendário e ajusta o turno para 6h -------------------------
  await page.getByTestId("calendars-toggle").click();
  await expect(page.getByTestId("calendars-panel")).toBeVisible();
  await page.getByTestId("calendar-create").click();
  await expect(page.getByTestId("calendar-select")).toBeVisible();
  await expect(page.getByTestId("calendar-select")).toHaveValue(/.+/);
  await page.getByTestId("workday-end").fill("15:00"); // 09:00–15:00 = 6h
  await page.getByTestId("calendars-close").click();

  // --- associa o calendário à tarefa ---------------------------------------
  await row.getByTestId("cell-name").click();
  await page.keyboard.press("F4");
  await expect(page.getByTestId("task-form")).toBeVisible();
  await page.getByTestId("form-calendar").selectOption({ label: "Calendário 2" });

  // 8 h em turno de 6h ocupam dois dias úteis: fim passa para a terça
  await expect(finishCell).toHaveText("06/01/2026");
  await expect(startCell).toHaveText("05/01/2026");

  // --- a exclusão do calendário em uso é recusada ---------------------------
  await page.getByTestId("calendars-toggle").click();
  await expect(page.getByTestId("calendars-panel")).toBeVisible();
  await page.getByTestId("calendar-select").selectOption({ label: "Calendário 2" });
  await page.getByTestId("calendar-delete").click();
  await expect(page.getByTestId("calendar-error")).toContainText("Em uso");
  // e ele continua listado
  await expect(page.getByTestId("calendar-select")).toHaveCount(1);

  // --- voltar ao calendário do projeto restaura um dia ----------------------
  await page.getByTestId("calendars-close").click();
  await page.getByTestId("form-calendar").selectOption({ label: "Padrão do projeto" });
  await expect(finishCell).toHaveText("05/01/2026");

  expect(errors).toEqual([]);
});
