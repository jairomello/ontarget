import { expect, test } from "@playwright/test";

/**
 * Menu de perfil e conta (specs/user-profile): abrir o menu, chegar à conta,
 * salvar o nome, trocar a senha e sair.
 *
 * A senha é trocada e devolvida no mesmo teste: a conta é a mesma que o
 * `globalSetup` usa. Se o teste interromper no meio, rode
 * `bun run auth:reset` para destravar a próxima execução.
 */
const EMAIL = "e2e@ontarget.local";
const CURRENT_PASSWORD = "senha-e2e-bem-longa";
const TEMP_PASSWORD = "senha-e2e-temporaria";

/**
 * O teste encerra com logout, que revoga a sessão no servidor — por isso a
 * suíte inteira nasce sem sessão e faz o login próprio (a sessão do
 * `globalSetup` fica intacta para os demais arquivos).
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(CURRENT_PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
}

test("menu de perfil leva à conta, salva nome, troca senha e sai", async ({ page }) => {
  const originalName = "E2E";

  await login(page);

  /* --- menu de perfil ---------------------------------------------------- */
  const trigger = page.getByTestId("profile-menu");
  await expect(trigger).toBeVisible();

  await trigger.click();
  const panel = page.getByTestId("profile-menu-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("profile-menu-email")).toHaveText(EMAIL);
  await expect(page.getByTestId("profile-menu-name")).toContainText(originalName);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  /* --- conta ------------------------------------------------------------- */
  await trigger.click();
  await page.getByTestId("profile-menu-account").click();
  await expect(page).toHaveURL(/\/conta$/);
  await expect(page.getByTestId("account-page")).toBeVisible();
  await expect(page.getByTestId("account-email")).toHaveValue(EMAIL);

  /* --- nome de exibição -------------------------------------------------- */
  const nameField = page.getByTestId("account-name");
  await nameField.fill("E2E Renomeado");
  await page.getByTestId("account-name-save").click();
  await expect(page.getByTestId("account-success")).toHaveText("Nome salvo");

  // O menu (fechado até aqui) mostra o nome já atualizado.
  await trigger.click();
  await expect(page.getByTestId("profile-menu-name")).toContainText("E2E Renomeado");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("profile-menu-panel")).toHaveCount(0);

  await nameField.fill(originalName);
  await page.getByTestId("account-name-save").click();
  await expect(page.getByTestId("account-success")).toHaveText("Nome salvo");

  /* --- troca de senha (e volta) ------------------------------------------ */
  await page.getByTestId("account-password-current").fill(CURRENT_PASSWORD);
  await page.getByTestId("account-password-new").fill(TEMP_PASSWORD);
  await page.getByTestId("account-password-confirm").fill(TEMP_PASSWORD);
  await page.getByTestId("account-password-submit").click();
  await expect(page.getByTestId("account-password-success")).toHaveText("Senha alterada");

  await page.getByTestId("account-password-current").fill(TEMP_PASSWORD);
  await page.getByTestId("account-password-new").fill(CURRENT_PASSWORD);
  await page.getByTestId("account-password-confirm").fill(CURRENT_PASSWORD);
  await page.getByTestId("account-password-submit").click();
  await expect(page.getByTestId("account-password-success")).toHaveText("Senha alterada");

  /* --- sair -------------------------------------------------------------- */
  await trigger.click();
  await page.getByTestId("profile-menu-logout").click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("app-shell")).toHaveCount(0);

  // A sessão foi revogada: voltar à raiz manda para o login de novo.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  /**
   * A troca de senha revoga as demais sessões da conta — inclusive a que o
   * `globalSetup` grava em `e2e/.auth/user.json` para os demais arquivos.
   * Reentra e regrava o `storageState` para a suíte continuar autenticada.
   */
  await login(page);
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});

test("nome recusado aparece como erro sem alterar a conta", async ({ page }) => {
  await login(page);
  await page.goto("/conta");
  await expect(page.getByTestId("account-page")).toBeVisible();

  await page.getByTestId("account-name").fill("   ");
  await page.getByTestId("account-name-save").click();

  await expect(page.getByTestId("account-error")).toContainText("1 a 200 caracteres");
  await expect(page.getByTestId("account-name")).toHaveValue("   ");
});

test("enviar, recortar e remover a foto de perfil", async ({ page }) => {
  await login(page);
  await page.goto("/conta");
  await expect(page.getByTestId("account-page")).toBeVisible();

  // PNG 1×1 válido (assinatura PNG + IEND), enviado pelo campo de arquivo.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  await page.getByTestId("account-photo-input").setInputFiles({
    name: "foto.png",
    mimeType: "image/png",
    buffer: png,
  });

  // Recorte aparece antes do envio.
  await expect(page.getByTestId("crop-stage")).toBeVisible();
  await page.getByTestId("crop-confirm").click();

  await expect(page.getByTestId("account-avatar")).toBeVisible();
  await expect(page.getByTestId("account-success")).toHaveText("Foto atualizada");
  await expect(page.locator('img[data-testid="account-avatar"]')).toHaveJSProperty(
    "complete",
    true,
  );

  // Remover volta às iniciais.
  await page.getByTestId("account-photo-remove").click();
  await expect(page.getByTestId("account-initials")).toBeVisible();
  await expect(page.getByTestId("account-avatar")).toHaveCount(0);

  // Arquivo que não é imagem é recusado antes de qualquer requisição.
  await page.getByTestId("account-photo-input").setInputFiles({
    name: "nota.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("não é imagem"),
  });
  await expect(page.getByTestId("account-error")).toContainText("Escolha uma imagem");
  await expect(page.getByTestId("account-initials")).toBeVisible();
});
