import { expect, test } from "@playwright/test";

/**
 * Fluxos de entrada (specs/user-auth): primeiro acesso, bloqueio sem sessão,
 * senha errada, login e logout.
 *
 * O `globalSetup` já criou a conta e gravou a sessão em `e2e/.auth/user.json`;
 * os casos abaixo desligam a sessão com `test.use` e criam a própria.
 */

const EMAIL = "e2e@ontarget.local";
const PASSWORD = "senha-e2e-bem-longa";

test.describe("sem sessão", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a home é bloqueada e o login preserva a rota pedida", async ({ page }) => {
    await page.goto("/p/qualquer");

    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByTestId("login-email")).toBeVisible();
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
  });

  test("senha errada mostra a mensagem genérica do servidor", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(EMAIL);
    await page.getByTestId("login-password").fill("senha-completamente-errada");
    await page.getByTestId("login-submit").click();

    await expect(page.getByTestId("login-error")).toHaveText("E-mail ou senha incorretos");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login válido entra e devolve à rota pretendida", async ({ page }) => {
    await page.goto("/p/qualquer");
    await expect(page).toHaveURL(/\/login\?next=/);

    await page.getByTestId("login-email").fill(EMAIL);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByTestId("login-submit").click();

    await expect(page).toHaveURL(/\/p\/qualquer/);
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });

  test("sem conta na instalação o primeiro acesso é oferecido", async ({ page }) => {
    // Banco real já tem a conta; isola a tela de primeiro acesso pelo estado.
    await page.route("**/api/auth/state", (route) => route.fulfill({ json: { needsSetup: true } }));
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 401,
        json: { error: { code: "unauthorized", message: "Sessão inválida ou expirada" } },
      }),
    );

    await page.goto("/");
    await expect(page).toHaveURL(/\/primeiro-acesso/);
    await expect(page.getByTestId("setup-name")).toBeVisible();

    // Validação local antes de qualquer requisição.
    await page.getByTestId("setup-name").fill("Dono");
    await page.getByTestId("setup-email").fill(EMAIL);
    await page.getByTestId("setup-password").fill("curta");
    await page.getByTestId("setup-confirm").fill("curta");
    await page.getByTestId("setup-submit").click();
    await expect(page.getByTestId("setup-error")).toContainText("no mínimo 10 caracteres");

    // Com dados válidos o servidor responde que a conta inicial já existe.
    await page.getByTestId("setup-password").fill(PASSWORD);
    await page.getByTestId("setup-confirm").fill(PASSWORD);
    await page.getByTestId("setup-submit").click();
    await expect(page.getByTestId("setup-error")).toContainText("já criada");
    await expect(page).toHaveURL(/\/primeiro-acesso/);
  });

  test("login cria sessão que volta a proteger as rotas", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(EMAIL);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("app-shell")).toBeVisible();

    // A sessão vale para novas navegações no mesmo contexto.
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();

    // Logout encerra a sessão no servidor.
    const response = await page.request.post("/api/auth/logout");
    expect(response.ok()).toBe(true);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
  });
});

test.describe("com sessão", () => {
  test("a conta do E2E está autenticada", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("brand")).toHaveText("ontarget");
  });
});
