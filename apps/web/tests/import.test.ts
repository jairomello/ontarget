import { describe, expect, it } from "bun:test";
import {
  CSV_FIELDS,
  IMPORT_ROW_LIMIT,
  buildCsvPlan,
  buildErrorReport,
  buildJsonPlan,
  decodeImport,
  detectDelimiter,
  detectSource,
  normalizeLabel,
  parseCsv,
  suggestMapping,
} from "../src/features/import/importing";
import { buildImportPayload, type ImportState } from "../src/features/import/commitImport";
import type { Task } from "../src/store/types";

/**
 * Importação (specs/import-export): detecção de formato/codificação/
 * delimitador, mapeamento, pré-validação com relatório, limite de linhas e
 * montagem do payload transacional (substituição vs. mesclagem).
 */

/* ------------------------------------------------------------- detecção */

describe("detecção", () => {
  it("JSON quando começa com {, CSV caso contrário", () => {
    expect(detectSource('{"format":"ontarget"}')).toBe("json");
    expect(detectSource("﻿WBS,Nome")).toBe("csv");
    expect(detectSource("nome;inicio")).toBe("csv");
  });

  it("escolhe o delimitador que mais aparece fora de aspas", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    // ponto e vírgula DENTRO de aspas não engana
    expect(detectDelimiter('nome;obs\nAna;"olá; mundo"')).toBe(";");
  });

  it("decodifica UTF-8 e cai para Windows-1252 sem BOM inválido", () => {
    const utf8 = new TextEncoder().encode("ação — ok");
    expect(decodeImport(utf8.buffer).text).toBe("ação — ok");
    // bytes windows-1252 (0xE7, 0xE3) não formam UTF-8 válido
    const win = new Uint8Array([0x61, 0xe7, 0xe3, 0x6f]).buffer;
    expect(decodeImport(win).text).toBe("ação");
    expect(decodeImport(win).encoding).toBe("windows-1252");
  });
});

describe("parseCsv", () => {
  it("preserva aspas, quebras internas e numera as linhas do arquivo", () => {
    const text = 'WBS,Nome,Notas\n1,"Alfa","linha um\nlinha dois"\n2,Beta,"tem ""aspas"""\n';
    const { header, rows } = parseCsv(text, ",");
    expect(header).toEqual(["WBS", "Nome", "Notas"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cells[2]).toContain("\n");
    expect(rows[1]!.cells[2]).toBe('tem "aspas"');
    expect(rows[0]!.line).toBe(2); // cabeçalho na linha 1
    expect(rows[1]!.line).toBe(3);
  });

  it("ignora linhas em branco", () => {
    const { rows } = parseCsv("WBS,Nome\n\n1,Alfa\n\n", ",");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.line).toBe(3);
  });
});

describe("suggestMapping", () => {
  it("sugere campos por apelidos em pt-BR sem acentos", () => {
    const mapping = suggestMapping([
      "WBS",
      "Nome da tarefa",
      "Início",
      "Término",
      "Duração",
      "% Concluído",
      "Coluna Estranha",
    ]);
    expect(mapping).toEqual([
      "wbs",
      "name",
      "start",
      "finish",
      "duration",
      "percent",
      null,
    ]);
    expect(CSV_FIELDS.length).toBeGreaterThanOrEqual(10);
  });

  it("normaliza acentos e caixa", () => {
    expect(normalizeLabel("Início")).toBe("inicio");
    expect(normalizeLabel("  PERCENTUAL  ")).toBe("percentual");
  });
});

/* ------------------------------------------------------------ CSV plano */

describe("buildCsvPlan", () => {
  const mapping = ["wbs", "name", "start", "finish", "duration", "predecessors"];
  const parse = (text: string) => parseCsv(text, ";");

  it("valida linha a linha com número da linha no relatório", () => {
    const { rows } = parse(
      [
        "WBS;Nome;Início;Término;Duração;Predecessores",
        "1;Alfa;05/01/2026;09/01/2026;5d;",
        "1.1;Beta;data-invalida;10/01/2026;2d;",
        "1.2;Gama;12/01/2026;14/01/2026;3d;",
        "1.3;Zeta;15/01/2026;16/01/2026;2d;9.9",
      ].join("\n"),
    );
    const plan = buildCsvPlan(rows, mapping, "replace");

    expect(plan.totalRows).toBe(4);
    expect(plan.validRows).toBe(2); // Alfa e Gama
    expect(plan.invalidRows).toBe(2);
    expect(plan.errors.map((error) => error.line)).toEqual([3, 5]);
    expect(plan.errors[0]!.reason).toContain("Data de início inválida");
    expect(plan.errors[1]!.reason).toContain("Predecessor inexistente");
    // Zeta (predecessor inválido) ficou fora junto — tudo-ou-nada
    expect(plan.tasks.map((task) => task.name)).toEqual(["Alfa", "Gama"]);
    expect(plan.links).toHaveLength(0);
  });

  it("monta hierarquia, ordem WBS e vínculos válidos", () => {
    const { rows } = parse(
      [
        "WBS;Nome;Início;Término;Duração;Predecessores",
        "1;Projeto;05/01/2026;30/01/2026;20d;",
        "1.2;Segunda;12/01/2026;14/01/2026;3d;1.1",
        "1.1;Primeira;05/01/2026;09/01/2026;5d;",
        "2;Outra;02/02/2026;03/02/2026;2d;",
      ].join("\n"),
    );
    const plan = buildCsvPlan(rows, mapping, "replace");

    expect(plan.tasks.map((task) => task.outlineNumber)).toEqual(["1", "1.1", "1.2", "2"]);
    expect(plan.tasks.map((task) => task.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(plan.tasks[0]!.parentKey).toBeNull();
    expect(plan.tasks[2]!.parentKey).toBe(plan.tasks[0]!.key); // 1.2 → 1
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0]!.predecessorKey).toBe(plan.tasks[1]!.key); // 1.1
    expect(plan.links[0]!.successorKey).toBe(plan.tasks[2]!.key); // 1.2
  });

  it("linha sem WBS vira raiz numerada sem colidir com explícitas", () => {
    const { rows } = parse(["WBS;Nome;Início;Término;Duração", "1;Com código;05/01/2026;06/01/2026;2d", ";Sem código;07/01/2026;08/01/2026;2d"].join("\n"));
    const plan = buildCsvPlan(rows, ["wbs", "name", "start", "finish", "duration"], "replace");

    expect(plan.tasks).toHaveLength(2);
    const outlines = plan.tasks.map((task) => task.outlineNumber).sort();
    expect(outlines).toEqual(["1", "2"]);
    expect(new Set(outlines).size).toBe(2); // sem colisão
  });

  it("WBS duplicado, nome vazio e pai ausente viram erros", () => {
    const { rows } = parse(
      [
        "WBS;Nome;Início;Término;Duração",
        "1;Alfa;05/01/2026;09/01/2026;5d",
        "1;Beta;05/01/2026;09/01/2026;5d",
        ";  ;05/01/2026;09/01/2026;5d",
        "9.1;Órfã;05/01/2026;09/01/2026;5d",
      ].join("\n"),
    );
    const plan = buildCsvPlan(rows, ["wbs", "name", "start", "finish", "duration"], "replace");

    expect(plan.validRows).toBe(1);
    expect(plan.errors.map((error) => error.line)).toEqual([3, 4, 5]);
    expect(plan.errors[1]!.reason).toContain("Nome da tarefa vazio");
    expect(plan.errors[2]!.reason).toContain("Pai inexistente");
  });

  it("marca acima do limite de linhas", () => {
    const header = "WBS;Nome";
    const lines = Array.from(
      { length: IMPORT_ROW_LIMIT + 1 },
      (_, index) => `${index + 1};T${index + 1}`,
    );
    const { rows } = parse([header, ...lines].join("\n"));
    const plan = buildCsvPlan(rows, ["wbs", "name"], "replace");
    expect(plan.exceedsLimit).toBe(true);
  });

  it("recurso citado vira recurso + atribuição", () => {
    const { rows } = parse(
      [
        "WBS;Nome;Início;Término;Duração;Predecessores;Recursos",
        "1;Alfa;05/01/2026;09/01/2026;5d;;Ana, Bia",
      ].join("\n"),
    );
    const plan = buildCsvPlan(
      rows,
      ["wbs", "name", "start", "finish", "duration", "predecessors", "resources"],
      "replace",
    );
    expect(plan.validRows).toBe(1);
    expect(plan.resources.map((resource) => resource.name)).toEqual(["Ana", "Bia"]);
    expect(plan.assignments).toHaveLength(2);
    expect(plan.assignments[0]!.resourceKey).toContain("ana");
  });
});

/* ------------------------------------------------------------ JSON plano */

const JSON_OK = JSON.stringify({
  format: "ontarget",
  version: 1,
  data: {
    tasks: [
      { id: "t1", parentId: null, outlineNumber: "1", name: "Alfa", sortOrder: 0, start: 1, finish: 2, duration: 3, percentComplete: 40 },
      { id: "t2", parentId: "t1", outlineNumber: "1.1", name: "Beta", sortOrder: 1, start: 2, finish: 3, duration: 4 },
    ],
    taskLinks: [{ id: "l1", predecessorId: "t1", successorId: "t2", type: "fs", lagMs: 0 }],
    resources: [{ id: "r1", name: "Ana", type: "work" }],
    assignments: [{ id: "a1", taskId: "t1", resourceId: "r1", units: 1, work: 8 }],
    customFields: [{ id: "cf1", name: "Setor", entityType: "task", dataType: "text", sortOrder: 0 }],
    customFieldValues: [{ fieldId: "cf1", entityId: "t1", valueText: "TI" }],
    baselines: [{ id: "b1", name: "Baseline 1", kind: "baseline", savedAt: 5, scope: "project" }],
    baselineValues: [{ baselineId: "b1", taskId: "t1", start: 1, finish: 2, duration: 3 }],
  },
});

describe("buildJsonPlan", () => {
  it("rejeita formato, versão e estrutura desconhecidos", () => {
    expect(buildJsonPlan("não é json", "replace").fatal).toContain("JSON inválido");
    expect(buildJsonPlan(JSON.stringify({ format: "outro", version: 1 }), "replace").fatal).toContain(
      "Formato não reconhecido",
    );
    expect(
      buildJsonPlan(JSON.stringify({ format: "ontarget", version: 99 }), "replace").fatal,
    ).toContain("não suportada");
    expect(
      buildJsonPlan(JSON.stringify({ format: "ontarget", version: 1, data: {} }), "replace").fatal,
    ).toContain("data.tasks");
  });

  it("aceita o formato legado “e-project” (rename da aplicação)", () => {
    const legacy = JSON_OK.replace('"format":"ontarget"', '"format":"e-project"');
    const plan = buildJsonPlan(legacy, "replace");

    expect(plan.fatal).toBeUndefined();
    expect(plan.totalRows).toBe(2);
  });

  it("plano completo preserva as linhas originais (round-trip)", () => {
    const plan = buildJsonPlan(JSON_OK, "replace");

    expect(plan.fatal).toBeUndefined();
    expect(plan.totalRows).toBe(2);
    expect(plan.validRows).toBe(2);
    expect(plan.errors).toHaveLength(0);
    expect(plan.tasks.map((task) => task.outlineNumber)).toEqual(["1", "1.1"]);
    expect(plan.tasks[0]!.raw?.id).toBe("t1");
    expect(plan.links).toHaveLength(1);
    expect(plan.resources.map((resource) => resource.name)).toEqual(["Ana"]);
    expect(plan.assignments[0]!.units).toBe(1);
    expect(plan.customFields.map((field) => field.name)).toEqual(["Setor"]);
    expect(plan.customFieldValues[0]!.valueText).toBe("TI");
    expect(plan.baselines.map((baseline) => baseline.name)).toEqual(["Baseline 1"]);
    expect(plan.baselineValues).toHaveLength(1);
  });

  it("tarefa sem nome, WBS duplicado e referências órfãs viram erros", () => {
    const plan = buildJsonPlan(
      JSON.stringify({
        format: "ontarget",
        version: 1,
        data: {
          tasks: [
            { id: "t1", outlineNumber: "1", name: "" },
            { id: "t2", outlineNumber: "1", name: "Dupla" },
            { id: "t3", parentId: "sumiu", outlineNumber: "2", name: "Órfã" },
          ],
          taskLinks: [{ predecessorId: "t1", successorId: "não-existe", type: "fs" }],
        },
      }),
      "replace",
    );

    expect(plan.validRows).toBe(1); // só a "Dupla"
    expect(plan.errors.length).toBeGreaterThanOrEqual(3);
    expect(plan.tasks.map((task) => task.name)).toEqual(["Dupla"]);
    expect(plan.links).toHaveLength(0);
  });

  it("passa o limite para JSON também", () => {
    const tasks = Array.from({ length: IMPORT_ROW_LIMIT + 1 }, (_, index) => ({
      id: `t${index}`,
      outlineNumber: String(index + 1),
      name: `T${index}`,
    }));
    const plan = buildJsonPlan(
      JSON.stringify({ format: "ontarget", version: 1, data: { tasks } }),
      "replace",
    );
    expect(plan.exceedsLimit).toBe(true);
  });
});

describe("buildErrorReport", () => {
  it("gera CSV com número da linha e motivo neutralizado", () => {
    const report = buildErrorReport([
      { line: 3, reason: "Data inválida: “abc”" },
      { line: 5, reason: 'Motivo com "aspas" e vírgula, aqui' },
    ]);
    const lines = report.split("\n");
    expect(lines[0]).toBe("Linha,Motivo");
    expect(lines[1]).toContain("3,");
    expect(lines[2]!.startsWith("5,")).toBe(true);
    expect(lines[2]).toContain('""aspas""'); // aspas escapadas
  });

  it("neutraliza motivo que começa com fórmula", () => {
    const report = buildErrorReport([{ line: 2, reason: "=1+1" }]);
    expect(report.split("\n")[1]).toContain("'=1+1");
  });
});

/* --------------------------------------------------------- commit/payload */

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "old-1",
    projectId: "p1",
    parentId: null,
    outlineLevel: 0,
    outlineNumber: "1",
    sortOrder: 0,
    name: "Existente",
    notes: null,
    isSummary: false,
    isMilestone: false,
    isInactive: false,
    schedulingMode: "auto",
    isPlaceholder: false,
    taskType: "fixed_duration",
    effortDriven: true,
    constraintType: null,
    constraintDate: null,
    deadline: null,
    manualStart: null,
    manualFinish: null,
    manualDuration: null,
    start: null,
    finish: null,
    duration: null,
    durationUnit: null,
    work: null,
    cost: null,
    fixedCost: null,
    actualStart: null,
    actualFinish: null,
    actualDuration: null,
    actualWork: null,
    actualCost: null,
    percentComplete: 0,
    physicalPercent: null,
    durationEstimated: false,
    priority: 500,
    calendarId: null,
    wbsCode: null,
    recurrence: null,
    segments: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("buildImportPayload", () => {
  const baseState = (): ImportState => ({
    projectId: "p1",
    tasks: [makeTask({ id: "old-1", outlineNumber: "1", name: "Existente" })],
    taskLinks: [],
    resources: [],
    assignments: [],
    baselines: [],
    customFields: [],
    calendarIds: ["cal-1"],
    teamIds: [],
    now: 1000,
  });

  it("substituição: ids novos, referências remapeadas e entidades a apagar", () => {
    const plan = buildJsonPlan(JSON_OK, "replace");
    const payload = buildImportPayload(plan, baseState());

    expect(payload.mode).toBe("replace");
    // JSON substitui o conjunto completo
    expect(payload.replaceEntities).toEqual(["tasks", "resources", "custom_fields", "baselines"]);

    const tasks = payload.upserts.tasks!;
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.id).not.toBe("t1"); // id remapeado (evita colisão global)
    expect(tasks[0]!.projectId).toBe("p1");
    // filho aponta para o pai já remapeado
    const parentById = new Map(tasks.map((row) => [row.id, row]));
    const child = tasks.find((row) => row.outlineNumber === "1.1")!;
    expect(parentById.has(String(child.parentId))).toBe(true);

    // vínculo usa os ids novos
    const link = payload.upserts.task_links![0]!;
    expect(parentById.has(String(link.predecessorId))).toBe(true);

    // ordem das chaves respeita FK: recursos/tarefas antes de dependências
    const keys = Object.keys(payload.upserts);
    expect(keys.indexOf("resources")).toBeLessThan(keys.indexOf("assignments"));
    expect(keys.indexOf("tasks")).toBeLessThan(keys.indexOf("task_links"));
    expect(keys.indexOf("tasks")).toBeLessThan(keys.indexOf("baseline_values"));
    expect(keys.indexOf("custom_fields")).toBeLessThan(keys.indexOf("custom_field_values"));
  });

  it("mesclagem: reaproveita a tarefa existente por WBS e deduplica vínculo", () => {
    const existing = makeTask({ id: "old-1", outlineNumber: "1", name: "Existente" });
    const state = baseState();
    state.taskLinks = [
      {
        id: "link-1",
        projectId: "p1",
        predecessorId: "old-1",
        successorId: "old-2",
        type: "fs",
        lagMs: 0,
        crossProjectRef: null,
      },
    ];
    state.tasks = [
      existing,
      makeTask({ id: "old-2", outlineNumber: "1.1", name: "Filha", parentId: "old-1" }),
    ];

    const plan = buildJsonPlan(JSON_OK, "merge");
    const payload = buildImportPayload(plan, state);

    expect(payload.replaceEntities).toEqual([]);
    const tasks = payload.upserts.tasks!;
    const byOutline = new Map(tasks.map((row) => [row.outlineNumber, row]));
    // 1 e 1.1 existiam → mescladas mantêm os ids antigos
    expect(byOutline.get("1")!.id).toBe("old-1");
    expect(byOutline.get("1.1")!.id).toBe("old-2");
    // vínculo idêntico já existente → mesmo id (upsert, sem duplicar)
    expect(payload.upserts.task_links!).toHaveLength(1);
    expect(payload.upserts.task_links![0]!.id).toBe("link-1");
  });

  it("CSV substitui só tarefas (recursos/vínculos dependem delas)", () => {
    const { rows } = parseCsv("WBS;Nome;Início;Término;Duração\n1;Alfa;05/01/2026;09/01/2026;5d", ";");
    const plan = buildCsvPlan(rows, ["wbs", "name", "start", "finish", "duration"], "replace");
    const payload = buildImportPayload(plan, baseState());

    expect(payload.replaceEntities).toEqual(["tasks"]);
    const task = payload.upserts.tasks![0]!;
    expect(task.name).toBe("Alfa");
    expect(task.schedulingMode).toBe("auto");
    expect(task.projectId).toBe("p1");
  });
});
