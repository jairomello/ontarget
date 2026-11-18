import { IMPORT_FORMAT, IMPORT_VERSION } from "../import/importing";

/**
 * Exportação JSON e CSV (specs/import-export): o JSON sai no MESMO formato
 * que a importação lê (round-trip garantido) e o CSV respeita o escopo
 * visível da ativa — linhas (filtros/agrupamento/ordenação) e colunas
 * exibidas — com neutralização de fórmulas na planilha.
 */

export interface ExportPayload {
  format: string;
  version: number;
  exportedAt: number;
  data: {
    tasks: object[];
    taskLinks: object[];
    resources: object[];
    assignments: object[];
    customFields: object[];
    customFieldValues: object[];
    baselines: object[];
    baselineValues: object[];
  };
}

export interface ExportState {
  tasks: object[];
  taskLinks: object[];
  resources: object[];
  assignments: object[];
  customFields: object[];
  customFieldValues: object[];
  baselines: object[];
  baselineValues: object[];
}

/** Projeto completo no formato versionado do produto. */
export function buildExportPayload(state: ExportState, now = Date.now()): ExportPayload {
  return {
    format: IMPORT_FORMAT,
    version: IMPORT_VERSION,
    exportedAt: now,
    data: {
      tasks: state.tasks.map((row) => ({ ...row })),
      taskLinks: state.taskLinks.map((row) => ({ ...row })),
      resources: state.resources.map((row) => ({ ...row })),
      assignments: state.assignments.map((row) => ({ ...row })),
      customFields: state.customFields.map((row) => ({ ...row })),
      customFieldValues: state.customFieldValues.map((row) => ({ ...row })),
      baselines: state.baselines.map((row) => ({ ...row })),
      baselineValues: state.baselineValues.map((row) => ({ ...row })),
    },
  };
}

/* -------------------------------------------------------------------- CSV */

const DELIMITER = ";";

/**
 * Célula CSV com proteção de injeção (specs/import-export — "Proteção
 * contra injeção em CSV"): valor que começa com `=`, `+`, `-` ou `@` ganha
 * apóstrofo para a planilha não interpretar como fórmula; aspas e o
 * delimitador são escapados conforme RFC 4180.
 */
export function escapeCsvCell(value: string, delimiter = DELIMITER): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (
    guarded.includes('"') ||
    guarded.includes(delimiter) ||
    guarded.includes("\n") ||
    guarded.includes("\r")
  ) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export interface ExportColumn {
  key: string;
  label: string;
}

export type ExportRow =
  | { kind: "group"; label: string }
  | { kind: "task"; id: string };

/**
 * CSV do escopo visível: cabeçalho com os rótulos das colunas exibidas e
 * uma linha por linha visível (cabeçalhos de grupo entram com o rótulo na
 * primeira coluna). `valueOf` resolve a célula (injetado pela UI).
 */
export function buildCsvExport(
  columns: readonly ExportColumn[],
  rows: readonly ExportRow[],
  valueOf: (columnKey: string, taskId: string) => string,
  delimiter = DELIMITER,
): string {
  const line = (cells: string[]) =>
    cells.map((cell) => escapeCsvCell(cell, delimiter)).join(delimiter);

  const lines = [line(columns.map((column) => column.label))];
  for (const row of rows) {
    if (row.kind === "group") {
      lines.push(line(columns.map((_column, index) => (index === 0 ? row.label : ""))));
    } else {
      lines.push(line(columns.map((column) => valueOf(column.key, row.id))));
    }
  }
  // BOM + CRLF: abre corretamente no Excel em pt-BR
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Baixa um arquivo gerado no cliente. */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
