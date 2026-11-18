/**
 * Calendários de trabalho (specs/calendars): convertem entre tempo de
 * parede e tempo útil, respeitando dias úteis, turnos e exceções.
 *
 * Relógio UTC-naive — sem fuso e sem horário de verão
 * (docs/architecture.md §8.1).
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

export interface CalendarException {
  /** Epoch ms (UTC-naive) identificando o dia. */
  date: number;
  /** `true` = dia útil especial; `false` = feriado/dia não útil. */
  isWorking: boolean;
  /** Turno especial no formato "HH:MM" (opcional). */
  startTime?: string | null;
  endTime?: string | null;
  /** Nome exibido (ex.: "Feriado", "Compensação"). */
  name?: string | null;
}

export interface Calendar {
  id: string;
  name: string;
  /** Bits seg..dom (bit 0 = segunda-feira). Padrão: seg–sex. */
  weeklyMask: number;
  /** Início do turno no formato "HH:MM". */
  workingHoursStart: string;
  /** Fim do turno no formato "HH:MM". */
  workingHoursEnd: string;
  exceptions: CalendarException[];
}

export const WEEKDAY_MASK_DEFAULT = 0b00011111; // seg..sex (bit 0 = segunda)

/** Exceções por dia (índice: dia UTC-naive). */
function exceptionMap(cal: Calendar): Map<number, CalendarException> {
  const map = new Map<number, CalendarException>();
  for (const exception of cal.exceptions) map.set(startOfDay(exception.date), exception);
  return map;
}

export function startOfDay(value: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseTime(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * HOUR_MS + Number(minutes) * MINUTE_MS;
}

function dayOfWeek(value: number): number {
  return new Date(startOfDay(value)).getUTCDay(); // 0 = domingo
}

/** É dia de trabalho (considerando máscara semanal e exceções)? */
export function isWorkingDay(cal: Calendar, value: number): boolean {
  const day = startOfDay(value);
  const exception = exceptionMap(cal).get(day);
  if (exception) return exception.isWorking;

  const weekday = dayOfWeek(day);
  const bit = weekday === 0 ? 6 : weekday - 1; // seg = bit 0
  return (cal.weeklyMask & (1 << bit)) !== 0;
}

/** Jornada do dia (em ms desde a meia-noite) ou `null` se não for útil. */
export function workingWindow(
  cal: Calendar,
  value: number,
): { start: number; end: number } | null {
  const day = startOfDay(value);
  if (!isWorkingDay(cal, day)) return null;

  const exception = exceptionMap(cal).get(day);
  const start = parseTime(exception?.startTime ?? cal.workingHoursStart);
  const end = parseTime(exception?.endTime ?? cal.workingHoursEnd);
  if (end <= start) return null;

  return { start: day + start, end: day + end };
}

/** O instante é tempo útil? */
export function isWorkingTime(cal: Calendar, value: number): boolean {
  const window = workingWindow(cal, value);
  if (!window) return false;
  return value >= window.start && value < window.end;
}

/** Início do próximo minuto útil (inclusive o próprio instante). */
export function nextWorkingMoment(cal: Calendar, value: number): number {
  let cursor = value;

  for (let guard = 0; guard < 4_000; guard += 1) {
    const window = workingWindow(cal, cursor);
    if (!window) {
      cursor = startOfDay(cursor) + DAY_MS;
      continue;
    }
    if (cursor < window.start) return window.start;
    if (cursor < window.end) return cursor;

    cursor = startOfDay(cursor) + DAY_MS;
  }

  return value;
}

/**
 * Soma `duration` ms de tempo útil a partir de `value`.
 * Se `value` não é útil, começa no próximo momento útil.
 */
export function addWorkingTime(cal: Calendar, value: number, duration: number): number {
  if (duration <= 0) return nextWorkingMoment(cal, value);

  let cursor = nextWorkingMoment(cal, value);
  let remaining = duration;

  for (let guard = 0; guard < 20_000; guard += 1) {
    const window = workingWindow(cal, cursor);
    if (!window) {
      cursor = startOfDay(cursor) + DAY_MS;
      continue;
    }

    if (cursor < window.start) cursor = window.start;

    const available = window.end - cursor;
    if (available >= remaining) return cursor + remaining;

    remaining -= available;
    cursor = startOfDay(cursor) + DAY_MS;
  }

  return cursor;
}

/** Janela de trabalho do último dia útil anterior a `beforeDay`. */
function previousWorkingWindow(
  cal: Calendar,
  beforeDay: number,
): { start: number; end: number } | null {
  let day = startOfDay(beforeDay);
  for (let guard = 0; guard < 4_000; guard += 1) {
    const window = workingWindow(cal, day);
    if (window) return window;
    day -= DAY_MS;
  }
  return null;
}

/** Subtrai `duration` ms de tempo útil a partir de `value` (para trás). */
export function subtractWorkingTime(cal: Calendar, value: number, duration: number): number {
  if (duration <= 0) return value;

  let cursor = value;
  let remaining = duration;

  for (let guard = 0; guard < 20_000; guard += 1) {
    const day = startOfDay(cursor);
    const window = workingWindow(cal, day);

    if (!window || cursor <= window.start) {
      const previous = previousWorkingWindow(cal, day - DAY_MS);
      if (!previous) return cursor;
      cursor = previous.end;
      continue;
    }

    const available = cursor - window.start;
    if (available >= remaining) return cursor - remaining;

    remaining -= available;
    const previous = previousWorkingWindow(cal, day - DAY_MS);
    if (!previous) return window.start;
    cursor = previous.end;
  }

  return cursor;
}

/** Tempo útil (ms) entre dois instantes. */
export function durationBetween(cal: Calendar, from: number, to: number): number {
  if (to <= from) return 0;

  let total = 0;
  let cursor = nextWorkingMoment(cal, from);

  for (let guard = 0; guard < 20_000 && cursor < to; guard += 1) {
    const window = workingWindow(cal, cursor);
    if (!window) {
      cursor = startOfDay(cursor) + DAY_MS;
      continue;
    }

    const fromSegment = Math.max(cursor, window.start);
    const segmentEnd = Math.min(window.end, to);
    if (segmentEnd > fromSegment) total += segmentEnd - fromSegment;
    cursor = startOfDay(cursor) + DAY_MS;
  }

  return total;
}

/** Dias úteis (data inicial e final inclusas) entre dois instantes. */
export function workingDaysBetween(cal: Calendar, from: number, to: number): number {
  if (to < from) return 0;

  let count = 0;
  let day = startOfDay(from);
  const last = startOfDay(to);

  while (day <= last) {
    if (isWorkingDay(cal, day)) count += 1;
    day += DAY_MS;
  }

  return count;
}

/** Calendário padrão: seg–sex, 09:00–18:00, sem exceções. */
export function defaultCalendar(id = "default", name = "Calendário padrão"): Calendar {
  return {
    id,
    name,
    weeklyMask: WEEKDAY_MASK_DEFAULT,
    workingHoursStart: "09:00",
    workingHoursEnd: "18:00",
    exceptions: [],
  };
}
