import { expect, test, type Page } from "@playwright/test";

/** Card de projeto cujo link tem exatamente o nome informado. */
function cardNamed(page: Page, name: string) {
  return page
    .locator("[data-testid='portfolio-card']")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
}

/**
 * Fluxo completo do portfólio (specs/portfolio):
 * criar → abrir → buscar → duplicar → excluir → desfazer → limpeza.
 */
test("criar e abrir um projeto funciona de ponta a ponta", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("dialog", (dialog) => void dialog.accept());

  const unique = `Projeto E2E ${Date.now()}`;
  const copyName = `${unique} (cópia)`;

  await page.goto("/");

  // --- criação -------------------------------------------------------------
  await page.getByTestId("new-project").click();
  await page.getByTestId("new-project-name").fill(unique);
  await page.getByTestId("new-project-template").selectOption("entrega-software");
  await page.getByTestId("new-project-submit").click();

  // criado e aberto automaticamente na Task Sheet
  await expect(page.getByTestId("workspace")).toBeVisible();
  const projectId = (await page.getByTestId("workspace").getAttribute("data-project-id"))!;
  expect(projectId).toBeTruthy();

  // --- listagem e busca ----------------------------------------------------
  await page.getByTestId("brand").click();
  await expect(page.getByTestId("portfolio")).toBeVisible();

  await page.getByTestId("portfolio-search").fill(unique);
  const original = cardNamed(page, unique);
  await expect(original).toHaveCount(1);
  await expect(original.getByTestId("project-task-count")).toHaveText("12");

  // busca sem correspondência explica o estado
  await page.getByTestId("portfolio-search").fill("nada-igual-a-isto-9f3");
  await expect(page.getByTestId("portfolio-no-match")).toBeVisible();
  await page.getByTestId("portfolio-search").fill(unique);

  // --- duplicar ------------------------------------------------------------
  await original.getByRole("button", { name: "Duplicar" }).click();
  const copy = cardNamed(page, copyName);
  await expect(copy).toHaveCount(1);

  // --- abrir pelo card -----------------------------------------------------
  await original.getByTestId("project-link").click();
  await expect(page.getByTestId("workspace")).toBeVisible();
  await expect(page.getByTestId("workspace")).toHaveAttribute("data-project-id", projectId);

  // --- excluir e desfazer --------------------------------------------------
  await page.getByTestId("brand").click();
  await page.getByTestId("portfolio-search").fill(copyName);
  const copyCard = cardNamed(page, copyName);
  await copyCard.getByRole("button", { name: "Excluir" }).click();

  await expect(page.getByTestId("undo-bar")).toBeVisible();
  await page.getByTestId("undo-delete").click();
  await expect(page.getByTestId("undo-bar")).toBeHidden();
  await expect(copyCard).toHaveCount(1);

  // --- limpeza -------------------------------------------------------------
  await copyCard.getByRole("button", { name: "Excluir" }).click();
  await expect(copyCard).toHaveCount(0);

  await page.getByTestId("portfolio-search").fill(unique);
  await cardNamed(page, unique).getByRole("button", { name: "Excluir" }).click();
  await expect(cardNamed(page, unique)).toHaveCount(0);

  expect(errors).toEqual([]);
});
