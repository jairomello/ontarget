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
 * Edição inline (specs/task-sheet): commit por Enter, cancelamento por
 * Esc e recusa de valor inválido mantendo a célula aberta.
 */
test("editar células: confirmar, cancelar e recusar inválido", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Edição E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("task-row").first()).toBeVisible();

  const firstRow = page.getByTestId("task-row").first();
  const durationCell = firstRow.getByTestId("cell-duration");
  const nameCell = firstRow.getByTestId("cell-name");

  // --- valor inválido mantém a célula aberta -------------------------------
  await durationCell.dblclick();
  const editor = page.getByTestId("cell-editor");
  await expect(editor).toBeVisible();

  await editor.fill("abc");
  await editor.press("Enter");
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("cell-error")).toContainText("Duração inválida");
  await expect(page.getByTestId("cell-error")).toBeVisible();

  // --- corrigir e confirmar ----------------------------------------------
  await editor.fill("5d");
  await editor.press("Enter");
  await expect(page.getByTestId("cell-editor")).toHaveCount(0);
  await expect(durationCell).toHaveText("5d");

  // --- Esc cancela sem alterar -------------------------------------------
  await nameCell.dblclick();
  const nameEditor = page.getByTestId("cell-editor");
  await expect(nameEditor).toBeVisible();
  await nameEditor.fill("Não deve persistir");
  await nameEditor.press("Escape");
  await expect(page.getByTestId("cell-editor")).toHaveCount(0);
  await expect(nameCell).not.toContainText("Não deve persistir");

  // --- confirmação por Enter ---------------------------------------------
  await nameCell.dblclick();
  const nameEditor2 = page.getByTestId("cell-editor");
  await nameEditor2.fill("Levantamento revisado");
  await nameEditor2.press("Enter");
  await expect(page.getByTestId("cell-editor")).toHaveCount(0);
  await expect(nameCell).toContainText("Levantamento revisado");

  // --- digitação direta substitui o conteúdo -----------------------------
  await nameCell.click();
  await page.keyboard.press("F2");
  await expect(page.getByTestId("cell-editor")).toBeVisible();
  await page.keyboard.type("X");
  await page.keyboard.press("Enter");
  await expect(nameCell).toContainText("X");

  // --- a guarda de edição silencia os atalhos globais ---------------------
  await durationCell.dblclick();
  await expect(page.getByTestId("cell-editor")).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcuts-overlay")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cell-editor")).toHaveCount(0);

  expect(errors).toEqual([]);
});
