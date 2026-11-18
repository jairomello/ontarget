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
 * Formulário de detalhes sob demanda (PRD §8.1, item 19):
 * `F4` abre, `Esc` fecha e devolve o foco à célula ativa.
 */
test("F4 abre os detalhes, Esc fecha e devolve o foco à célula", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Detalhes E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);

  const rows = page.getByTestId("task-row");
  await expect(rows).toHaveCount(12);

  // nada de formulário antes do pedido do usuário
  await expect(page.getByTestId("task-form")).toHaveCount(0);

  await rows.first().click();
  await expect(rows.first()).toHaveAttribute("data-active", "true");

  // --- F4 abre ------------------------------------------------------------
  await page.keyboard.press("F4");
  const form = page.getByTestId("task-form");
  await expect(form).toBeVisible();
  await expect(page.getByTestId("task-form-title")).not.toHaveText("Nenhuma tarefa selecionada");

  // --- edição no form reflete imediatamente na grade ----------------------
  const originalName = (await rows.first().locator("[data-testid='cell-name']").textContent())!;
  const nameInput = page.getByTestId("form-name");
  await nameInput.fill("Nome alterado pelo form");
  await expect(rows.first().locator("[data-testid='cell-name']")).toContainText(
    "Nome alterado pelo form",
  );

  // --- Esc fecha ----------------------------------------------------------
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);

  // --- foco devolvido à célula: navegação segue funcionando ---------------
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("data-active", "true");

  // --- e o valor editado persiste ----------------------------------------
  await expect(rows.first().locator("[data-testid='cell-name']")).toContainText(
    "Nome alterado pelo form",
  );
  expect(originalName).not.toBe("Nome alterado pelo form");

  // --- botão "Detalhes" na barra de status também alterna -----------------
  await page.getByTestId("details-toggle").click();
  await expect(form).toBeVisible();
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("details-toggle").click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-pressed", "false");

  expect(errors).toEqual([]);
});
