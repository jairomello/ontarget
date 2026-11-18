import { expect, test, type APIRequestContext } from "@playwright/test";

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "entrega-software" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

/**
 * Colagem em lote e navegação por teclado (specs/task-sheet):
 * 10 linhas coladas criam 10 tarefas e um único `Ctrl+Z` as remove.
 */
test("colar 10 linhas cria 10 tarefas e um único Ctrl+Z as remove", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Colagem E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);

  const rows = page.getByTestId("task-row");
  await expect(rows).toHaveCount(12);

  // seleciona a primeira tarefa e dá foco à grade
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute("data-active", "true");

  // 10 linhas no clipboard (uma por tarefa)
  const names = Array.from({ length: 10 }, (_, index) => `Colada ${index + 1}`);
  await page.evaluate((text) => navigator.clipboard.writeText(text), names.join("\n"));

  await page.keyboard.press("Control+V");
  await expect(rows).toHaveCount(22);
  // escopo na grade: "Colada 10" também aparece no seletor da Timeline
  await expect(
    page.getByTestId("task-sheet-scroll").getByText("Colada 10"),
  ).toBeVisible();

  // um único passo de desfazer remove tudo
  await page.keyboard.press("Control+Z");
  await expect(rows).toHaveCount(12);
  await expect(page.getByText("Colada 1")).toHaveCount(0);

  // refazer reaplica o lote inteiro
  await page.keyboard.press("Control+Y");
  await expect(rows).toHaveCount(22);

  expect(errors).toEqual([]);
});

test("navegação e seleção estendida por teclado", async ({ page, request }) => {
  const projectId = await createProject(request, `Navegação E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);

  const rows = page.getByTestId("task-row");
  await expect(rows).toHaveCount(12);

  await rows.first().click();
  await expect(rows.first()).toHaveAttribute("data-active", "true");

  // seta para baixo move a linha ativa
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("data-active", "true");
  await expect(rows.first()).toHaveAttribute("data-active", "false");

  // Shift+seta estende a seleção
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator("[data-testid='task-row'][data-selected='true']")).toHaveCount(3);

  // Ctrl+A seleciona todas as linhas visíveis
  await page.keyboard.press("Control+a");
  await expect(page.locator("[data-testid='task-row'][data-selected='true']")).toHaveCount(12);

  // extremos: Ctrl+Home/Ctrl+End na grade, Home/End na coluna
  await page.keyboard.press("Control+Home");
  await expect(rows.first()).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Control+End");
  await expect(rows.last()).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Home");
  await expect(rows.last()).toHaveAttribute("data-active", "true");
});
