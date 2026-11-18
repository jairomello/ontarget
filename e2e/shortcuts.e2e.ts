import { expect, test } from "@playwright/test";

/**
 * Overlay de atalhos (specs/ui-shell — "Overlay de atalhos"):
 * aberto por `?`, lista gerada do keymap, fechado por `Escape`.
 */
test("o overlay de atalhos lista os bindings registrados", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/");

  // fechado por padrão
  await expect(page.getByTestId("shortcuts-overlay")).toHaveCount(0);

  // abre com "?"
  await page.keyboard.press("?");
  const overlay = page.getByTestId("shortcuts-overlay");
  await expect(overlay).toBeVisible();

  const rows = page.getByTestId("shortcut-row");
  const count = await rows.count();
  expect(count).toBeGreaterThan(8);

  // bindings canônicos aparecem formatados
  await expect(page.getByText("Ctrl + Shift + Right")).toBeVisible();
  await expect(page.getByText("Indentar (virar subtarefa)")).toBeVisible();

  // fecha com Escape
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();

  // e reabre com "?"
  await page.keyboard.press("?");
  await expect(overlay).toBeVisible();
  await page.getByTestId("shortcuts-close").click();
  await expect(overlay).toBeHidden();

  expect(errors).toEqual([]);
});

test("digitar em um campo de texto não abre o overlay", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("portfolio-search").click();
  await page.keyboard.type("?");
  await expect(page.getByTestId("shortcuts-overlay")).toHaveCount(0);
  await expect(page.getByTestId("portfolio-search")).toHaveValue("?");
});
