import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Cenários de interface do PRD §8.1 (itens 11–15): hierarquia WBS por
 * teclado na Task Sheet.
 *
 * Estrutura semeada:
 *   A (raiz) > ref > ref1
 *            > t1..t5
 *   B (raiz) > b1
 */
interface Seeded {
  projectId: string;
  ids: Record<string, string>;
}

async function seed(request: APIRequestContext): Promise<Seeded> {
  const created = await request.post("/api/projects", {
    data: { name: `WBS E2E ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const uid = Date.now().toString(36);
  const names = ["A", "ref", "ref1", "t1", "t2", "t3", "t4", "t5", "B", "b1"];
  const ids: Record<string, string> = {};
  for (const name of names) ids[name] = `${uid}-${name}`;

  const now = Date.now();
  const task = (
    name: string,
    sortOrder: number,
    parentId: string | null,
    outlineLevel: number,
    outlineNumber: string,
  ) => ({
    id: ids[name],
    projectId: project.id,
    parentId,
    sortOrder,
    outlineLevel,
    outlineNumber,
    name: `Tarefa ${name}`,
    createdAt: now,
    updatedAt: now,
  });

  const tasks = [
    task("A", 0, null, 0, "1"),
    task("ref", 1, ids.A!, 1, "1.1"),
    task("ref1", 2, ids.ref!, 2, "1.1.1"),
    task("t1", 3, ids.A!, 1, "1.2"),
    task("t2", 4, ids.A!, 1, "1.3"),
    task("t3", 5, ids.A!, 1, "1.4"),
    task("t4", 6, ids.A!, 1, "1.5"),
    task("t5", 7, ids.A!, 1, "1.6"),
    task("B", 8, null, 0, "2"),
    task("b1", 9, ids.B!, 1, "2.1"),
  ];

  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);

  return { projectId: project.id, ids };
}

const rowOf = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`[data-testid="task-row"][data-task-id="${id}"]`);

test("cenários 11–13: indentar, bloco e outdentar", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const { projectId, ids } = await seed(request);
  await page.goto(`/p/${projectId}`);

  const rows = page.getByTestId("task-row");
  await expect(rows).toHaveCount(10);

  // --- 11) indentar muda WBS e um único Ctrl+Z restaura -------------------
  await rowOf(page, ids.t1!).click();
  const wbsBefore = await rowOf(page, ids.t1!).locator("[data-testid='cell-wbs']").textContent();
  expect(wbsBefore).toBe("1.2");

  await page.keyboard.press("Control+Shift+ArrowRight");
  await expect(rowOf(page, ids.t1!)).toHaveAttribute("data-depth", "2");
  expect(await rowOf(page, ids.t1!).locator("[data-testid='cell-wbs']").textContent()).toBe(
    "1.1.2",
  );

  await page.keyboard.press("Control+z");
  await expect(rowOf(page, ids.t1!)).toHaveAttribute("data-depth", "1");
  expect(await rowOf(page, ids.t1!).locator("[data-testid='cell-wbs']").textContent()).toBe(
    "1.2",
  );

  // --- 12) bloco de 5: move juntas e desfaz em um passo -------------------
  await rowOf(page, ids.t1!).click();
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press("Shift+ArrowDown");
  }
  await expect(page.locator("[data-testid='task-row'][data-selected='true']")).toHaveCount(5);

  await page.keyboard.press("Control+Shift+ArrowRight");

  const block = [ids.t1!, ids.t2!, ids.t3!, ids.t4!, ids.t5!];
  for (const id of block) {
    await expect(rowOf(page, id)).toHaveAttribute("data-depth", "2");
  }
  // ordem relativa preservada
  const order = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-task-id")),
  );
  const refIndex = order.indexOf(ids.ref!);
  expect(order.slice(refIndex + 2, refIndex + 7)).toEqual(block);

  // um único passo desfaz as cinco
  await page.keyboard.press("Control+z");
  for (const id of block) {
    await expect(rowOf(page, id)).toHaveAttribute("data-depth", "1");
  }

  // --- 13) outdentar promove e renumera ----------------------------------
  await rowOf(page, ids.ref1!).click();
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await expect(rowOf(page, ids.ref1!)).toHaveAttribute("data-depth", "1");
  expect(await rowOf(page, ids.ref1!).locator("[data-testid='cell-wbs']").textContent()).toBe(
    "1.2",
  );

  expect(errors).toEqual([]);
});

test("cenários 14–15: recolher e expandir hierarquia", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const { projectId, ids } = await seed(request);
  await page.goto(`/p/${projectId}`);

  const rows = page.getByTestId("task-row");
  await expect(rows).toHaveCount(10);

  // --- 14) `-` recolhe, mantém a seleção; `+` expande ---------------------
  await rowOf(page, ids.A!).click();
  await expect(rowOf(page, ids.A!)).toHaveAttribute("data-active", "true");

  await page.keyboard.press("-");
  await expect(rows).toHaveCount(3); // resta A, B e b1
  await expect(rowOf(page, ids.A!)).toHaveAttribute("data-active", "true");
  await expect(rowOf(page, ids.t1!)).toHaveCount(0);
  await expect(rowOf(page, ids.ref!)).toHaveCount(0);
  await expect(rowOf(page, ids.ref1!)).toHaveCount(0);

  await page.keyboard.press("+");
  await expect(rows).toHaveCount(10);
  await expect(rowOf(page, ids.A!)).toHaveAttribute("data-active", "true");

  // --- 15) Ctrl+- / Ctrl++ operam na subárvore inteira --------------------
  await page.keyboard.press("Control+-");
  await expect(rows).toHaveCount(3); // A, B, b1
  await expect(rowOf(page, ids.ref1!)).toHaveCount(0);

  await page.keyboard.press("Control++");
  await expect(rows).toHaveCount(10);

  expect(errors).toEqual([]);
});
