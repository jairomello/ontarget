/**
 * Escala temporal do Gantt (docs/architecture.md §9.3, docs/Design.md §7).
 *
 * Pura e sem DOM: converte datas em pixels, gera as divisões (ticks) da
 * grade e do cabeçalho, e faz o snap de arraste. Todas as operações usam
 * relógio UTC-naive — nunca há fuso horário nem horário de verão.
 */

export const MIN_PX_PER_DAY = 1.5;
export const MAX_PX_PER_DAY = 4000;

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export type DisplayUnit = "hour" | "day" | "week" | "month" | "quarter" | "year";

export type HeaderBand = "year" | "month" | "day" | "week" | "quarter" | "semester";

export interface Tick {
  /** Epoch ms (UTC-naive) da divisão. */
  at: number;
  /** Rótulo curto para exibição. */
  label: string;
  /** Largura em px do bloco (para faixas do cabeçalho). */
  width: number;
  /** Unidade da divisão. */
  unit: DisplayUnit;
}

export interface ScaleTicks {
  /** Divisões finas (linhas da grade). */
  minor: Tick[];
  /** Divisões fortes (linhas da grade). */
  major: Tick[];
  /** Faixas do cabeçalho, da mais grossa para a mais fina. */
  header: Array<{ band: HeaderBand; ticks: Tick[] }>;
}

interface ScaleLevel {
  /** Menor px/dia em que este nível vale. */
  minPx: number;
  unit: DisplayUnit;
  minor: DisplayUnit;
  major: DisplayUnit;
  header: HeaderBand[];
}

/** Tabela de níveis — espelha docs/Design.md §7.1. */
const LEVELS: ScaleLevel[] = [
  { minPx: 400, unit: "hour", minor: "hour", major: "day", header: ["year", "month", "day"] },
  { minPx: 90, unit: "day", minor: "day", major: "week", header: ["year", "month", "day"] },
  { minPx: 26, unit: "week", minor: "day", major: "week", header: ["year", "month", "week"] },
  { minPx: 8, unit: "month", minor: "month", major: "quarter", header: ["year", "month"] },
  { minPx: 3, unit: "quarter", minor: "quarter", major: "year", header: ["year", "quarter"] },
  { minPx: 0, unit: "year", minor: "year", major: "year", header: ["year", "semester"] },
];

/** Nível de escala para um zoom. */
export function levelFor(pxPerDay: number): ScaleLevel {
  const clamped = clampZoom(pxPerDay);
  return LEVELS.find((level) => clamped >= level.minPx) ?? LEVELS[LEVELS.length - 1]!;
}

export function displayUnitFor(pxPerDay: number): DisplayUnit {
  return levelFor(pxPerDay).unit;
}

export function clampZoom(pxPerDay: number): number {
  if (!Number.isFinite(pxPerDay)) return 26;
  return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, pxPerDay));
}

/* -------------------------------------------------------------------------- */
/* Aritmética de calendário (UTC-naive)                                        */
/* -------------------------------------------------------------------------- */

const MONTH_NAMES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const MONTH_NAMES_FULL = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Início (UTC-naive) da unidade que contém `value`. */
export function startOfUnit(value: number, unit: DisplayUnit): number {
  const date = new Date(value);

  switch (unit) {
    case "hour":
      return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
      );
    case "day":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    case "week": {
      const dayStart = startOfUnit(value, "day");
      const weekday = (new Date(dayStart).getUTCDay() + 6) % 7; // segunda = 0
      return dayStart - weekday * DAY_MS;
    }
    case "month":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    case "quarter":
      return Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1);
    case "year":
      return Date.UTC(date.getUTCFullYear(), 0, 1);
  }
}

/** Avança `amount` unidades de calendário. */
export function addUnit(value: number, unit: DisplayUnit, amount = 1): number {
  const date = new Date(value);

  switch (unit) {
    case "hour":
      return value + amount * HOUR_MS;
    case "day":
      return value + amount * DAY_MS;
    case "week":
      return value + amount * 7 * DAY_MS;
    case "month": {
      const month = date.getUTCMonth() + amount;
      const year = date.getUTCFullYear() + Math.floor(month / 12);
      const normalized = ((month % 12) + 12) % 12;
      const day = Math.min(date.getUTCDate(), daysInMonth(year, normalized));
      return Date.UTC(year, normalized, day);
    }
    case "quarter":
      return addUnit(value, "month", amount * 3);
    case "year": {
      const year = date.getUTCFullYear() + amount;
      const day = Math.min(date.getUTCDate(), daysInMonth(year, date.getUTCMonth()));
      return Date.UTC(year, date.getUTCMonth(), day);
    }
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/* -------------------------------------------------------------------------- */
/* Rótulos                                                                     */
/* -------------------------------------------------------------------------- */

export function labelFor(value: number, unit: DisplayUnit): string {
  const date = new Date(value);

  switch (unit) {
    case "hour":
      return `${String(date.getUTCHours()).padStart(2, "0")}h`;
    case "day":
      return String(date.getUTCDate());
    case "week": {
      const end = addUnit(value, "week") - DAY_MS;
      const end_date = new Date(end);
      return `${new Date(value).getUTCDate()}/${end_date.getUTCMonth() + 1}`;
    }
    case "month":
      return MONTH_NAMES[date.getUTCMonth()]!;
    case "quarter":
      return `T${Math.floor(date.getUTCMonth() / 3) + 1}`;
    case "year":
      return String(date.getUTCFullYear());
  }
}

export function labelForBand(value: number, band: HeaderBand): string {
  const date = new Date(value);

  switch (band) {
    case "year":
      return String(date.getUTCFullYear());
    case "semester":
      return `S${date.getUTCMonth() < 6 ? 1 : 2}`;
    case "quarter":
      return `T${Math.floor(date.getUTCMonth() / 3) + 1}`;
    case "month":
      return MONTH_NAMES_FULL[date.getUTCMonth()]!;
    case "week":
      return `sem ${labelFor(value, "week")}`;
    case "day":
      return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Escala                                                                      */
/* -------------------------------------------------------------------------- */

export interface TimeScaleOptions {
  /** Pixels por dia (contínuo, 1,5 a 4.000). */
  pxPerDay: number;
  /** Data correspondente à borda esquerda (x = 0). */
  originMs: number;
  /** Largura visível em pixels. */
  widthPx: number;
}

export interface TimeScale {
  pxPerDay: number;
  originMs: number;
  widthPx: number;
  unit: DisplayUnit;
  level: ScaleLevel;
  /** Data → posição horizontal. */
  x(dateMs: number): number;
  /** Posição horizontal → data (não arredondada). */
  dateAt(x: number): number;
  /** Janela de datas visível. */
  window(): { from: number; to: number };
  /** Divisões da grade e do cabeçalho para a janela visível. */
  ticks(): ScaleTicks;
  /** Aproxima uma data para o início da unidade informada. */
  snap(dateMs: number, unit?: DisplayUnit): number;
}

/** Máximo de divisões geradas por camada (evita travar em zoom extremo). */
const MAX_TICKS = 1500;

export function createTimeScale(options: TimeScaleOptions): TimeScale {
  const pxPerDay = clampZoom(options.pxPerDay);
  const originMs = startOfUnit(options.originMs, "day");
  const widthPx = Math.max(0, options.widthPx);
  const level = levelFor(pxPerDay);

  const msPerPx = DAY_MS / pxPerDay;

  const window = () => ({
    from: originMs,
    to: originMs + widthPx * msPerPx,
  });

  const collect = (unit: DisplayUnit, from: number, to: number): Tick[] => {
    const ticks: Tick[] = [];
    let cursor = startOfUnit(from, unit);
    let step = 1;

    while (cursor <= to) {
      const next = addUnit(cursor, unit, step);
      ticks.push({
        at: cursor,
        label: labelFor(cursor, unit),
        width: Math.max(1, ((next - cursor) / DAY_MS) * pxPerDay),
        unit,
      });

      if (ticks.length > MAX_TICKS) {
        // janela muito grande para a unidade: engrossa o passo
        step *= 2;
        ticks.length = 0;
        cursor = startOfUnit(from, unit);
        continue;
      }
      cursor = next;
    }

    return ticks;
  };

  const collectBand = (band: HeaderBand): Tick[] => {
    const unit: DisplayUnit =
      band === "year"
        ? "year"
        : band === "semester"
          ? "quarter"
          : band === "quarter"
            ? "quarter"
            : band === "month"
              ? "month"
              : band === "week"
                ? "week"
                : "day";

    const { from, to } = window();
    const ticks = collect(unit === "quarter" && band === "semester" ? "quarter" : unit, from, to);

    if (band === "semester") {
      // semestres: dois por ano, alinhados a jan/jul
      return ticks
        .filter((tick) => new Date(tick.at).getUTCMonth() % 6 === 0)
        .map((tick) => ({ ...tick, label: labelForBand(tick.at, "semester") }));
    }

    if (band === "week") {
      return ticks.map((tick) => ({ ...tick, label: labelForBand(tick.at, "week") }));
    }

    return ticks.map((tick) => ({ ...tick, label: labelForBand(tick.at, band) }));
  };

  return {
    pxPerDay,
    originMs,
    widthPx,
    unit: level.unit,
    level,

    x: (dateMs) => (dateMs - originMs) / msPerPx,

    dateAt: (x) => originMs + x * msPerPx,

    window,

    ticks: () => {
      const { from, to } = window();
      return {
        minor: collect(level.minor, from, to),
        major: collect(level.major, from, to),
        header: level.header.map((band) => ({ band, ticks: collectBand(band) })),
      };
    },

    snap: (dateMs, unit = level.unit) => startOfUnit(dateMs, unit),
  };
}
