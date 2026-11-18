import { expect, test, type APIRequestContext } from "@playwright/test";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;

/**
 * Importação (specs/import-export): detecção, mapeamento, pré-validação com
 * relatório de erros, recusa de arquivo acima do limite, templates e o
 * round-trip do JSON do produto (substituir e mesclar sem duplicar).
 */

interface Detail {
  data: {
    tasks: Array<{
      id: string;
      name: string;
      outlineNumber: string;
      parentId: string | null;
      isSummary: boolean;
      start: number | null;
      percentComplete: number;
    }>;
    taskLinks: Array<{ id: string; predecessorId: string; successorId: string; type: string }>;
    resources: Array<{ id: string; name: string; color: string }>;
    assignments: Array<{ id: string; taskId: string; resourceId: string; units: number; work: number | null }>;
    customFields: Array<{ id: string; name: string; dataType: string }>;
    customFieldValues: Array<{ fieldId: string; entityId: string; valueText: string | null }>;
    baselines: Array<{ id: string; name: string }>;
    baselineValues: Array<{ baselineId: string; taskId: string; start: number | null }>;
  };
}

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/projects", {
    data: { name, templateKey: "vazio" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

async function detail(request: APIRequestContext, projectId: string): Promise<Detail> {
  return (await (await request.get(`/api/projects/${projectId}`)).json()) as Detail;
}

const MON = Date.UTC(2026, 0, 5); // segunda-feira fixa

/** JSON no formato do produto (versão 1), com as entidades do round-trip. */
const JSON_FIXTURE = JSON.stringify({
  format: "ontarget",
  version: 1,
  data: {
    tasks: [
      {
        id: "f1",
        parentId: null,
        outlineLevel: 0,
        outlineNumber: "1",
        sortOrder: 0,
        name: "Fase Um",
        start: MON,
        finish: MON + 4 * DAY,
        duration: 5 * WORKDAY,
        durationUnit: "day",
        percentComplete: 20,
        isSummary: true,
        isMilestone: false,
        isInactive: false,
        schedulingMode: "auto",
        taskType: "fixed_duration",
        effortDriven: true,
        priority: 500,
      },
      {
        id: "f2",
        parentId: "f1",
        outlineLevel: 1,
        outlineNumber: "1.1",
        sortOrder: 1,
        name: "Tarefa Filha",
        start: MON,
        finish: MON + 4 * DAY,
        duration: 5 * WORKDAY,
        durationUnit: "day",
        percentComplete: 40,
        isSummary: false,
        isMilestone: false,
        isInactive: false,
        schedulingMode: "auto",
        taskType: "fixed_duration",
        effortDriven: true,
        priority: 500,
      },
      {
        id: "f3",
        parentId: null,
        outlineLevel: 0,
        outlineNumber: "2",
        sortOrder: 2,
        name: "Fase Dois",
        start: MON + 7 * DAY,
        finish: MON + 8 * DAY,
        duration: 2 * WORKDAY,
        durationUnit: "day",
        percentComplete: 0,
        isSummary: false,
        isMilestone: false,
        isInactive: false,
        schedulingMode: "auto",
        taskType: "fixed_duration",
        effortDriven: true,
        priority: 500,
      },
    ],
    taskLinks: [
      { id: "fl", predecessorId: "f2", successorId: "f3", type: "fs", lagMs: 0 },
    ],
    resources: [
      {
        id: "fr",
        name: "Ana",
        type: "work",
        maxUnits: 1,
        standardRate: 100,
        color: "#0ea5e9",
      },
    ],
    assignments: [{ id: "fa", taskId: "f1", resourceId: "fr", units: 1, work: 40 }],
    customFields: [
      { id: "fcf", name: "Setor", entityType: "task", dataType: "text", sortOrder: 0 },
    ],
    customFieldValues: [{ fieldId: "fcf", entityId: "f1", valueText: "TI" }],
    baselines: [
      { id: "fb", name: "Baseline 1", kind: "baseline", savedAt: 123, scope: "project" },
    ],
    baselineValues: [{ baselineId: "fb", taskId: "f1", start: 1, finish: 2, duration: 3 }],
  },
});

/** CSV com duas linhas válidas e duas com erro (data inválida e pred órfão). */
const CSV_FIXTURE = [
  "WBS;Nome;Início;Término;Duração;Predecessores",
  "1;Alfa;05/01/2026;09/01/2026;5d;",
  "1.1;Beta;data-invalida;10/01/2026;2d;",
  "1.2;Gama;12/01/2026;14/01/2026;3d;",
  "1.3;Zeta;15/01/2026;16/01/2026;2d;9.9",
].join("\n");

test("importação: round-trip JSON, relatório de erros e limite de linhas", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectId = await createProject(request, `Importação E2E ${Date.now()}`);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "0");

  /* --- templates publicados ---------------------------------------------- */
  await page.getByTestId("ribbon-tab-projeto").click();
  await page.getByTestId("import-open").click();
  await expect(page.getByTestId("import-dialog")).toBeVisible();

  const csvDownload = page.waitForEvent("download");
  await page.getByTestId("import-template-csv").click();
  expect((await csvDownload).suggestedFilename()).toBe("template-importacao.csv");

  const jsonDownload = page.waitForEvent("download");
  await page.getByTestId("import-template-json").click();
  expect((await jsonDownload).suggestedFilename()).toBe("exemplo-importacao.json");

  /* --- round-trip: JSON do produto substitui o projeto -------------------- */
  await page.getByTestId("import-file").setInputFiles({
    name: "projeto.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON_FIXTURE),
  });

  await expect(page.getByTestId("import-report")).toBeVisible();
  await expect(page.getByTestId("import-valid-count")).toContainText("3");
  await expect(page.getByTestId("import-error-count")).toContainText("0");
  await expect(page.getByTestId("import-commit")).toHaveText("Importar 3 tarefas");

  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await page.getByTestId("import-done-close").click();

  await expect.poll(async () => (await detail(request, projectId)).data.tasks).toHaveLength(3);
  const afterJson = await detail(request, projectId);
  const tasks = [...afterJson.data.tasks].sort((a, b) =>
    a.outlineNumber.localeCompare(b.outlineNumber, "pt-BR", { numeric: true }),
  );
  expect(tasks.map((task) => task.name)).toEqual(["Fase Um", "Tarefa Filha", "Fase Dois"]);
  expect(tasks[0]!.isSummary).toBe(true);
  expect(tasks[0]!.parentId).toBeNull();
  expect(tasks[1]!.parentId).toBe(tasks[0]!.id); // referências remapeadas

  const link = afterJson.data.taskLinks[0]!;
  expect(link.type).toBe("fs");
  expect(link.predecessorId).toBe(tasks[1]!.id); // 1.1 → 2
  expect(link.successorId).toBe(tasks[2]!.id);

  expect(afterJson.data.resources.map((resource) => resource.name)).toEqual(["Ana"]);
  expect(afterJson.data.resources[0]!.color).toBe("#0ea5e9");
  expect(afterJson.data.assignments).toHaveLength(1);
  expect(afterJson.data.assignments[0]!.taskId).toBe(tasks[0]!.id);
  expect(afterJson.data.assignments[0]!.work).toBe(40);

  expect(afterJson.data.customFields.map((field) => field.name)).toEqual(["Setor"]);
  expect(afterJson.data.customFieldValues[0]!.valueText).toBe("TI");
  expect(afterJson.data.baselines.map((baseline) => baseline.name)).toEqual(["Baseline 1"]);
  expect(afterJson.data.baselineValues).toHaveLength(1);

  /* --- mesclar o mesmo arquivo é idempotente ----------------------------- */
  await page.getByTestId("import-open").click();
  await page.getByTestId("import-mode").selectOption("merge");
  await page.getByTestId("import-file").setInputFiles({
    name: "projeto.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON_FIXTURE),
  });
  await expect(page.getByTestId("import-report")).toBeVisible();
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await page.getByTestId("import-done-close").click();

  const afterMerge = await detail(request, projectId);
  expect(afterMerge.data.tasks).toHaveLength(3); // sem duplicar
  expect(afterMerge.data.taskLinks).toHaveLength(1);
  expect(afterMerge.data.resources).toHaveLength(1);
  expect(afterMerge.data.assignments).toHaveLength(1);
  expect(afterMerge.data.customFields).toHaveLength(1);
  expect(afterMerge.data.baselines).toHaveLength(1);

  /* --- CSV: mapeamento + relatório de erros ------------------------------ */
  await page.getByTestId("import-open").click();
  await page.getByTestId("import-file").setInputFiles({
    name: "tarefas.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV_FIXTURE),
  });

  // etapa de mapeamento com sugestões automáticas
  await expect(page.getByTestId("import-map-row")).toHaveCount(6);
  await expect(page.getByTestId("import-map-select").first()).toHaveValue("wbs");
  await page.getByTestId("import-validate").click();

  await expect(page.getByTestId("import-report")).toBeVisible();
  await expect(page.getByTestId("import-valid-count")).toContainText("2");
  await expect(page.getByTestId("import-error-count")).toContainText("2");

  const errorRows = page.getByTestId("import-error-row");
  await expect(errorRows).toHaveCount(2);
  await expect(errorRows.first()).toHaveAttribute("data-line", "3");
  await expect(errorRows.first()).toHaveAttribute("data-reason", /Data de início inválida/);
  await expect(errorRows.last()).toHaveAttribute("data-line", "5");
  await expect(errorRows.last()).toHaveAttribute("data-reason", /Predecessor inexistente/);
  await expect(page.getByTestId("import-commit")).toHaveText("Importar 2 válidas");

  // relatório exportável (cenário: linhas inválidas com motivo)
  const reportDownload = page.waitForEvent("download");
  await page.getByTestId("import-report-download").click();
  expect((await reportDownload).suggestedFilename()).toBe("relatorio-importacao.csv");

  // substituir: o CSV define as tarefas (só as válidas entram)
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await page.getByTestId("import-done-close").click();

  await expect
    .poll(async () =>
      (await detail(request, projectId)).data.tasks.map((task) => task.name).sort(),
    )
    .toEqual(["Alfa", "Gama"]);
  expect((await detail(request, projectId)).data.taskLinks).toHaveLength(0);

  /* --- acima do limite: avisa antes de processar e pode recusar ---------- */
  const bigCsv = [
    "WBS;Nome",
    ...Array.from({ length: 50_001 }, (_, index) => `${index + 1};Tarefa ${index + 1}`),
  ].join("\n");

  await page.getByTestId("import-open").click();
  await page.getByTestId("import-file").setInputFiles({
    name: "grande.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(bigCsv),
  });

  await expect(page.getByTestId("import-limit")).toBeVisible();
  await expect(page.getByTestId("import-limit")).toContainText("50.001");
  await page.getByTestId("import-limit-cancel").click();
  await expect(page.getByTestId("import-limit")).toHaveCount(0);
  await expect(page.getByTestId("import-map-row")).toHaveCount(0); // não processou
  await expect(page.getByTestId("import-report")).toHaveCount(0);

  // recusado: nada mudou no projeto
  expect((await detail(request, projectId)).data.tasks.map((task) => task.name).sort()).toEqual([
    "Alfa",
    "Gama",
  ]);

  expect(errors).toEqual([]);
});
