import { expect, test, type APIRequestContext } from "@playwright/test";

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

/**
 * Colunas configuráveis (specs/task-sheet — "Colunas configuráveis"):
 * ocultar, redimensionar e reordenar, persistindo por visão.
 * Viewport largo: a grade completa (com Predecessores) tem ~800px e o
 * painel leva 44% da janela.
 */
test.use({ viewport: { width: 1920, height: 1080 } });
test("configuração de colunas sobrevive à troca de visão", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Colunas E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("task-sheet")).toBeVisible();

  // --- estado inicial -----------------------------------------------------
  await expect(page.getByTestId("header-duration")).toBeVisible();
  const startWidthBefore = await page
    .getByTestId("header-start")
    .evaluate((node) => (node as HTMLElement).getBoundingClientRect().width);

  // --- ocultar uma coluna -------------------------------------------------
  await page.getByTestId("columns-toggle").click();
  await expect(page.getByTestId("columns-menu")).toBeVisible();
  await page.getByTestId("column-toggle-duration").uncheck();
  await expect(page.getByTestId("header-duration")).toHaveCount(0);
  await page.getByTestId("columns-toggle").click();

  // --- redimensionar ------------------------------------------------------
  const handle = page.getByTestId("resize-start");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 64, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();

  const startWidthAfter = await page
    .getByTestId("header-start")
    .evaluate((node) => (node as HTMLElement).getBoundingClientRect().width);
  expect(startWidthAfter).toBeGreaterThan(startWidthBefore + 40);

  // --- reordenar arrastando o cabeçalho ----------------------------------
  await page
    .getByTestId("header-percent")
    .dragTo(page.getByTestId("header-wbs"));
  const headers = await page
    .locator("[data-testid^='header-']")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  expect(headers.indexOf("header-percent")).toBeLessThan(headers.indexOf("header-wbs"));

  // --- trocar de visão e voltar ------------------------------------------
  await page.getByTestId("view-select").selectOption("task_sheet");
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-view", "task_sheet");
  await expect(page.getByTestId("gantt-slot")).toHaveCount(0);

  await page.getByTestId("view-select").selectOption("gantt");
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-view", "gantt");

  // a configuração permanece
  await expect(page.getByTestId("header-duration")).toHaveCount(0);
  const startWidthRestored = await page
    .getByTestId("header-start")
    .evaluate((node) => (node as HTMLElement).getBoundingClientRect().width);
  expect(Math.abs(startWidthRestored - startWidthAfter)).toBeLessThan(2);

  const restoredHeaders = await page
    .locator("[data-testid^='header-']")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  expect(restoredHeaders.indexOf("header-percent")).toBeLessThan(
    restoredHeaders.indexOf("header-wbs"),
  );

  // --- e sobrevive ao recarregar a página --------------------------------
  await page.reload();
  await expect(page.getByTestId("task-sheet")).toBeVisible();
  await expect(page.getByTestId("header-duration")).toHaveCount(0);
  const widthAfterReload = await page
    .getByTestId("header-start")
    .evaluate((node) => (node as HTMLElement).getBoundingClientRect().width);
  expect(Math.abs(widthAfterReload - startWidthAfter)).toBeLessThan(2);

  expect(errors).toEqual([]);
});
