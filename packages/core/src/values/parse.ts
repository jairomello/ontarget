/**
 * Conversão de valores digitados pelo usuário (celulas, formulários,
 * importação). Sempre puro, sem dependência de DOM ou fuso horário:
 * datas são epoch ms em relógio UTC-naive (docs/architecture.md §8.1).
 */

/** 1 dia de trabalho padrão = 8 horas (09:00–18:00 com 1h de intervalo). */
export const WORKDAY_MS = 8 * 60 * 60 * 1000;
export const WORKWEEK_MS = 5 * WORKDAY_MS;
export const WORKMONTH_MS = 20 * WORKDAY_MS;
export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

export type DurationUnit = "minute" | "hour" | "day" | "week" | "month";

export const UNIT_MS: Record<DurationUnit, number> = {
  minute: MINUTE_MS,
  hour: HOUR_MS,
  day: WORKDAY_MS,
  week: WORKWEEK_MS,
  month: WORKMONTH_MS,
};

export interface ParsedDuration {
  ms: number;
  unit: DurationUnit;
}

const DURATION_PATTERN =
  /^\s*([+-]?\d+(?:[.,]\d+)?)\s*(min|mins|minuto|minutos|h|hs|hora|horas|d|dd|dia|dias|sem|semana|semanas|w|wk|mes|meses|month|m)\s*$/i;

const UNIT_ALIASES: Record<string, DurationUnit> = {
  min: "minute",
  mins: "minute",
  minuto: "minute",
  minutos: "minute",
  h: "hour",
  hs: "hour",
  hora: "hour",
  horas: "hour",
  d: "day",
  dd: "day",
  dia: "day",
  dias: "day",
  sem: "week",
  semana: "week",
  semanas: "week",
  w: "week",
  wk: "week",
  mes: "month",
  meses: "month",
  month: "month",
  m: "month",
};

/** Interpreta `3d`, `40h`, `2 semanas`, `0,5 dia` (unidade padrão: dia). */
export function parseDuration(raw: string): ParsedDuration | null {
  const trimmed = stripAccents(raw).trim();
  if (trimmed === "") return null;

  // número puro → unidade padrão (dia)
  const bare = trimmed.match(/^([+-]?\d+(?:[.,]\d+)?)$/);
  if (bare) {
    return { ms: toNumber(bare[1]!) * UNIT_MS.day, unit: "day" };
  }

  const match = trimmed.match(DURATION_PATTERN);
  if (!match) return null;

  const unit = UNIT_ALIASES[match[2]!.toLowerCase()];
  if (!unit) return null;

  const value = toNumber(match[1]!);
  if (Number.isNaN(value)) return null;

  return { ms: value * UNIT_MS[unit], unit };
}

/** Interpreta percentual: `50`, `50%`, `0,5` (0–100). */
export function parsePercent(raw: string): number | null {
  const trimmed = raw.trim().replace(/%$/, "").trim();
  if (trimmed === "") return null;

  const value = toNumber(trimmed);
  if (Number.isNaN(value)) return null;
  if (value < 0 || value > 100) return null;

  // formato decimal fracionário (0,5 → 50%)
  if (value > 0 && value <= 1 && /[.,]/.test(trimmed)) return value * 100;

  return value;
}

/** Interpreta número aceitando separadores pt-BR e en-US. */
export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = toNumber(trimmed);
  return Number.isNaN(value) ? null : value;
}

const MONTHS: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

/**
 * Interpreta datas em pt-BR: `13/11/2026`, `13/11`, `+2d`, `+1 semana`,
 * `hoje`, `amanhã`. Retorna epoch ms à meia-noite UTC-naive ou `null`.
 */
export function parseDate(raw: string, reference = Date.now()): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return null;

  const today = startOfUtcDay(reference);

  if (trimmed === "hoje") return today;
  if (trimmed === "amanhã" || trimmed === "amanha") return today + 86_400_000;
  if (trimmed === "ontem") return today - 86_400_000;

  // relativo: +2d, -3 dias, +1 semana
  const relative = trimmed.match(/^([+-])\s*(\d+)\s*(d|dia|dias|sem|semana|semanas|h|hora|horas|mes|meses)?$/);
  if (relative) {
    const sign = relative[1] === "-" ? -1 : 1;
    const amount = Number(relative[2]);
    const unit = (relative[3] ?? "d").toLowerCase();
    const step =
      unit.startsWith("h") ? 86_400_000 : unit.startsWith("sem") ? 7 * 86_400_000 : unit.startsWith("mes") ? 30 * 86_400_000 : 86_400_000;
    return today + sign * amount * step;
  }

  // absoluto: dd/mm/yyyy ou dd/mm
  const absolute = trimmed.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (absolute) {
    const day = Number(absolute[1]);
    const month = Number(absolute[2]) - 1;
    let year = absolute[3] ? Number(absolute[3]) : new Date(reference).getUTCFullYear();
    if (year < 100) year += 2000;

    if (day < 1 || day > 31 || month < 0 || month > 11) return null;
    const result = Date.UTC(year, month, day);
    // rejeita datas que o calendário não comporta (31/02)
    const check = new Date(result);
    if (check.getUTCDate() !== day || check.getUTCMonth() !== month) return null;
    return result;
  }

  // dd-mmm-yyyy (ex.: 13-nov-2026)
  const named = trimmed.match(/^(\d{1,2})[-/ ]([a-z]{3,})[-/ ](\d{2,4})$/);
  if (named) {
    const month = MONTHS[named[2]!.slice(0, 3)];
    if (month === undefined) return null;
    let year = Number(named[3]);
    if (year < 100) year += 2000;
    return Date.UTC(year, month, Number(named[1]));
  }

  return null;
}

/** Formata epoch ms (UTC-naive) como `dd/MM/yyyy`. */
export function formatDateInput(value: number): string {
  const date = new Date(value);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

/** Formata duração em ms de tempo útil (`3d`, `4h`, `0,5d`). */
export function formatDurationMs(ms: number): string {
  if (ms === 0) return "0d";
  if (ms % UNIT_MS.day === 0) return `${ms / UNIT_MS.day}d`;
  if (ms % UNIT_MS.hour === 0) return `${ms / UNIT_MS.hour}h`;
  if (ms % UNIT_MS.minute === 0) return `${ms / UNIT_MS.minute}min`;

  const days = ms / UNIT_MS.day;
  return `${trim(days)}d`;
}

function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace(".", ",");
}

/** Remove acentos para aceitar `mês`, `mês`, `semanas` etc. */
function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Converte número com vírgula ou ponto para número. */
function toNumber(raw: string): number {
  const trimmed = raw.trim();
  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");

  if (hasComma && hasDot) {
    // o último separador é o decimal
    const decimal = trimmed.lastIndexOf(",") > trimmed.lastIndexOf(".") ? "," : ".";
    const other = decimal === "," ? "." : ",";
    return Number(trimmed.split(other).join("").replace(decimal, "."));
  }
  if (hasComma) return Number(trimmed.replace(",", "."));
  return Number(trimmed);
}

/** Meio-dia UTC-naive do dia de uma data (evita bordas de fuso). */
export function startOfUtcDay(value: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
