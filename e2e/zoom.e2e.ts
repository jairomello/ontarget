import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "entrega-software" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

/** Data exibida sob um ponto da tela, a partir da janela visível do Gantt. */
async function dateUnder(
  page: import("@playwright/test").Page,
  clientX: number,
  paneLeft: number,
): Promise<number> {
  const gantt = page.getByTestId("gantt");
  const from = Number(await gantt.getAttribute("data-window-from"));
  const pxPerDay = Number(await gantt.getAttribute("data-zoom"));
  return from + ((clientX - paneLeft) / pxPerDay) * DAY;
}

/**
 * Espera o agendamento inicial assentar: os recálculos de ida e volta
 * (motor → domínio → motor) podem mover a janela visível antes da medida.
 */
async function waitForStableWindow(page: import("@playwright/test").Page): Promise<void> {
  const gantt = page.getByTestId("gantt");
  let previous: string | null = null;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(150);
    const current = await gantt.getAttribute("data-window-to");
    if (current !== null && current === previous) return;
    previous = current;
  }
}

/**
 * Zoom contínuo (specs/gantt-view): a data sob o ponteiro permanece fixa
 * durante o zoom, e presets/slider/ajustes alteram a escala.
 */
test("a data sob o ponteiro permanece fixa durante o zoom", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Zoom E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("gantt")).toBeVisible();
  // espera o agendamento inicial assentar: os recálculos podem realinhar
  // datas e mover a janela visível antes da primeira medida
  await waitForStableWindow(page);

  const gantt = page.getByTestId("gantt");
  const box = (await gantt.boundingBox())!;
  const probeX = box.x + Math.min(300, box.width / 2);
  const probeY = box.y + box.height / 2;

  const before = await dateUnder(page, probeX, box.x);
  const zoomBefore = Number(await gantt.getAttribute("data-zoom"));

  // --- Ctrl+rolagem amplia mantendo a data sob o ponteiro ----------------
  await page.mouse.move(probeX, probeY);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");

  await expect
    .poll(async () => Number(await gantt.getAttribute("data-zoom")))
    .toBeGreaterThan(zoomBefore);

  // espera a rolagem assíncrona assentar e confere a data
  await expect
    .poll(async () => Math.abs((await dateUnder(page, probeX, box.x)) - before), { timeout: 8_000 })
    .toBeLessThan(2 * 60 * 60 * 1000); // tolerância de 2h

  // --- e a redução também -------------------------------------------------
  const zoomAfter = Number(await gantt.getAttribute("data-zoom"));
  await page.mouse.move(probeX, probeY);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Control");

  await expect
    .poll(async () => Number(await gantt.getAttribute("data-zoom")))
    .toBeLessThan(zoomAfter);

  await expect
    .poll(async () => Math.abs((await dateUnder(page, probeX, box.x)) - before), { timeout: 8_000 })
    .toBeLessThan(2 * 60 * 60 * 1000);

  expect(errors).toEqual([]);
});

test("presets, slider e ajustes de escala", async ({ page, request }) => {
  const projectId = await createProject(request, `Presets E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("gantt")).toBeVisible();
  // espera o agendamento inicial assentar: os recálculos podem realinhar
  // datas e mover a janela visível antes da primeira medida
  await waitForStableWindow(page);

  const gantt = page.getByTestId("gantt");

  // --- presets -------------------------------------------------------------
  await page.getByTestId("zoom-preset").selectOption("days");
  await expect.poll(async () => Number(await gantt.getAttribute("data-zoom"))).toBe(150);

  await page.getByTestId("zoom-preset").selectOption("months");
  await expect.poll(async () => Number(await gantt.getAttribute("data-zoom"))).toBe(12);

  await page.getByTestId("zoom-preset").selectOption("years");
  await expect.poll(async () => Number(await gantt.getAttribute("data-zoom"))).toBe(2);

  // --- slider --------------------------------------------------------------
  await page.getByTestId("zoom-slider").fill("700");
  const fromSlider = Number(await gantt.getAttribute("data-zoom"));
  expect(fromSlider).toBeGreaterThan(2);
  await expect(page.getByTestId("zoom-value")).toContainText("px/dia");

  // --- ajustar ao projeto (Ctrl+0) -----------------------------------------
  await page.getByTestId("gantt").focus();
  await page.keyboard.press("Control+0");
  await expect.poll(async () => Number(await gantt.getAttribute("data-zoom"))).not.toBe(fromSlider);
  await expect(page.getByTestId("zoom-preset")).toHaveValue("fit-project");

  // a janela visível cobre o projeto inteiro (poll: o fit assenta em um
  // render depois da troca de escala; espera o flush para ler datas já
  // recalculadas — o motor corrige o fim do projeto em relação à semeadura)
  await expect(page.getByTestId("status-save")).toHaveText("Salvo");
  const detail = await (await request.get(`/api/projects/${projectId}`)).json();
  const starts = detail.data.tasks.map((task: { start: number }) => task.start);
  const finishes = detail.data.tasks.map((task: { finish: number }) => task.finish);
  const projectStart = Math.min(...starts);
  const projectFinish = Math.max(...finishes);

  await expect
    .poll(async () => Number(await gantt.getAttribute("data-window-from")))
    .toBeLessThanOrEqual(projectStart);
  await expect
    .poll(async () => Number(await gantt.getAttribute("data-window-to")))
    .toBeGreaterThanOrEqual(projectFinish);

  // --- atalhos de zoom -----------------------------------------------------
  const zoomBefore = Number(await gantt.getAttribute("data-zoom"));
  await gantt.focus();
  await page.keyboard.press("+");
  await expect.poll(async () => Number(await gantt.getAttribute("data-zoom"))).toBeGreaterThan(
    zoomBefore,
  );
});
