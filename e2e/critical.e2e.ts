import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const WORKDAY = 9 * 60 * 60 * 1000; // turno padrão 09:00–18:00

/** Segunda-feira fixa 05/01/2026 (UTC-naive). */
const MON = Date.UTC(2026, 0, 5);

/** Data em pt-BR (UTC-naive) de N dias após 05/01/2026. */
function formatDateJs(offsetDays: number): string {
  const date = new Date(MON + offsetDays * DAY);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

/**
 * Agendamento ligado à UI (tarefa 6.9): editar a duração de uma tarefa
 * automática reagenda a dependente na grade e no Gantt, e as tarefas com
 * float total zero aparecem destacadas como críticas nos dois painéis
 * (specs/scheduling — "Cálculo do caminho crítico").
 */
async function seed(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/projects", {
    data: { name: `Críticas E2E ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const now = Date.now();
  const base = (index: number, key: string, name: string) => ({
    id: key,
    projectId: project.id,
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
  });

  const uid = Date.now().toString(36);
  const [a, b, c] = [`${uid}-a`, `${uid}-b`, `${uid}-c`];

  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: {
      upserts: {
        tasks: [base(0, a, "Cadeia A"), base(1, b, "Cadeia B"), base(2, c, "Folgada C")],
        task_links: [
          {
            id: `${uid}-link`,
            projectId: project.id,
            predecessorId: a,
            successorId: b,
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

test("editar duração reagenda a tarefa e a cadeia crítica aparece destacada", async ({
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
  await expect(status).toHaveAttribute("data-tasks", "3");

  const rowA = page.getByTestId("task-row").nth(0);
  const rowB = page.getByTestId("task-row").nth(1);
  const rowC = page.getByTestId("task-row").nth(2);
  const firstId = (await rowA.getAttribute("data-task-id"))!;
  const secondId = (await rowB.getAttribute("data-task-id"))!;
  const thirdId = (await rowC.getAttribute("data-task-id"))!;

  const barOf = (taskId: string) =>
    page.locator(`[data-testid="gantt-bar"][data-task-id="${taskId}"]`);
  const startCellB = rowB.locator('[data-testid="cell-start"]');
  const finishCellB = rowB.locator('[data-testid="cell-finish"]');

  // --- estado inicial: A e B críticas na grade, C com folga ---------------
  await expect(rowA).toHaveAttribute("data-critical", "true");
  await expect(rowB).toHaveAttribute("data-critical", "true");
  await expect(rowC).not.toHaveAttribute("data-critical", "true");

  // --- e no Gantt ----------------------------------------------------------
  await expect(barOf(firstId)).toHaveAttribute("data-critical", "true");
  await expect(barOf(secondId)).toHaveAttribute("data-critical", "true");
  await expect(barOf(thirdId)).not.toHaveAttribute("data-critical", "true");

  // --- datas iniciais calculadas (A: 1 dia na segunda; B: na terça) --------
  await expect(startCellB).toHaveText(formatDateJs(1));
  await expect(finishCellB).toHaveText(formatDateJs(1));

  const boxBefore = await barOf(secondId).boundingBox();
  expect(boxBefore).not.toBeNull();

  // --- editar A: 1 dia → 3 dias -------------------------------------------
  const durationCellA = rowA.locator('[data-testid="cell-duration"]');
  await durationCellA.dblclick();
  const editor = page.getByTestId("cell-editor");
  await editor.fill("3d");
  await editor.press("Enter");
  await expect(durationCellA).toHaveText("3d");

  // --- B é reagendada na grade (quinta-feira) ------------------------------
  // A com 24 h (3d) ocupa seg, ter e qua; B passa a começar na quinta 08/01
  await expect(startCellB).toHaveText(formatDateJs(3));
  await expect(finishCellB).toHaveText(formatDateJs(3));

  // --- e a barra de B se move no Gantt -------------------------------------
  await expect
    .poll(async () => {
      const box = await barOf(secondId).boundingBox();
      return box?.x ?? 0;
    })
    .toBeGreaterThan(boxBefore!.x);

  // C continua com folga
  await expect(rowC).not.toHaveAttribute("data-critical", "true");

  // --- persistência: recarrega com as datas recalculadas -------------------
  await expect(page.getByTestId("status-save")).toHaveText("Salvo");
  await page.reload();
  await expect(startCellB).toHaveText(formatDateJs(3));
  await expect(rowB).toHaveAttribute("data-critical", "true");

  expect(errors).toEqual([]);
});
