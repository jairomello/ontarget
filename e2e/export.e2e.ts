import { expect, test, type Download, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;
const WORKDAY = 9 * HOUR;
const MON = Date.UTC(2026, 0, 5); // segunda-feira fixa

/**
 * Exportação (specs/import-export): JSON completo em formato round-trip
 * (exportar em A e importar em B reproduz o mesmo projeto), CSV do escopo
 * visível respeitando filtros e proteção de injeção de fórmula.
 */

interface Detail {
  data: { tasks: Array<{ id: string }> };
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

/** Projeto com todas as entidades do round-trip (tarefas… campos personalizados). */
async function seedFullProject(request: APIRequestContext, projectId: string): Promise<void> {
  const now = Date.now();
  const task = (
    id: string,
    outlineNumber: string,
    sortOrder: number,
    name: string,
    start: number,
    finish: number,
    duration: number,
    isSummary = false,
  ) => ({
    id,
    projectId,
    parentId: outlineNumber.includes(".") ? `${projectId}-p` : null,
    outlineLevel: outlineNumber.split(".").length - 1,
    outlineNumber,
    sortOrder,
    name,
    notes: null,
    start,
    finish,
    duration,
    durationUnit: "day",
    percentComplete: isSummary ? 0 : 40,
    isSummary,
    isMilestone: false,
    isInactive: false,
    isPlaceholder: false,
    schedulingMode: "auto",
    taskType: "fixed_duration",
    effortDriven: true,
    priority: 500,
    createdAt: now,
    updatedAt: now,
  });

  const p = `${projectId}-p`;
  const a = `${projectId}-a`;
  const b = `${projectId}-b`;
  const c = `${projectId}-c`;
  const d = `${projectId}-d`;
  const resource = `${projectId}-res`;
  const field = `${projectId}-cf`;
  const baseline = `${projectId}-bl`;

  const synced = await request.post(`/api/projects/${projectId}/sync`, {
    data: {
      upserts: {
        tasks: [
          task(p, "1", 0, "Projeto", MON, MON + 11 * DAY, 10 * WORKDAY, true),
          task(a, "1.1", 1, "Alfa", MON, MON + 4 * DAY, 5 * WORKDAY),
          task(b, "1.2", 2, "Beta", MON + 7 * DAY, MON + 11 * DAY, 5 * WORKDAY),
          task(c, "2", 3, "Gama", MON + 14 * DAY, MON + 15 * DAY, 2 * WORKDAY),
          task(d, "3", 4, "=1+1", MON + 16 * DAY, MON + 17 * DAY, 2 * WORKDAY),
        ],
        task_links: [
          {
            id: `${projectId}-link`,
            projectId,
            predecessorId: b,
            successorId: c,
            type: "fs",
            lagMs: 0,
            crossProjectRef: null,
          },
        ],
        resources: [
          {
            id: resource,
            projectId,
            teamId: null,
            name: "Ana",
            initials: "AN",
            color: "#0ea5e9",
            type: "work",
            maxUnits: 1,
            standardRate: 100,
            costPerUse: 0,
            calendarId: null,
            email: null,
            active: true,
            notes: null,
          },
        ],
        assignments: [
          {
            id: `${projectId}-as`,
            projectId,
            taskId: a,
            resourceId: resource,
            units: 1,
            work: 40,
            cost: null,
            actualWork: null,
            actualCost: null,
            start: null,
            finish: null,
            proposed: false,
            notes: null,
          },
        ],
        custom_fields: [
          {
            id: field,
            projectId,
            entityType: "task",
            name: "Setor",
            dataType: "text",
            formula: null,
            config: null,
            showIndicator: false,
            indicatorRules: null,
            sortOrder: 0,
          },
        ],
        custom_field_values: [
          { fieldId: field, entityId: a, valueText: "TI", valueNum: null, valueDate: null },
        ],
        baselines: [
          {
            id: baseline,
            projectId,
            name: "Baseline 1",
            kind: "baseline",
            savedAt: now,
            scope: "project",
          },
        ],
        baseline_values: [
          {
            baselineId: baseline,
            taskId: a,
            start: MON,
            finish: MON + 4 * DAY,
            duration: 5 * WORKDAY,
            work: 40,
            cost: null,
          },
        ],
      },
    },
  });
  expect(synced.status()).toBe(200);
}

async function readDownload(download: Download): Promise<string> {
  return readFile(await download.path(), "utf-8");
}

/** Normaliza ids (o round-trip remapeia) para comparar o conteúdo real. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(payload: any) {
  const tasks: any[] = payload.data.tasks ?? [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const outline = (id: any) =>
    id == null ? null : (byId.get(id)?.outlineNumber ?? `?${String(id)}`);
  const resName = new Map(
    (payload.data.resources ?? []).map((resource: any) => [resource.id, resource.name]),
  );
  const fieldName = new Map(
    (payload.data.customFields ?? []).map((field: any) => [field.id, field.name]),
  );
  const baselineName = new Map(
    (payload.data.baselines ?? []).map((baseline: any) => [baseline.id, baseline.name]),
  );
  const num = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

  return {
    tasks: tasks
      .map((task) => ({
        outline: task.outlineNumber,
        parent: outline(task.parentId),
        name: task.name,
        start: task.start ?? null,
        finish: task.finish ?? null,
        duration: task.duration ?? null,
        unit: task.durationUnit ?? null,
        percent: task.percentComplete ?? 0,
        summary: Boolean(task.isSummary),
        milestone: Boolean(task.isMilestone),
        inactive: Boolean(task.isInactive),
        placeholder: Boolean(task.isPlaceholder),
        mode: task.schedulingMode,
        type: task.taskType,
        priority: task.priority ?? 500,
        effort: Boolean(task.effortDriven),
        calendarId: task.calendarId ?? null,
        wbsCode: task.wbsCode ?? null,
        notes: task.notes ?? null,
      }))
      .sort((a: any, b: any) => num(a.outline, b.outline)),
    links: (payload.data.taskLinks ?? [])
      .map((link: any) => ({
        pred: outline(link.predecessorId),
        succ: outline(link.successorId),
        type: link.type,
        lag: link.lagMs ?? 0,
      }))
      .sort((a: any, b: any) => `${a.pred}>${a.succ}`.localeCompare(`${b.pred}>${b.succ}`)),
    resources: (payload.data.resources ?? [])
      .map((resource: any) => ({
        name: resource.name,
        color: resource.color,
        units: resource.maxUnits,
        rate: resource.standardRate,
        active: Boolean(resource.active),
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    assignments: (payload.data.assignments ?? [])
      .map((assignment: any) => ({
        task: outline(assignment.taskId),
        resource: resName.get(assignment.resourceId) ?? "?",
        units: assignment.units,
        work: assignment.work ?? null,
      }))
      .sort((a: any, b: any) => `${a.task}|${a.resource}`.localeCompare(`${b.task}|${b.resource}`)),
    fields: (payload.data.customFields ?? [])
      .map((field: any) => ({
        name: field.name,
        entity: field.entityType,
        type: field.dataType,
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    fieldValues: (payload.data.customFieldValues ?? [])
      .map((value: any) => ({
        field: fieldName.get(value.fieldId) ?? "?",
        entity: outline(value.entityId) ?? resName.get(value.entityId) ?? "?",
        text: value.valueText ?? null,
        num: value.valueNum ?? null,
        date: value.valueDate ?? null,
      }))
      .sort((a: any, b: any) => `${a.field}|${a.entity}`.localeCompare(`${b.field}|${b.entity}`)),
    baselines: (payload.data.baselines ?? [])
      .map((baseline: any) => ({
        name: baseline.name,
        kind: baseline.kind,
        scope: baseline.scope,
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    baselineValues: (payload.data.baselineValues ?? [])
      .map((value: any) => ({
        baseline: baselineName.get(value.baselineId) ?? "?",
        task: outline(value.taskId),
        start: value.start ?? null,
        finish: value.finish ?? null,
        duration: value.duration ?? null,
      }))
      .sort((a: any, b: any) => `${a.baseline}|${a.task}`.localeCompare(`${b.baseline}|${b.task}`)),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test("exportação: round-trip JSON e CSV do escopo visível com proteção", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const projectA = await createProject(request, `Exportação E2E A ${Date.now()}`);
  await seedFullProject(request, projectA);
  await page.goto(`/p/${projectA}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "5");

  /* --- JSON completo no formato do produto -------------------------------- */
  await page.getByTestId("ribbon-tab-projeto").click();
  const jsonA = page.waitForEvent("download");
  await page.getByTestId("export-json").click();
  const fileA = await readDownload(await jsonA);
  expect((await jsonA).suggestedFilename()).toBe("exportacao.json");

  const payloadA = JSON.parse(fileA);
  expect(payloadA.format).toBe("ontarget");
  expect(payloadA.version).toBe(1);
  expect(payloadA.data.tasks).toHaveLength(5);
  expect(payloadA.data.taskLinks).toHaveLength(1);
  expect(payloadA.data.resources).toHaveLength(1);
  expect(payloadA.data.assignments).toHaveLength(1);
  expect(payloadA.data.customFields).toHaveLength(1);
  expect(payloadA.data.customFieldValues).toHaveLength(1);
  expect(payloadA.data.baselines).toHaveLength(1);
  expect(payloadA.data.baselineValues).toHaveLength(1);

  /* --- importar em outro projeto e reexportar: mesmo projeto ------------- */
  const projectB = await createProject(request, `Exportação E2E B ${Date.now()}`);
  await page.goto(`/p/${projectB}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "0");

  await page.getByTestId("ribbon-tab-projeto").click();
  await page.getByTestId("import-open").click();
  await page.getByTestId("import-file").setInputFiles({
    name: "exportacao.json",
    mimeType: "application/json",
    buffer: Buffer.from(fileA),
  });
  await expect(page.getByTestId("import-report")).toBeVisible();
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await page.getByTestId("import-done-close").click();
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "5");
  expect((await detail(request, projectB)).data.tasks).toHaveLength(5);

  const jsonB = page.waitForEvent("download");
  await page.getByTestId("export-json").click();
  const fileB = await readDownload(await jsonB);

  // exportar → importar reproduz o mesmo projeto (ids remapeados, conteúdo igual)
  expect(normalize(JSON.parse(fileB))).toEqual(normalize(JSON.parse(fileA)));

  /* --- CSV sem filtro: escopo completo + proteção de injeção -------------- */
  await page.goto(`/p/${projectA}`);
  await expect(page.getByTestId("status-schedule")).toHaveAttribute("data-tasks", "5");

  await page.getByTestId("ribbon-tab-projeto").click();
  const csvAll = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const allContent = await readDownload(await csvAll);
  expect((await csvAll).suggestedFilename()).toBe("exportacao.csv");

  expect(allContent).toContain("Nome da tarefa"); // colunas exibidas
  expect(allContent).toContain("Alfa");
  expect(allContent).toContain("Beta");
  expect(allContent).toContain("'=1+1"); // injeção neutralizada
  expect(allContent).not.toContain(";=1+1"); // nunca como fórmula executável

  /* --- CSV com filtro: só o escopo visível -------------------------------- */
  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("condition-new-field").selectOption("name");
  await page.getByTestId("condition-add").click();
  await page.getByTestId("condition-value").first().fill("Alfa");
  await page.getByTestId("filters-close").click();
  await expect(page.getByTestId("task-row")).toHaveCount(1);

  const csvFiltered = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const filtered = await readDownload(await csvFiltered);

  expect(filtered).toContain("Alfa");
  expect(filtered).not.toContain("Beta");
  expect(filtered).not.toContain("Gama");
  expect(filtered).not.toContain("Projeto"); // resumo filtrado junto

  expect(errors).toEqual([]);
});
