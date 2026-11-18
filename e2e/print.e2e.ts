import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Modo de impressão (specs/printing): pré-visualização com páginas de tamanho
 * real, cabeçalho/rodapé configuráveis, seleção de conteúdo e colunas,
 * escala e orientação — verificando por captura de página que o resultado
 * não corta barras nem repete o cabeçalho da listagem indevidamente.
 */

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

async function seedTasks(
  request: APIRequestContext,
  projectId: string,
  count: number,
): Promise<void> {
  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5);

  const tasks = Array.from({ length: count }, (_, index) => {
    const start = MON + index * (count > 10 ? 1 : 7) * DAY;
    return {
      id: `${uid}-${index}`,
      projectId,
      parentId: null,
      outlineLevel: 0,
      outlineNumber: String(index + 1),
      sortOrder: index,
      name: `Tarefa ${String(index + 1).padStart(2, "0")}`,
      start,
      finish: count > 10 ? start : start + 4 * DAY,
      duration: count > 10 ? WORKDAY : 5 * WORKDAY,
      durationUnit: "day",
      percentComplete: index % 2 === 0 ? 40 : 0,
      isSummary: false,
      isMilestone: false,
      isInactive: false,
      schedulingMode: "auto",
      taskType: "fixed_duration",
      effortDriven: true,
      priority: 500,
      createdAt: now,
      updatedAt: now,
    };
  });

  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);
}

test("impressão: páginas fiéis, sem cortar barras e com cabeçalho correto", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectName = `Impressão E2E ${Date.now()}`;
  const projectId = await createProject(request, projectName);
  await seedTasks(request, projectId, 5);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "5");

  // itens na Timeline: a impressão deve incluí-la no topo da primeira página
  await page.getByTestId("timeline-add-select").selectOption({ index: 1 });
  await page.getByTestId("timeline-add").click();
  await page.getByTestId("timeline-add-select").selectOption({ label: "Tarefa 02" });
  await page.getByTestId("timeline-add").click();
  await expect(page.getByTestId("timeline-item")).toHaveCount(2);

  // zoom alto na tela: a escala fixa de impressão (100% = zoom da tela)
  // fica maior que a página e precisa quebrar em fatias
  await page.getByTestId("zoom-preset").selectOption("hours");

  /* --- entrar no modo de impressão ---------------------------------------- */
  await page.getByTestId("ribbon-tab-projeto").click();
  await page.getByTestId("print-open").click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/print$`));
  await expect(page.getByTestId("print-toolbar")).toBeVisible();
  await expect(page.getByTestId("print-page").first()).toBeVisible();
  // o agendamento define o destaque crítico: espera estabilizar antes da captura
  await expect(page.getByTestId("print-root")).toHaveAttribute("data-schedule", "ready");

  /* --- página A4 em paisagem (96 dpi) -------------------------------------- */
  const paperBox = (await page.getByTestId("print-page").first().boundingBox())!;
  expect(Math.abs(paperBox.width - (297 * 96) / 25.4)).toBeLessThan(3);
  expect(Math.abs(paperBox.height - (210 * 96) / 25.4)).toBeLessThan(3);

  const pageCount = await page.getByTestId("print-page").count();

  // a Timeline visível aparece no topo da primeira página (specs/timeline-view)
  await expect(
    page.getByTestId("print-page").first().getByTestId("print-timeline"),
  ).toHaveCount(1);

  /* --- cabeçalho e rodapé -------------------------------------------------- */
  await expect(page.getByTestId("print-header").first()).toContainText(projectName);
  await expect(page.getByTestId("print-page-number").last()).toHaveText(
    `Página ${pageCount} de ${pageCount}`,
  );

  /* --- legenda apenas na última página ------------------------------------- */
  await expect(page.getByTestId("print-legend")).toHaveCount(1);
  await expect(
    page.getByTestId("print-page").last().getByTestId("print-legend"),
  ).toHaveCount(1);

  /* --- listagem de 5 tarefas: cabeçalho de colunas UMA vez ------------------ */
  await expect(page.getByTestId("print-table")).toHaveCount(1);
  await expect(page.getByTestId("print-table-header")).toHaveCount(1);

  /* --- nenhuma barra cortada ----------------------------------------------- */
  const barsFit = await page.evaluate(() => {
    const bodies = Array.from(
      document.querySelectorAll('[data-testid="print-gantt-body"]'),
    );
    return bodies.every((body) => {
      const box = body.getBoundingClientRect();
      const bars = Array.from(body.querySelectorAll('[data-testid="print-bar"]'));
      return bars.every((bar) => {
        const rect = bar.getBoundingClientRect();
        return (
          rect.left >= box.left - 1 &&
          rect.right <= box.right + 1 &&
          rect.top >= box.top - 1 &&
          rect.bottom <= box.bottom + 1
        );
      });
    });
  });
  expect(barsFit).toBe(true);

  /* --- seleção de conteúdo: imprimir só o Gantt ----------------------------- */
  await page.getByTestId("print-view-sheet").uncheck();
  await expect(page.getByTestId("print-table")).toHaveCount(0);
  await expect(page.getByTestId("print-gantt").first()).toBeVisible();
  await page.getByTestId("print-view-sheet").check();
  await expect(page.getByTestId("print-table")).toHaveCount(1);

  /* --- seleção de colunas --------------------------------------------------- */
  await page.getByTestId("print-columns-toggle").click();
  await page.getByTestId("print-column-duration").uncheck();
  await expect(page.getByTestId("print-table-header")).not.toContainText("Duração");
  await page.getByTestId("print-column-duration").check();
  await expect(page.getByTestId("print-table-header")).toContainText("Duração");

  /* --- orientação ----------------------------------------------------------- */
  await page.getByTestId("print-orientation").selectOption("portrait");
  const portraitBox = (await page.getByTestId("print-page").first().boundingBox())!;
  expect(portraitBox.width).toBeLessThan(portraitBox.height);
  await page.getByTestId("print-orientation").selectOption("landscape");

  /* --- escala: auto, largura e fixa (fixa quebra em fatias) ------------------ */
  const pagesAuto = await page.getByTestId("print-page").count();
  await expect(page.getByTestId("print-scale").locator("option")).toHaveCount(3);
  await page.getByTestId("print-scale").selectOption("fixed");
  await expect(page.getByTestId("print-fixed-percent")).toBeVisible();
  await expect
    .poll(() => page.getByTestId("print-page").count())
    .toBeGreaterThan(pagesAuto);

  await page.getByTestId("print-scale").selectOption("auto");
  await expect.poll(() => page.getByTestId("print-page").count()).toBe(pagesAuto);

  /* --- captura de página ---------------------------------------------------- */
  await expect(page.getByTestId("print-pages")).toHaveScreenshot("print-preview.png", {
    animations: "disabled",
    caret: "hide",
    // a data do rodapé muda a cada render: mascarada para manter estável
    mask: [page.getByTestId("print-footer-date")],
    maxDiffPixelRatio: 0.03,
  });

  /* --- PDF gerado a partir do layout de impressão --------------------------- */
  const pdf = await page.pdf({ preferCSSPageSize: true });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.length).toBeGreaterThan(5_000);

  /* --- listagem longa: cabeçalho repetido em cada página da tabela ---------- */
  const projectId2 = await createProject(request, `${projectName} longa`);
  await seedTasks(request, projectId2, 60);

  await page.goto(`/p/${projectId2}/print`);
  await expect(page.getByTestId("print-root")).toHaveAttribute("data-schedule", "ready");
  await expect(page.getByTestId("print-page").first()).toBeVisible();

  const tablePages = await page.getByTestId("print-table").count();
  expect(tablePages).toBeGreaterThanOrEqual(2); // é multi-página: repete…
  expect(await page.getByTestId("print-table-header").count()).toBe(tablePages); // …nunca em excesso
  await expect(page.getByTestId("print-legend")).toHaveCount(1);
  await expect(page.getByTestId("print-page-number").last()).toContainText("de");

  expect(errors).toEqual([]);
});
