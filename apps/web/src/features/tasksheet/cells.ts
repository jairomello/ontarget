import {
  formatDateInput,
  formatDurationMs,
  parseDate,
  parseDuration,
  parseNumber,
  parsePercent,
} from "@ontarget/core";

/** Tipos de célula editável (espelha `columns.ts`). */
export type CellType =
  | "text"
  | "date"
  | "duration"
  | "percent"
  | "number"
  | "cost"
  | "flag"
  | "list";

export interface CellParse {
  ok: boolean;
  value?: unknown;
  reason?: string;
}

/** Interpreta o texto digitado conforme o tipo da célula. */
export function parseCell(
  type: CellType,
  raw: string,
  options: readonly string[] = [],
): CellParse {
  const text = raw.trim();

  switch (type) {
    case "text":
      return { ok: true, value: raw };

    case "date": {
      const parsed = parseDate(text);
      return parsed === null
        ? { ok: false, reason: "Data inválida — use dd/MM/aaaa, +2d ou hoje" }
        : { ok: true, value: parsed };
    }

    case "duration": {
      const parsed = parseDuration(text);
      return parsed === null
        ? { ok: false, reason: "Duração inválida — use 3d, 40h ou 2 semanas" }
        : { ok: true, value: parsed.ms };
    }

    case "percent": {
      const parsed = parsePercent(text);
      return parsed === null
        ? { ok: false, reason: "Percentual inválido — informe um valor entre 0 e 100" }
        : { ok: true, value: parsed };
    }

    case "number":
    case "cost": {
      const parsed = parseNumber(text);
      return parsed === null
        ? { ok: false, reason: "Número inválido — use 1234,56" }
        : { ok: true, value: parsed };
    }

    case "flag":
      return { ok: true, value: isTruthy(text) };

    case "list":
      if (options.length > 0 && !options.includes(text)) {
        return { ok: false, reason: "Escolha um valor da lista" };
      }
      return { ok: true, value: text };

    default:
      return { ok: false, reason: "Tipo de célula não editável" };
  }
}

function isTruthy(value: string): boolean {
  return ["sim", "s", "true", "1", "verdadeiro", "x"].includes(value.toLowerCase());
}

/** Texto inicial do editor (e do preview) conforme o tipo. */
export function initialCellText(type: CellType, value: unknown): string {
  if (value === null || value === undefined) return "";

  switch (type) {
    case "date":
      return typeof value === "number" ? formatDateInput(value) : String(value);
    case "duration":
      return typeof value === "number" ? formatDurationMs(value) : String(value);
    case "percent":
    case "number":
    case "cost":
      return String(value);
    case "flag":
      return value ? "Sim" : "Não";
    default:
      return String(value);
  }
}
