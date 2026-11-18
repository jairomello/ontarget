import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const WORKDAY = 9 * 60 * 60 * 1000; // turno padrão 09:00–18:00

/**
 * Término inclusivo de uma tarefa iniciada em dia útil: a n-ésima sexta-feira
 * (conta apenas dias úteis, como o motor calcula).
 */
function inclusiveFinish(start: number, workdays: number): number {
  let day = start;
  let counted = 1;
  while (counted < workdays) {
    day += DAY;
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) counted += 1;
  }
  return day;
}

/**
 * Agendamento em Web Worker com recálculo incremental
 * (specs/scheduling — "Recálculo incremental e desempenho").
 *
 * Duas cadeias independentes: X (10 dias) define o fim do projeto e A→B é a
 * cadeia editada — ela fica dentro do envelope, então o worker recalcula
 * apenas a cadeia afetada (meta incremental).
 */
async function seed(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/projects", {
    data: { name: `Agendamento E2E ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const now = Date.now();
  const start = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const base = (
    index: number,
    id: string,
    name: string,
    duration: number,
    dayOffset = 0,
  ) => ({
    id,
    projectId: project.id,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    // semeadura já no formato inclusivo e alinhada ao que o motor calcula
    start: start + dayOffset * DAY,
    finish: inclusiveFinish(start + dayOffset * DAY, Math.round(duration / WORKDAY)),
    duration,
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

  const uid = Date.now().toString(36);
  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: {
      upserts: {
        tasks: [
          base(0, `${uid}-x`, "Cadeia longa", 10 * WORKDAY),
          base(1, `${uid}-a`, "Tarefa A", 1 * WORKDAY),
          // B começa na terça, como o motor calcula a partir do vínculo
          base(2, `${uid}-b`, "Tarefa B", 1 * WORKDAY, 1),
        ],
        task_links: [
          {
            id: `${uid}-link`,
            projectId: project.id,
            predecessorId: `${uid}-a`,
            successorId: `${uid}-b`,
            type: "fs",
            lagMs: 0,
            crossProjectRef: null,
          },
        ],
      },
    },
  });
  expect(synced.status()).toBe(200);
  return project.id;
}

test("o agendamento roda em worker e recalcula só a cadeia afetada", async ({
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

  // --- cálculo inicial (completo) -----------------------------------------
  await expect(status).toHaveAttribute("data-tasks", "3");
  await expect(status).toHaveAttribute("data-incremental", "false");
  // só a cadeia longa tem float zero
  await expect(status).toHaveAttribute("data-critical", "1");
  await expect(status).toHaveAttribute("data-ms", /\d+/);
  await expect(status).toContainText("3 tarefas · 1 críticas");

  // --- editar A (2ª linha): a cadeia A→B muda dentro do envelope ----------
  const rowA = page.getByTestId("task-row").nth(1);
  await expect(rowA).toContainText("Tarefa A");
  const durationCell = rowA.getByTestId("cell-duration");
  await durationCell.dblclick();
  const editor = page.getByTestId("cell-editor");
  await editor.fill("2d");
  await editor.press("Enter");
  await expect(durationCell).toHaveText("2d");

  // --- recálculo incremental: só a cadeia afetada --------------------------
  await expect(status).toHaveAttribute("data-incremental", "true");
  await expect(status).toHaveAttribute("data-tasks", "3");
  await expect(status).toHaveAttribute("data-ms", /\d+/);

  // a duração persiste (sync) e o cálculo segue íntegro ao recarregar
  await expect(page.getByTestId("status-save")).toHaveText("Salvo");
  await page.reload();
  await expect(status).toHaveAttribute("data-tasks", "3");
  await expect(durationCell).toHaveText("2d");

  expect(errors).toEqual([]);
});
