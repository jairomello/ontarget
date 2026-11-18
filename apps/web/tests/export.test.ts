import { describe, expect, it } from "bun:test";
import {
  buildCsvExport,
  buildExportPayload,
  escapeCsvCell,
} from "../src/features/export/exporting";
import { buildJsonPlan } from "../src/features/import/importing";

/**
 * Exportação (specs/import-export): proteção contra injeção no CSV, escopo
 * visível (colunas + linhas com grupos) e JSON no formato que a
 * importação lê (round-trip).
 */

describe("escapeCsvCell", () => {
  it("neutraliza valores que começam com caractere de fórmula", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    expect(escapeCsvCell("Alfa")).toBe("Alfa");
    expect(escapeCsvCell("05/01/2026")).toBe("05/01/2026"); // não começa com sinal
    expect(escapeCsvCell("-2d")).toBe("'-2d"); // desvio negativo é texto, não fórmula
  });

  it("escapa aspas, delimitador e quebras de linha (RFC 4180)", () => {
    expect(escapeCsvCell("a;b")).toBe('"a;b"');
    expect(escapeCsvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(escapeCsvCell("linha1\nlinha2")).toBe('"linha1\nlinha2"');
    // com fórmula E delimitador: apóstrofo primeiro, depois aspas do RFC
    expect(escapeCsvCell("=1+1;2")).toBe("\"'=1+1;2\"");
  });
});

describe("buildCsvExport", () => {
  const columns = [
    { key: "wbs", label: "WBS" },
    { key: "name", label: "Nome" },
    { key: "duration", label: "Duração" },
  ];
  const valueOf = (key: string, id: string): string => {
    if (id !== "t1") return "";
    if (key === "wbs") return "1.1";
    if (key === "name") return "=1+1";
    return "5d";
  };

  it("gera cabeçalho, linhas de tarefa e grupo na primeira coluna", () => {
    const csv = buildCsvExport(
      columns,
      [
        { kind: "group", label: "Ana" },
        { kind: "task", id: "t1" },
      ],
      valueOf,
    );

    expect(csv.startsWith("\uFEFF")).toBe(true); // BOM p/ Excel
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("WBS;Nome;Duração");
    expect(lines[1]).toBe("Ana;;"); // cabeçalho de grupo
    expect(lines[2]).toBe("1.1;'=1+1;5d"); // injeção neutralizada
    expect(lines[3]).toBe(""); // termina com CRLF
  });

  it("respeita o escopo: só as linhas recebidas entram", () => {
    const csv = buildCsvExport(columns, [{ kind: "task", id: "t1" }], valueOf);
    expect(csv).not.toContain("t2");
    const lines = csv
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter((line) => line !== "");
    expect(lines).toHaveLength(2); // cabeçalho + 1 linha
  });
});

describe("buildExportPayload", () => {
  it("usa o formato versionado que a importação aceita (round-trip)", () => {
    const payload = buildExportPayload(
      {
        tasks: [
          {
            id: "t1",
            projectId: "p1",
            parentId: null,
            outlineLevel: 0,
            outlineNumber: "1",
            sortOrder: 0,
            name: "Alfa",
            start: 10,
            finish: 20,
            duration: 30,
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
        taskLinks: [],
        resources: [{ id: "r1", name: "Ana", type: "work" }],
        assignments: [],
        customFields: [],
        customFieldValues: [],
        baselines: [],
        baselineValues: [],
      },
      123,
    );

    expect(payload.format).toBe("ontarget");
    expect(payload.version).toBe(1);
    expect(payload.exportedAt).toBe(123);

    // o plano de importação lê sem fatal e com as mesmas entidades
    const plan = buildJsonPlan(JSON.stringify(payload), "replace");
    expect(plan.fatal).toBeUndefined();
    expect(plan.totalRows).toBe(1);
    expect(plan.tasks[0]!.name).toBe("Alfa");
    expect(plan.resources.map((resource) => resource.name)).toEqual(["Ana"]);
    expect(plan.errors).toHaveLength(0);
  });
});
