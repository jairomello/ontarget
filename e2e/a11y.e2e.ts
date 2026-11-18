import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Acessibilidade (specs/ui-shell — "Acessibilidade por teclado e leitor de
 * tela"): operação completa só por teclado, papéis ARIA de tabela
 * hierárquica, contraste WCAG AA e `prefers-reduced-motion`.
 */

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

async function seedTasks(request: APIRequestContext, projectId: string): Promise<void> {
  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5);
  const names = ["Alfa", "Beta"];
  const tasks = names.map((name, index) => ({
    id: `${uid}-${index}`,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    start: MON + index * 7 * DAY,
    finish: MON + index * 7 * DAY + 4 * DAY,
    duration: 5 * WORKDAY,
    durationUnit: "day",
    percentComplete: 0,
    isSummary: false,
    isMilestone: false,
    isInactive: false,
    isPlaceholder: false,
    schedulingMode: "auto",
    taskType: "fixed_duration",
    effortDriven: true,
    priority: 500,
    createdAt: now,
    updatedAt: now,
  }));
  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);
}

test("acessibilidade: teclado, papéis ARIA, contraste e movimento reduzido", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `A11y E2E ${Date.now()}`);
  await seedTasks(request, projectId);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "2");

  /* --- 1. operação apenas por teclado ------------------------------------- */
  // navega até a grade só com Tab (percorre a barra de aplicação/comandos)
  let reachedGrid = false;
  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press("Tab");
    const testId = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    );
    if (testId === "task-sheet-scroll") {
      reachedGrid = true;
      break;
    }
  }
  expect(reachedGrid).toBe(true);

  // Insert: cria a terceira tarefa já selecionada para digitação direta
  await page.keyboard.press("Insert");
  await expect(page.getByTestId("task-row")).toHaveCount(3);
  await page.keyboard.type("Tarefa Nova");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-row").nth(2).getByTestId("cell-name")).toHaveText(
    "Tarefa Nova",
  );

  // Ctrl+Insert na Beta: cria a subtarefa dela (operação de hierarquia)
  await page.keyboard.press("ArrowUp"); // ← da Tarefa Nova para a Beta
  await page.keyboard.press("Control+Insert");
  await expect(page.getByTestId("task-row")).toHaveCount(4);
  await page.keyboard.type("Subtarefa");
  await page.keyboard.press("Enter");

  // ordem resultante: Alfa, Beta (resumo), Subtarefa (nível 2), Tarefa Nova
  await expect(page.getByTestId("task-row").nth(2)).toHaveAttribute("data-depth", "1");
  await expect(page.getByTestId("task-row").nth(2).getByTestId("cell-name")).toHaveText(
    "Subtarefa",
  );

  // vínculo pela coluna Predecessores: Ctrl+Home, desce até a Tarefa Nova e
  // navega pelas colunas até Predecessores — tudo pelo teclado
  await page.keyboard.press("Control+Home");
  for (let down = 0; down < 3; down += 1) await page.keyboard.press("ArrowDown");
  for (let right = 0; right < 4; right += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.type("1"); // Alfa = WBS 1
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-row").nth(3).getByTestId("cell-pred")).toHaveText("1");

  // salvamento automático fica visível (specs/ui-shell)
  await expect(page.getByTestId("status-save")).toHaveText("Salvo");

  /* --- 2. papéis ARIA de tabela hierárquica ------------------------------- */
  const grid = page.getByTestId("task-sheet-scroll");
  await expect(grid).toHaveAttribute("role", "treegrid");
  await expect(grid).toHaveAttribute("aria-multiselectable", "true");
  await expect(grid).toHaveAttribute("aria-label", "Folha de tarefas");

  await expect(grid.getByRole("columnheader").first()).toBeVisible();
  const rows = page.getByTestId("task-row");
  await expect(rows.first()).toHaveAttribute("role", "row");
  await expect(rows.first()).toHaveAttribute("aria-level", "1");
  await expect(rows.first()).toHaveAttribute("aria-selected", "false");
  await expect(rows.first().getByRole("gridcell").first()).toBeVisible();

  // Beta ganhou filho: linha de resumo com aria-expanded
  const betaRow = rows.nth(1);
  await expect(betaRow).toHaveAttribute("aria-expanded", "true");
  await expect(betaRow).toHaveAttribute("aria-selected", "false");

  // hierarquia: a subtarefa vive no nível 2; a seleção ficou na última
  // linha (Enter desce), onde o vínculo foi digitado
  await expect(rows.nth(2)).toHaveAttribute("aria-level", "2");
  await expect(rows.nth(2)).toHaveAttribute("aria-selected", "false");
  await expect(rows.nth(3)).toHaveAttribute("aria-selected", "true");

  /* --- 3. contraste de texto WCAG AA (4,5:1) ------------------------------ */
  // abre a aba Projeto: o botão de impressão é amostra de contraste e depois
  // é acionado pelo teclado
  await page.getByTestId("ribbon-tab-projeto").click();

  const contrasts = await page.evaluate(() => {
    const parse = (value: string): number[] =>
      (value.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
    const luminance = (rgb: number[]): number => {
      const channel = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return (
        0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!)
      );
    };
    const ratio = (fg: string, bg: string): number => {
      const a = luminance(parse(fg));
      const b = luminance(parse(bg));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const backgroundOf = (element: Element): string => {
      let node: Element | null = element;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && !bg.startsWith("rgba(0, 0, 0, 0)") && bg !== "transparent") return bg;
        node = node.parentElement;
      }
      return "rgb(255, 255, 255)";
    };

    const samples: Array<[string, string]> = [
      ["[data-testid='header-name']", "cor do cabeçalho"],
      ["[data-testid='cell-name']", "cor da célula"],
      ["[data-testid='status-save']", "cor do status"],
      ["[data-testid='add-task']", "cor do botão"],
      ["[data-testid='print-open']", "cor do botão de comando"],
    ];

    return samples.map(([selector, label]) => {
      const element = document.querySelector(selector);
      if (!element) return { label, ratio: 0, missing: true };
      const style = getComputedStyle(element);
      return {
        label,
        ratio: Math.round(ratio(style.color, backgroundOf(element)) * 100) / 100,
        missing: false,
      };
    });
  });

  for (const sample of contrasts) {
    expect(sample.missing, `${sample.label} não encontrado`).toBe(false);
    expect(sample.ratio, `${sample.label} contraste`).toBeGreaterThanOrEqual(4.5);
  }

  /* --- 4. prefers-reduced-motion ------------------------------------------ */
  const bar = page.getByTestId("gantt-bar").first();
  const normalDuration = await bar.evaluate(
    (element) => getComputedStyle(element).transitionDuration,
  );
  expect(normalDuration).not.toBe("0s"); // 120ms por padrão

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDuration = await bar.evaluate(
    (element) => getComputedStyle(element).transitionDuration,
  );
  expect(reducedDuration).toBe("0s"); // tokens zerados (specs/ui-shell)
  await page.emulateMedia({ reducedMotion: "no-preference" });

  /* --- 5. impressão acionada pelo teclado --------------------------------- */
  await page.getByTestId("print-open").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/print$/);
  await expect(page.getByTestId("print-page").first()).toBeVisible();

  expect(errors).toEqual([]);
});
