import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Documentação publicada (tarefa 11.5): os atalhos de `docs/atalhos.md`
 * são lidos do arquivo e EXECUTADOS como escritos, e o template CSV
 * baixado é idêntico ao documentado em `docs/importacao.md`.
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
  const tasks = ["Alfa", "Beta"].map((name, index) => ({
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

/** Lê o atalho documentado de um comando na tabela de `atalhos.md`. */
function keyOf(doc: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = doc.match(new RegExp(`\\| ${escaped} \\| \`([^\`]+)\``));
  expect(match, `comando "${label}" deve estar documentado`).not.toBeNull();
  return match![1]!;
}

/** Forma canônica do doc (`Ctrl+Shift+Right`) → tecla do Playwright. */
function toPlaywright(combo: string): string {
  return combo
    .replace(/Ctrl/g, "Control")
    .replace(/(^|\+)Right$/, "$1ArrowRight")
    .replace(/(^|\+)Left$/, "$1ArrowLeft");
}

test("documentação: os comandos documentados executam como escritos", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const atalhos = await readFile("docs/atalhos.md", "utf-8");
  const importacao = await readFile("docs/importacao.md", "utf-8");

  const projectId = await createProject(request, `Docs E2E ${Date.now()}`);
  await seedTasks(request, projectId);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "2");

  /* --- "?" abre o overlay e Escape fecha (como documentado) --------------- */
  expect(keyOf(atalhos, "Mostrar atalhos de teclado")).toBe("?");
  await page.keyboard.press(toPlaywright(keyOf(atalhos, "Mostrar atalhos de teclado")));
  await expect(page.getByTestId("shortcuts-overlay")).toBeVisible();

  expect(keyOf(atalhos, "Fechar painel sobreposto")).toBe("Escape");
  await page.keyboard.press(toPlaywright(keyOf(atalhos, "Fechar painel sobreposto")));
  await expect(page.getByTestId("shortcuts-overlay")).toHaveCount(0);

  /* --- F4 abre/fecha os detalhes (como documentado) ----------------------- */
  expect(keyOf(atalhos, "Abrir/fechar os detalhes da tarefa")).toBe("F4");
  await page.keyboard.press("F4");
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("F4");
  await expect(page.getByTestId("details-toggle")).toHaveAttribute("aria-pressed", "false");

  /* --- indentar e outdentar com as teclas documentadas -------------------- */
  expect(keyOf(atalhos, "Indentar (virar subtarefa)")).toBe("Ctrl+Shift+Right");
  expect(keyOf(atalhos, "Outdentar (promover um nível)")).toBe("Ctrl+Shift+Left");

  await page.getByTestId("task-row").nth(1).getByTestId("cell-name").click();
  await page.keyboard.press(toPlaywright(keyOf(atalhos, "Indentar (virar subtarefa)")));
  await expect(page.getByTestId("task-row").nth(1)).toHaveAttribute("data-depth", "1");

  await page.keyboard.press(toPlaywright(keyOf(atalhos, "Outdentar (promover um nível)")));
  await expect(page.getByTestId("task-row").nth(1)).toHaveAttribute("data-depth", "0");

  /* --- foco no Gantt (F6) e ajustar ao projeto (Ctrl+0) ------------------- */
  expect(keyOf(atalhos, "Alternar foco entre Task Sheet e Gantt")).toBe("F6");
  const zoomBefore = (await page.getByTestId("zoom-value").textContent())!;
  await page.keyboard.press("F6");
  await expect(page.getByTestId("status-focus")).toContainText("Gantt");

  expect(keyOf(atalhos, "Ajustar ao projeto")).toBe("Ctrl+0");
  await page.keyboard.press(toPlaywright(keyOf(atalhos, "Ajustar ao projeto")));
  await expect(page.getByTestId("zoom-value")).not.toHaveText(zoomBefore);

  /* --- template CSV baixado = template documentado ------------------------ */
  const csvBlock = importacao.match(/```csv\n([\s\S]*?)```/);
  expect(csvBlock, "bloco csv em importacao.md").not.toBeNull();

  await page.getByTestId("ribbon-tab-projeto").click();
  await page.getByTestId("import-open").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("import-template-csv").click();
  const template = await download;
  const downloaded = await readFile(await template.path(), "utf-8");

  expect(downloaded.replace(/^\uFEFF/, "")).toBe(csvBlock![1]!.replace(/\n$/, ""));
  await page.getByTestId("import-close").click();

  expect(errors).toEqual([]);
});
