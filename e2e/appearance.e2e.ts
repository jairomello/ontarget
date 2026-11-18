import { expect, test } from "@playwright/test";

/**
 * Paleta de cor persistida na conta (specs/user-profile — "Aparência guardada
 * na conta" e specs/ui-shell — "Paletas de cor").
 */
test("trocar a paleta sobrevive ao recarregamento", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("profile-menu").click();
  await page.getByTestId("palette-violet").click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "violet");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("profile-menu-panel")).toHaveCount(0);

  await page.reload();

  // A preferência vem da conta, não do cache do navegador.
  await expect(page.locator("html")).toHaveAttribute("data-palette", "violet");

  // Devolve ao padrão para não afetar as capturas visuais dos outros testes.
  await page.getByTestId("profile-menu").click();
  await page.getByTestId("palette-indigo").click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "indigo");
  await page.keyboard.press("Escape");
});

test("a paleta escolhida também fica salva na página de conta", async ({ page }) => {
  await page.goto("/conta");
  await expect(page.getByTestId("account-page")).toBeVisible();

  await page.getByTestId("appearance-palette-emerald").click();
  await expect(page.getByTestId("appearance-palette-emerald")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute("data-palette", "emerald");

  await page.reload();
  await expect(page.getByTestId("appearance-palette-emerald")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await page.getByTestId("appearance-palette-indigo").click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "indigo");
});
