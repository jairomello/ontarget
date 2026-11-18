import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Painel de alertas (specs/tracking — "Alertas de desempenho"): atrasadas,
 * prazo excedido, restrição conflitante, superalocadas e vínculo inválido —
 * e a navegação: o clique seleciona a tarefa e rola a visão até ela.
 */

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

test("alertas cobrem os cinco tipos e o clique navega até a tarefa", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Alertas E2E ${Date.now()}`);

  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5); // segunda-feira fixa

  const task = (
    index: number,
    key: string,
    name: string,
    start: number,
    finish: number,
    duration: number,
    patch: Record<string, unknown> = {},
  ) => ({
    id: `${uid}-${key}`,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    start,
    finish,
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
    ...patch,
  });

  const ids = {
    late: `${uid}-late`,
    deadline: `${uid}-deadline`,
    constrained: `${uid}-constrained`,
    over1: `${uid}-over1`,
    over2: `${uid}-over2`,
    cyc1: `${uid}-cyc1`,
    cyc2: `${uid}-cyc2`,
  };
  const future = MON + 60 * DAY; // fora da data de status (não atrasam)

  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [
          // atrasada: plano terminou terça (06/01) e status é quinta (08/01)
          task(0, "late", "Atrasada", MON, MON + DAY, 2 * WORKDAY),
          // prazo: fim na sexta, prazo na quarta → prazo excedido
          task(1, "deadline", "Prazo estourado", MON, MON + 4 * DAY, 5 * WORKDAY, {
            deadline: MON + 2 * DAY,
          }),
          // restrição: forçada para a quinta quando o cálculo daria segunda
          task(2, "constrained", "Restrita", MON, MON + DAY, 2 * WORKDAY, {
            constraintType: "must_start_on",
            constraintDate: MON + 3 * DAY,
          }),
          // superalocadas: duas tarefas simultâneas para a mesma pessoa
          task(3, "over1", "Sobreposta um", MON, MON + 2 * DAY, 3 * WORKDAY),
          task(4, "over2", "Sobreposta dois", MON, MON + 2 * DAY, 3 * WORKDAY),
          // ciclo (datas no futuro para não gerar alerta de atraso)
          task(5, "cyc1", "Cíclica um", future, future, WORKDAY),
          task(6, "cyc2", "Cíclica dois", future, future, WORKDAY),
        ],
        resources: [
          {
            id: `${uid}-ana`,
            projectId,
            teamId: null,
            name: "Ana Silva",
            initials: "AS",
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
          { id: `${uid}-as1`, projectId, taskId: ids.over1, resourceId: `${uid}-ana`, units: 1 },
          { id: `${uid}-as2`, projectId, taskId: ids.over2, resourceId: `${uid}-ana`, units: 1 },
        ],
        task_links: [
          { id: `${uid}-l1`, projectId, predecessorId: ids.cyc1, successorId: ids.cyc2, type: "fs", lagMs: 0, crossProjectRef: null },
          { id: `${uid}-l2`, projectId, predecessorId: ids.cyc2, successorId: ids.cyc1, type: "fs", lagMs: 0, crossProjectRef: null },
        ],
      },
    },
  });
  expect(synced.status()).toBe(200);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "7");

  // --- data de status: quinta, 08/01 ------------------------------------------
  await page.getByTestId("statusdate-toggle").click();
  await page.getByTestId("status-date").fill("2026-01-08");
  await page.getByTestId("statusdate-close").click();

  // --- abre os alertas ---------------------------------------------------------
  await page.getByTestId("alerts-toggle").click();
  await expect(page.getByTestId("alerts-panel")).toBeVisible();

  // contagem total: 3 atrasos + 1 prazo + 1 restrição + 2 superalocações + 2 ciclos
  await expect(page.getByTestId("alerts-toggle")).toHaveAttribute("data-count", "9");

  const kind = (name: string) => page.locator(`[data-testid="alert-row"][data-kind="${name}"]`);
  await expect(kind("delayed")).toHaveCount(3);
  await expect(kind("deadline")).toHaveCount(1);
  await expect(kind("constraint")).toHaveCount(1);
  await expect(kind("overallocated")).toHaveCount(2);
  await expect(kind("cycle")).toHaveCount(2);

  // mensagens representativas
  await expect(kind("delayed").first()).toContainText("2d de atraso");
  await expect(kind("deadline").first()).toContainText("excede o prazo");
  await expect(kind("overallocated").first()).toContainText("capacidade");

  // --- navegação: clique seleciona e rola a visão até a tarefa -----------------
  const target = page.locator(
    `[data-testid="alert-row"][data-kind="delayed"][data-task-id="${ids.late}"]`,
  );
  await target.click();

  // o painel fecha e a tarefa aparece selecionada e visível na grade e no Gantt
  await expect(page.getByTestId("alerts-panel")).toHaveCount(0);
  const row = page.locator(`[data-task-id="${ids.late}"][data-testid="task-row"]`);
  await expect(row).toHaveAttribute("data-active", "true");
  await expect(row).toBeInViewport();
  await expect(
    page.locator(`[data-testid="gantt-bar"][data-task-id="${ids.late}"]`),
  ).toBeInViewport();

  expect(errors).toEqual([]);
});
