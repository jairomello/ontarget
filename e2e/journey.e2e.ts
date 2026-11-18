import { expect, test } from "@playwright/test";

/**
 * Jornada de ponta a ponta (docs/architecture.md §11): criar projeto pela
 * interface → estruturar a WBS por teclado → vincular → atribuir recurso →
 * salvar baseline → atualizar progresso → imprimir PDF, verificando o
 * estado final no servidor.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

test("jornada completa: criar → WBS por teclado → vincular → atribuir → baseline → progresso → PDF", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  /* --- 1. criar projeto pela interface ------------------------------------ */
  await page.goto("/");
  await page.getByTestId("new-project").click();
  const projectName = `Jornada E2E ${Date.now()}`;
  await page.getByTestId("new-project-name").fill(projectName);
  await page.getByTestId("new-project-template").selectOption("vazio");
  await page.getByTestId("new-project-submit").click();

  await expect(page.getByTestId("workspace")).toBeVisible();
  const projectId = (await page.getByTestId("workspace").getAttribute("data-project-id"))!;
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "0");

  const row = (index: number) => page.getByTestId("task-row").nth(index);
  const rename = async (target: ReturnType<typeof row>, name: string) => {
    await target.getByTestId("cell-name").dblclick();
    const editor = page.getByTestId("cell-editor");
    await editor.fill(name);
    await editor.press("Enter");
    await expect(editor).toHaveCount(0);
  };

  /* --- 2. estruturar a WBS por teclado ------------------------------------ */
  for (const name of ["Fase 1", "Tarefa A", "Tarefa B"]) {
    await page.getByTestId("add-task").click();
    await rename(page.getByTestId("task-row").last(), name);
  }
  await expect(page.getByTestId("task-row")).toHaveCount(3);

  // seleciona Tarefa A + Tarefa B e indenta o bloco (Ctrl+Shift+→)
  await row(1).getByTestId("cell-name").click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Control+Shift+ArrowRight");

  await expect(row(1)).toHaveAttribute("data-depth", "1");
  await expect(row(2)).toHaveAttribute("data-depth", "1");
  await expect(row(1).getByTestId("cell-wbs")).toHaveText("1.1");
  await expect(row(2).getByTestId("cell-wbs")).toHaveText("1.2");

  /* --- 3. vincular pela coluna de predecessores (1.2 ← 1.1) --------------- */
  await row(2).getByTestId("cell-pred").dblclick();
  await page.getByTestId("cell-editor").fill("1.1");
  await page.getByTestId("cell-editor").press("Enter");
  await expect(row(2).getByTestId("cell-pred")).toHaveText("1.1");

  /* --- 4. cadastro de recurso e atribuição pela coluna -------------------- */
  await page.getByTestId("resources-toggle").click();
  await expect(page.getByTestId("resources-panel")).toBeVisible();
  await page.getByTestId("person-name").fill("Ana Silva");
  await page.getByTestId("person-initials").fill("AS");
  await page.getByTestId("person-add").click();
  await expect(page.getByTestId("person-row")).toHaveCount(1);
  await page.getByTestId("resources-close").click();

  await row(2).getByTestId("cell-res").dblclick();
  await page.getByTestId("cell-editor").selectOption({ label: "Ana Silva" });
  await expect(row(2).getByTestId("cell-res")).toHaveText("Ana Silva");

  /* --- 5. salvar baseline ------------------------------------------------- */
  await page.getByTestId("baseline-toggle").click();
  await expect(page.getByTestId("baselines-panel")).toBeVisible();
  await page.getByTestId("baseline-name").fill("Baseline 1");
  await page.getByTestId("baseline-save").click();
  await expect(page.getByTestId("baseline-row")).toHaveCount(1);
  await page.getByTestId("baselines-close").click();

  /* --- 6. atualizar progresso (50% na Tarefa A) --------------------------- */
  await row(1).getByTestId("cell-percent").dblclick();
  await page.getByTestId("cell-editor").fill("50");
  await page.getByTestId("cell-editor").press("Enter");
  await expect(row(1).getByTestId("cell-percent")).toHaveText("50%");

  /* --- 7. imprimir: PDF a partir do modo de impressão --------------------- */
  await page.getByTestId("ribbon-tab-projeto").click();
  await page.getByTestId("print-open").click();
  await expect(page).toHaveURL(/\/print$/);
  await expect(page.getByTestId("print-page").first()).toBeVisible();
  await expect(page.getByTestId("print-root")).toHaveAttribute("data-schedule", "ready");

  const pdf = await page.pdf({ preferCSSPageSize: true });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.length).toBeGreaterThan(5_000);

  /* --- 8. estado final conferido no servidor ------------------------------ */
  const detail = (await (await request.get(`/api/projects/${projectId}`)).json()) as any;
  const tasks: any[] = detail.data.tasks;
  expect(tasks).toHaveLength(3);

  const byName = new Map(tasks.map((task) => [task.name, task]));
  expect(byName.get("Fase 1")!.outlineNumber).toBe("1");
  expect(byName.get("Fase 1")!.isSummary).toBe(true);
  expect(byName.get("Tarefa A")!.outlineNumber).toBe("1.1");
  expect(byName.get("Tarefa B")!.parentId).toBe(byName.get("Fase 1")!.id);
  expect(byName.get("Tarefa A")!.percentComplete).toBe(50);

  expect(detail.data.taskLinks).toHaveLength(1);
  expect(detail.data.taskLinks[0].predecessorId).toBe(byName.get("Tarefa A")!.id);
  expect(detail.data.taskLinks[0].successorId).toBe(byName.get("Tarefa B")!.id);

  expect(detail.data.resources.map((resource: any) => resource.name)).toEqual(["Ana Silva"]);
  expect(detail.data.assignments).toHaveLength(1);
  expect(detail.data.assignments[0].taskId).toBe(byName.get("Tarefa B")!.id);
  expect(detail.data.assignments[0].units).toBe(1);

  expect(detail.data.baselines.map((baseline: any) => baseline.name)).toEqual(["Baseline 1"]);

  expect(errors).toEqual([]);
});
