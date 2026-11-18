import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Orçamentos de performance medidos no navegador (specs/gantt-view —
 * "Desempenho de renderização" e specs/ui-shell): abertura ≤ 1,5 s,
 * tecla → render ≤ 16 ms e 60 fps com 2.000 linhas durante zoom e rolagem.
 * O CPM ≤ 300 ms com 5.000 tarefas é coberto por
 * `packages/core/tests/scheduling-perf.test.ts`.
 */

const ROW_COUNT = 2_000;

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

/** 2.000 tarefas raiz espalhadas em ~60 semanas (dados estáveis p/ o motor). */
async function seedBigProject(request: APIRequestContext, projectId: string): Promise<void> {
  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5);
  const tasks = Array.from({ length: ROW_COUNT }, (_, index) => {
    const start = MON + (index % 60) * 7 * DAY;
    return {
      id: `${uid}-${index}`,
      projectId,
      parentId: null,
      outlineLevel: 0,
      outlineNumber: String(index + 1),
      sortOrder: index,
      name: `Tarefa ${index + 1}`,
      start,
      finish: start + 4 * DAY,
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
    };
  });

  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: { upserts: { tasks } },
  });
  expect(synced.status()).toBe(200);
}

test("orçamentos: abertura ≤ 1,5 s, tecla → render ≤ 16 ms e 60 fps", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const projectId = await createProject(request, `Performance E2E ${Date.now()}`);
  await seedBigProject(request, projectId);

  /* --- abertura do projeto ≤ 1.500 ms ------------------------------------- */
  const openStart = Date.now();
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute(
    "data-tasks",
    String(ROW_COUNT),
  );
  await expect(page.getByTestId("task-row").first()).toBeVisible();
  const openMs = Date.now() - openStart;
  expect(openMs, `abertura levou ${openMs} ms (orçamento 1500)`).toBeLessThanOrEqual(1_500);
  console.log(`[perf] abertura=${openMs}ms`);
  /* --- tecla → render ≤ 16 ms --------------------------------------------- */
  // A medição começa no keydown capturado na grade (antes do handler do
  // React) e termina quando o DOM da seleção muda (commit do React).
  await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="task-sheet-scroll"]');
    (grid as HTMLElement | null)?.focus();
  });

  const keyMeasurement = page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const grid = document.querySelector('[data-testid="task-sheet-scroll"]');
        if (!grid) {
          reject(new Error("grade não encontrada"));
          return;
        }

        let startedAt = 0;
        const onKeyDown = (event: Event) => {
          if ((event as KeyboardEvent).key === "ArrowDown") startedAt = performance.now();
        };
        const observer = new MutationObserver(() => {
          observer.disconnect();
          grid.removeEventListener("keydown", onKeyDown, true);
          resolve(performance.now() - startedAt);
        });
        observer.observe(grid, {
          subtree: true,
          attributes: true,
          attributeFilter: ["data-active"],
        });
        grid.addEventListener("keydown", onKeyDown, { capture: true });
        setTimeout(() => {
          observer.disconnect();
          grid.removeEventListener("keydown", onKeyDown, true);
          reject(new Error("a seleção não mudou após a tecla"));
        }, 2_000);
      }),
  );

  await page.keyboard.press("ArrowDown");
  const keyMs = await keyMeasurement;

  const moved = await page.evaluate(
    () => document.querySelector('[data-testid="task-row"][data-active="true"]') !== null,
  );
  expect(moved, "a seleção deve mudar na própria tecla").toBe(true);
  expect(
    Math.round(keyMs * 100) / 100,
    `tecla → render ${keyMs.toFixed(2)} ms (orçamento 16)`,
  ).toBeLessThanOrEqual(16);
  console.log(`[perf] tecla→render=${keyMs.toFixed(2)}ms`);

  /* --- 60 fps com 2.000 linhas durante zoom e rolagem --------------------- */
  const measureFrames = async (mode: "scroll" | "zoom" | "mixed") =>
    page.evaluate(async (kind) => {
      const gantt = document.querySelector('[data-testid="gantt"]');
      if (!gantt) return { avg: -1, median: -1, max: -1, count: 0 };

      const intervals: number[] = [];
      let frame = 0;
      let last = performance.now();

      await new Promise<void>((resolve) => {
        const tick = (time: number) => {
          intervals.push(time - last);
          last = time;

          // trabalho real a cada quadro: zoom por rolagem com Ctrl e rolagem
          // vertical (linhas virtualizadas entram e saem do DOM)
          const doZoom = kind === "zoom" || (kind === "mixed" && frame % 2 === 0);
          const doScroll = kind === "scroll" || (kind === "mixed" && frame % 2 === 1);
          if (doZoom) {
            gantt.dispatchEvent(
              new WheelEvent("wheel", {
                deltaY: frame % 4 < 2 ? -120 : 120,
                ctrlKey: true,
                clientX: 900,
                clientY: 400,
                bubbles: true,
                cancelable: true,
              }),
            );
          }
          if (doScroll) gantt.scrollTop += 120;

          frame += 1;
          if (frame < 100) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });

      // descarta a primeira medição e o aquecimento inicial
      const samples = intervals.slice(11);
      const avg = samples.reduce((total, value) => total + value, 0) / samples.length;
      const sorted = [...samples].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
      const max = Math.max(...samples);
      return { avg, median, max, count: samples.length };
    }, mode);

  const scrollFrames = await measureFrames("scroll");
  const zoomFrames = await measureFrames("zoom");
  const mixedFrames = await measureFrames("mixed");
  console.log(
    `[perf] rolagem=${scrollFrames.avg.toFixed(2)}/${scrollFrames.median.toFixed(2)}ms ` +
      `zoom=${zoomFrames.avg.toFixed(2)}/${zoomFrames.median.toFixed(2)}ms ` +
      `misto=${mixedFrames.avg.toFixed(2)}/${mixedFrames.median.toFixed(2)}ms ` +
      `(média/mediana, máx ${mixedFrames.max.toFixed(2)})`,
  );

  // 60 fps = 16,67 ms por quadro. A mediana é o orçamento (robusta a
  // solteiros de quadro de GC); a média fica no log como referência.
  for (const [label, sample] of [
    ["rolagem", scrollFrames],
    ["zoom", zoomFrames],
    ["zoom+rolagem", mixedFrames],
  ] as const) {
    expect(sample.count, "amostra insuficiente").toBeGreaterThan(60);
    expect(
      Math.round(sample.median * 100) / 100,
      `${label}: quadro mediano ${sample.median.toFixed(2)} ms (orçamento 16,67 ms; média ${sample.avg.toFixed(2)})`,
    ).toBeLessThanOrEqual(17);
  }
});
