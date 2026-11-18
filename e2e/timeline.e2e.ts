import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Timeline (specs/timeline-view): visível por padrão com ocultar/restaurar,
 * adição por comando e por arraste da grade, personalização por item,
 * exportação PNG/cópia e — o foco da tarefa 10.1 — o recorte do intervalo
 * sincronizando zoom e rolagem do Gantt.
 */

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

/** Quatro tarefas de segunda a segunda (14 dias entre elas), ~46 dias de span. */
async function seedTasks(
  request: APIRequestContext,
  projectId: string,
): Promise<Record<string, string>> {
  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5);
  const names = ["Alfa", "Beta", "Gama", "Delta"];
  const ids: Record<string, string> = {};

  const tasks = names.map((name, index) => {
    const id = `${uid}-${index}`;
    ids[name] = id;
    const start = MON + index * 14 * DAY;
    return {
      id,
      projectId,
      parentId: null,
      outlineLevel: 0,
      outlineNumber: String(index + 1),
      sortOrder: index,
      name,
      start,
      finish: start + 4 * DAY, // seg a sex (término inclusivo)
      duration: 5 * WORKDAY,
      durationUnit: "day",
      work: 5 * WORKDAY,
      percentComplete: 0,
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
  return ids;
}

test("Timeline: adição, personalização e recorte sincronizado com o Gantt", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Timeline E2E ${Date.now()}`);
  const ids = await seedTasks(request, projectId);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "4");

  /* --- visível por padrão; ocultar e restaurar ---------------------------- */
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("timeline-empty")).toBeVisible();
  await expect(page.getByTestId("timeline-sync")).toBeChecked();

  await page.getByTestId("timeline-toggle").click();
  await expect(page.getByTestId("timeline")).toHaveCount(0);
  await page.getByTestId("timeline-toggle").click();
  await expect(page.getByTestId("timeline")).toBeVisible();

  /* --- adição por comando ------------------------------------------------- */
  await page.getByTestId("timeline-add-select").selectOption(ids.Alfa!);
  await page.getByTestId("timeline-add").click();
  await expect(page.getByTestId("timeline-item")).toHaveCount(1);
  await expect(page.getByTestId("timeline-empty")).toHaveCount(0);

  /* --- adição por arraste da Task Sheet ----------------------------------- */
  await page
    .locator(`[data-testid="task-row"][data-task-id="${ids.Gama}"]`)
    .dragTo(page.getByTestId("timeline-strip"));
  await expect(page.getByTestId("timeline-item")).toHaveCount(2);

  // a ordem da grade é preservada (Alfa antes de Gama)
  const order = await page.getByTestId("timeline-item").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.taskId),
  );
  expect(order).toEqual([ids.Alfa, ids.Gama]);

  /* --- personalização visual ---------------------------------------------- */
  const itemAlfa = page.locator(`[data-testid="timeline-item"][data-task-id="${ids.Alfa}"]`);
  await itemAlfa.click();
  await expect(page.getByTestId("timeline-item-editor")).toBeVisible();
  await page.getByTestId("timeline-item-color").fill("#ff0000");
  await page.getByTestId("timeline-item-label").fill("Fase 1");
  await page.getByTestId("timeline-item-display").selectOption("band");
  await expect(itemAlfa).toHaveAttribute("data-color", "#ff0000");
  await expect(itemAlfa).toHaveAttribute("data-label", "Fase 1");
  await expect(itemAlfa).toHaveAttribute("data-display", "band");

  /* --- recorte sincroniza o Gantt ----------------------------------------- */
  const gantt = page.getByTestId("gantt");
  const timeline = page.getByTestId("timeline");
  const zoom0 = Number(await gantt.getAttribute("data-zoom"));
  const ganttBox = (await gantt.boundingBox())!;
  const stripBox = (await page.getByTestId("timeline-strip").boundingBox())!;

  const dragHandleTo = async (ratio: number) => {
    const handle = await page.getByTestId("timeline-handle-end").boundingBox();
    expect(handle).not.toBeNull();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      stripBox.x + stripBox.width * ratio,
      handle!.y + handle!.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
  };

  await dragHandleTo(0.4);

  const spanFrom = Number(await timeline.getAttribute("data-span-from"));
  const spanTo = Number(await timeline.getAttribute("data-span-to"));
  const tlFrom = Number(await timeline.getAttribute("data-window-from"));
  const tlTo = Number(await timeline.getAttribute("data-window-to"));
  expect(tlTo - spanFrom).toBeLessThan((spanTo - spanFrom) * 0.5); // recortou
  expect(tlFrom).toBe(spanFrom); // extremidade inicial intacta

  // o Gantt passou a exibir o intervalo recortado
  await expect
    .poll(async () => Number(await gantt.getAttribute("data-zoom")))
    .toBeGreaterThan(zoom0);

  const spanDays = (tlTo - tlFrom) / DAY;
  const expectedZoom = Math.round((ganttBox.width - 48) / spanDays);
  const ganttZoom = Number(await gantt.getAttribute("data-zoom"));
  expect(Math.abs(ganttZoom - expectedZoom)).toBeLessThanOrEqual(2);

  const ganttFrom = Number(await gantt.getAttribute("data-window-from"));
  expect(Math.abs(ganttFrom - tlFrom)).toBeLessThanOrEqual(3 * DAY);

  /* --- com a sincronização desligada, o Gantt fica como está --------------- */
  await page.getByTestId("timeline-sync").uncheck();
  const zoomBefore = Number(await gantt.getAttribute("data-zoom"));

  await dragHandleTo(0.25);
  await page.waitForTimeout(400); // margem para qualquer fit atrasado

  const tlTo2 = Number(await timeline.getAttribute("data-window-to"));
  expect(tlTo2).toBeLessThan(tlTo); // o recorte avançou na Timeline
  expect(Number(await gantt.getAttribute("data-zoom"))).toBe(zoomBefore); // Gantt não mexeu

  /* --- exportação PNG ------------------------------------------------------ */
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("timeline-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("timeline.png");

  /* --- cópia para a área de transferência ---------------------------------- */
  await page.getByTestId("timeline-copy").click();
  // a cópia é assíncrona (toBlob + clipboard.write): espera o PNG chegar
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const entries = await navigator.clipboard.read();
          return entries.flatMap((entry) => entry.types);
        }),
      { timeout: 5_000 },
    )
    .toContain("image/png");
  await expect(page.getByTestId("timeline-notice")).toHaveCount(0);

  expect(errors).toEqual([]);
});
