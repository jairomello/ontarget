import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Indicadores gráficos e códigos de estrutura (specs/custom-fields):
 * máscara `A.00.00.00` aplicada aos códigos gerados, coluna de código
 * editável com validação de duplicidade (inclusive contra os derivados) e
 * ícone na coluna de indicadores pela regra de maior prioridade — com
 * estado sem correspondência.
 */

interface Detail {
  data: {
    tasks: Array<{ id: string; sortOrder: number; wbsCode: string | null }>;
    customFields: Array<{
      id: string;
      name: string;
      showIndicator: boolean;
      indicatorRules: string | null;
    }>;
    libraryItems: Array<{ kind: string; config: string }>;
  };
}

async function detail(request: APIRequestContext, projectId: string): Promise<Detail> {
  return (await (await request.get(`/api/projects/${projectId}`)).json()) as Detail;
}

test("máscara WBS, duplicidade de código e indicadores por prioridade", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const created = await request.post("/api/projects", {
    data: { name: `Códigos E2E ${Date.now()}`, templateKey: "vazio" },
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const projectId = project.id;

  const now = Date.now();
  const uid = Date.now().toString(36);
  const MON = Date.UTC(2026, 0, 5); // segunda-feira fixa
  const task = (index: number, name: string, start: number) => ({
    id: `${uid}-t${index}`,
    projectId,
    parentId: null,
    outlineLevel: 0,
    outlineNumber: String(index + 1),
    sortOrder: index,
    name,
    start,
    finish: start,
    duration: WORKDAY,
    durationUnit: "day",
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
  });

  const seeded = await request.post(`/api/projects/${projectId}/sync`, {
    data: { upserts: { tasks: [task(0, "Primeira", MON), task(1, "Segunda", MON + DAY)] } },
  });
  expect(seeded.status()).toBe(200);

  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "2");

  const row1 = page.getByTestId("task-row").nth(0);
  const row2 = page.getByTestId("task-row").nth(1);

  // --- máscara + campo de indicador -----------------------------------------
  await page.getByTestId("fields-toggle").click();
  await expect(page.getByTestId("fields-panel")).toBeVisible();

  await page.getByTestId("wbs-mask").fill("A.00.00.00");
  await page.getByTestId("wbs-mask-save").click();

  await page.getByTestId("field-name").fill("Risco");
  await page.getByTestId("field-type").selectOption("number");
  await page.getByTestId("field-add").click();
  await expect(page.getByTestId("field-row")).toHaveCount(1);

  // --- indicador: duas regras com sobreposição -------------------------------
  await page.getByTestId("field-indicator").click();
  await expect(page.getByTestId("field-indicator")).toBeChecked();

  await page.getByTestId("rule-icon").fill("⚠");
  await page.getByTestId("rule-priority").fill("1");
  await page.getByTestId("rule-operator").selectOption("gt");
  await page.getByTestId("rule-value").fill("0");
  await page.getByTestId("rule-add").click();
  await expect(page.getByTestId("rule-row")).toHaveCount(1);

  // segunda regra, de maior prioridade, atendida junto com a primeira
  await page.getByTestId("rule-icon").fill("🔴");
  await page.getByTestId("rule-priority").fill("5");
  await page.getByTestId("rule-value").fill("5");
  await page.getByTestId("rule-add").click();
  await expect(page.getByTestId("rule-row")).toHaveCount(2);

  await page.getByTestId("fields-close").click();

  // --- máscara aplicada aos códigos gerados ---------------------------------
  await expect(row1.getByTestId("cell-wbs")).toHaveText("A");
  await expect(row2.getByTestId("cell-wbs")).toHaveText("B");

  // --- indicadores por prioridade -------------------------------------------
  // espera a gravação em lote do campo antes de ler pela API
  await expect(page.getByTestId("status-save")).toHaveText("Salvo");
  await expect
    .poll(async () => (await detail(request, projectId)).data.customFields.length)
    .toBeGreaterThan(0);
  const fieldId = (await detail(request, projectId)).data.customFields[0]!.id;
  const valueCell = row1.getByTestId(`cell-cf:${fieldId}`);
  const indicator = row1.getByTestId("cell-indicator");

  // sem valor → sem correspondência → sem ícone
  await expect(indicator).toHaveText("");

  const setValue = async (value: string) => {
    await valueCell.dblclick();
    await page.getByTestId("cell-editor").fill(value);
    await page.getByTestId("cell-editor").press("Enter");
  };

  await setValue("10");
  // ambas as regras casam (10 > 5 e 10 > 0): vence a prioridade 5
  await expect(indicator).toHaveText("🔴");

  await setValue("1");
  // só a regra de prioridade 1
  await expect(indicator).toHaveText("⚠");

  await setValue("0");
  // nenhuma regra atendida → volta ao estado sem indicador
  await expect(indicator).toHaveText("");

  // --- duplicidade contra o código derivado da outra tarefa -----------------
  await row1.getByTestId("cell-wbs").dblclick();
  await page.getByTestId("cell-editor").fill("B"); // derivado da tarefa 2
  await page.getByTestId("cell-editor").press("Enter");
  await expect(page.getByTestId("sheet-notice")).toContainText("já usado");
  await expect(row1.getByTestId("cell-wbs")).toHaveText("A"); // nada mudou

  // --- código personalizado aceito ------------------------------------------
  await row1.getByTestId("cell-wbs").dblclick();
  await page.getByTestId("cell-editor").fill("A-100");
  await page.getByTestId("cell-editor").press("Enter");
  await expect(row1.getByTestId("cell-wbs")).toHaveText("A-100");
  // a tarefa 2 continua com o derivado
  await expect(row2.getByTestId("cell-wbs")).toHaveText("B");

  // --- persistência -----------------------------------------------------------
  await expect(page.getByTestId("status-save")).toHaveText("Salvo");

  await expect
    .poll(async () => {
      const after = await detail(request, projectId);
      return after.data.tasks.find((entry) => entry.sortOrder === 0)?.wbsCode;
    })
    .toBe("A-100");

  const persisted = await detail(request, projectId);
  const field = persisted.data.customFields[0]!;
  expect(field).toMatchObject({ name: "Risco", showIndicator: true });
  expect(JSON.parse(field.indicatorRules ?? "[]")).toHaveLength(2);
  const maskItem = persisted.data.libraryItems.find((item) => item.kind === "outline_code");
  expect(maskItem?.config).toContain("A.00.00.00");

  // --- recarrega: tudo restaurado --------------------------------------------
  await page.reload();
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "2");
  await expect(row1.getByTestId("cell-wbs")).toHaveText("A-100");
  await expect(row2.getByTestId("cell-wbs")).toHaveText("B");
  await expect(row1.getByTestId("cell-indicator")).toHaveText("");

  expect(errors).toEqual([]);
});
