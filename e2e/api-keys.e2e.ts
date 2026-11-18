import { expect, test } from "@playwright/test";

/**
 * Chaves de API (specs/api-keys): gerar, copiar uma vez, listar sem expor o
 * valor e revogar com confirmação.
 */
test("gerar, copiar, listar e revogar uma chave", async ({ page }) => {
  const name = `Agente ${Date.now()}`;

  await page.goto("/conta#chaves");
  await expect(page.getByTestId("account-page")).toBeVisible();
  await expect(page.getByTestId("api-keys-guide")).toContainText("exibida uma única vez");

  await page.getByTestId("api-key-new").click();
  await page.getByTestId("api-key-name").fill(name);
  await page.getByTestId("api-key-create").click();

  // O valor aparece uma única vez, no diálogo de criação.
  const value = await page.getByTestId("api-key-created-value").textContent();
  expect(value).toMatch(/^ont_/);

  await page.getByTestId("api-key-copy").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(value);

  await page.getByTestId("api-key-created-close").click();
  await expect(page.getByTestId("api-key-created-value")).toHaveCount(0);

  // A listagem traz nome e datas, nunca o valor.
  const list = page.getByTestId("api-keys-list");
  await expect(list).toContainText(name);
  expect(await list.textContent()).not.toContain(value ?? "valor-ausente");

  // Revogação exige confirmação e some da lista.
  await page.getByTestId("api-key-revoke").last().click();
  await expect(page.getByTestId("api-key-revoke-confirm")).toBeVisible();
  await page.getByTestId("api-key-revoke-cancel").click();
  await expect(page.getByTestId("api-key-revoke-confirm")).toHaveCount(0);

  await page.getByTestId("api-key-revoke").last().click();
  await page.getByTestId("api-key-revoke-confirm").click();
  // Contagem, não `not.toContainText`: com a lista vazia o próprio elemento
  // some da página e o Playwright exige que ele exista.
  await expect(page.getByTestId("api-key-item")).toHaveCount(0);
  await expect(page.getByTestId("api-keys-empty")).toBeVisible();
});

test.describe("sem sessão", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("as chaves não são acessíveis", async ({ page }) => {
    await page.goto("/conta#chaves");
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByTestId("account-page")).toHaveCount(0);
  });
});
