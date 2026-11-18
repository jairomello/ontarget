import { expect, test } from "@playwright/test";

/** Coleta erros de console e erros não tratados da página. */
function collectPageErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  return errors;
}

test("a home carrega com o shell completo e sem erro de console", async ({ page }) => {
  const errors = collectPageErrors(page);

  await page.goto("/");

  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("app-bar")).toBeVisible();
  await expect(page.getByTestId("command-bar")).toBeVisible();
  await expect(page.getByTestId("status-bar")).toBeVisible();
  await expect(page.getByTestId("portfolio")).toBeVisible();
  await expect(page.getByTestId("brand")).toHaveText("e-project");

  expect(errors).toEqual([]);
});

test("as rotas do aplicativo respondem sem erro de console", async ({ page }) => {
  const errors = collectPageErrors(page);

  await page.goto("/p/projeto-de-exemplo");
  await expect(page.getByTestId("workspace")).toBeVisible();
  await expect(page.getByTestId("workspace")).toHaveAttribute(
    "data-project-id",
    "projeto-de-exemplo",
  );

  expect(errors).toEqual([]);
});

test("trocar tema e densidade reflete nos atributos do documento", async ({ page }) => {
  const errors = collectPageErrors(page);

  await page.goto("/");
  await page.getByTestId("theme-select").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByTestId("density-select").selectOption("compact");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");

  expect(errors).toEqual([]);
});
