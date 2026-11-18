import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const WORKDAY = 8 * 60 * 60 * 1000;

/**
 * Task Inspector (specs/task-dependencies — "Cadeia condutora"; specs/
 * scheduling — "Task Inspector"): uma tarefa com três predecessores, sendo
 * apenas um deles sem folga.
 */
async function seed(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/projects", {
    data: { name: `Inspetor E2E ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const now = Date.now();
  const start = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const base = (index: number, key: string, name: string, duration: number) => ({
    id: `${key}`,
    projectId: project.id,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    start,
    finish: start,
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
  const [a, b, c, x] = [`${uid}-a`, `${uid}-b`, `${uid}-c`, `${uid}-x`];

  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: {
      upserts: {
        tasks: [
          base(0, a, "Condutora A", 3 * WORKDAY), // termina quarta
          base(1, b, "Com folga B", 1 * WORKDAY), // termina segunda
          base(2, c, "Com folga C", 2 * WORKDAY), // termina terça
          base(3, x, "Alvo X", 1 * WORKDAY), // começa quinta (via A)
        ],
        task_links: [
          { id: `${uid}-l1`, projectId: project.id, predecessorId: a, successorId: x, type: "fs", lagMs: 0, crossProjectRef: null },
          { id: `${uid}-l2`, projectId: project.id, predecessorId: b, successorId: x, type: "fs", lagMs: 0, crossProjectRef: null },
          { id: `${uid}-l3`, projectId: project.id, predecessorId: c, successorId: x, type: "fs", lagMs: 0, crossProjectRef: null },
        ],
      },
    },
  });
  expect(synced.status()).toBe(200);
  return project.id;
}

test("o inspetor mostra a cadeia condutora e o motivo do agendamento", async ({
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
  await expect(page.getByTestId("task-row")).toHaveCount(4);

  // abre os detalhes da tarefa alvo (última linha)
  const rowX = page.getByTestId("task-row").nth(3);
  await expect(rowX).toContainText("Alvo X");
  await rowX.getByTestId("cell-name").click();
  await page.keyboard.press("F4");
  await expect(page.getByTestId("task-form")).toBeVisible();
  await expect(page.getByTestId("task-form-title")).toHaveText("Alvo X");

  // --- motivo: o vínculo FS da Condutora A determina o início --------------
  const reason = page.getByTestId("inspector-reason");
  await expect(reason).toContainText("Condutora A");
  await expect(reason).toContainText("FS");

  // --- cadeia condutora: só A (B e C têm folga) ----------------------------
  const chain = page.getByTestId("inspector-chain");
  await expect(chain).toBeVisible();
  await expect(chain).toContainText("Condutora A");
  await expect(chain).not.toContainText("Com folga B");
  await expect(chain).not.toContainText("Com folga C");
  await expect(page.getByTestId("inspector-chain-item")).toHaveCount(1);

  // --- conflitos: nenhum ---------------------------------------------------
  await expect(page.getByTestId("inspector-conflicts")).toHaveText(
    "Nenhum conflito registrado.",
  );

  // clicar na condutora move a seleção (e o inspetor) para ela na grade
  await page.getByTestId("inspector-chain-item").click();
  await expect(page.getByTestId("task-form-title")).toHaveText("Condutora A");

  expect(errors).toEqual([]);
});
