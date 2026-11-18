import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const WORKDAY = 9 * 60 * 60 * 1000; // turno padrão 09:00–18:00

/**
 * Datas FIXAS (não relativas a hoje) para que as capturas sejam
 * determinísticas; a linha de hoje é mascarada no screenshot.
 */
const PROJECT_START = Date.UTC(2026, 0, 5);

const PRESETS = ["hours", "days", "weeks", "months", "quarters", "years"];
const THEMES = ["light", "dark"];
const DENSITIES = ["comfortable", "compact"];

async function seed(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/projects", {
    data: { name: "Visual Gantt", start: PROJECT_START },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const now = Date.now();

  const rows = [
    { name: "Fase 1", level: 0, days: 0, span: 10 },
    { name: "Levantamento", level: 1, days: 1, span: 4 },
    { name: "Especificação", level: 1, days: 6, span: 4 },
    { name: "Fase 2", level: 0, days: 12, span: 12 },
    { name: "Desenvolvimento", level: 1, days: 13, span: 6 },
    { name: "Homologação", level: 1, days: 20, span: 4 },
    { name: "Entrega", level: 0, days: 26, span: 0 },
  ];

  const counters: number[] = [];
  const parents: Array<string | null> = [];
  const stack: string[] = [];
  const numbers: string[] = [];

  rows.forEach((row, index) => {
    stack.length = row.level;
    counters.length = row.level + 1;
    counters[row.level] = (counters[row.level] ?? 0) + 1;
    numbers[index] = counters.slice(0, row.level + 1).join(".");
    parents[index] = row.level > 0 ? (stack[row.level - 1] ?? null) : null;
    stack[row.level] = `vis-${index}`;
  });

  const tasks = rows.map((row, index) => {
    const start = PROJECT_START + row.days * DAY;
    const isMilestone = row.span === 0;
    return {
      id: `vis-${index}`,
      projectId: project.id,
      parentId: parents[index],
      outlineLevel: row.level,
      outlineNumber: numbers[index],
      sortOrder: index,
      name: row.name,
      start,
      // conv. inclusive: término no último dia trabalhado
      finish: isMilestone ? start : start + Math.max(0, row.span - 1) * DAY,
      duration: isMilestone ? 0 : row.span * WORKDAY,
      durationUnit: "day",
      percentComplete: index % 3 === 0 ? 60 : 10,
      isSummary: rows[index + 1] !== undefined && rows[index + 1]!.level > row.level,
      isMilestone,
      isInactive: false,
      schedulingMode: "auto",
      taskType: "fixed_duration",
      effortDriven: true,
      priority: 500,
      createdAt: now,
      updatedAt: now,
    };
  });

  const synced = await request.post(`/api/projects/${project.id}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);
  return project.id;
}

test("suíte visual do Gantt: presets × temas × densidades", async ({ page, request }) => {
  test.setTimeout(300_000);

  const projectId = await seed(request);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("gantt").first()).toBeVisible();
  await expect(page.getByTestId("gantt-bar").first()).toBeVisible();

  // a captura é do elemento Gantt: sem a Timeline, ele ocupa a altura
  // natural (as capturas medem o rendering do Gantt, não o layout da página)
  await page.getByTestId("timeline-toggle").click();
  await expect(page.getByTestId("timeline")).toHaveCount(0);

  for (const theme of THEMES) {
    await page.getByTestId("theme-select").selectOption(theme);

    for (const density of DENSITIES) {
      await page.getByTestId("density-select").selectOption(density);

      for (const preset of PRESETS) {
        await page.getByTestId("zoom-preset").selectOption(preset);
        await expect(page.getByTestId("zoom-preset")).toHaveValue(preset);

        await expect(page.getByTestId("gantt")).toHaveScreenshot(
          `gantt-${preset}-${theme}-${density}.png`,
          {
            animations: "disabled",
            caret: "hide",
            // a linha de hoje muda todo dia: mascara para manter a captura estável
            mask: [page.getByTestId("today-line")],
            maxDiffPixelRatio: 0.02,
          },
        );
      }
    }
  }
});
