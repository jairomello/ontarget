/**
 * Expansão de recorrências (docs/architecture.md §8.3, etapa 1).
 *
 * Formato do campo `recurrence` (JSON):
 * ```json
 * { "frequency": "weekly", "interval": 2, "count": 6 }
 * { "frequency": "daily", "interval": 1, "endDate": 1798761600000 }
 * ```
 * `count` = número total de ocorrências (inclui a primeira) ou `endDate` =
 * última data permitida para o início das ocorrências.
 *
 * A primeira ocorrência é a própria tarefa (mantém id e vínculos); as
 * demais recebem `id#N`, são fixas na data deslocada e são deslocadas para
 * o próximo dia útil conforme o calendário ativo
 * (specs/scheduling — "Tarefas recorrentes").
 */
import { DAY_MS, isWorkingDay, type Calendar } from "../calendar/calendar";
import type { ScheduleTaskInput } from "./types";

export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly";
  /** A cada N unidades (dia/semana/mês). */
  interval: number;
  /** Total de ocorrências, incluindo a primeira. */
  count?: number;
  /** Limite (inclusivo) para o início das ocorrências. */
  endDate?: number;
}

export function parseRecurrence(raw: string | null | undefined): RecurrenceRule | null {
  if (!raw) return null;

  let parsed: Partial<RecurrenceRule>;
  try {
    parsed = JSON.parse(raw) as Partial<RecurrenceRule>;
  } catch {
    return null;
  }

  if (parsed.frequency !== "daily" && parsed.frequency !== "weekly" && parsed.frequency !== "monthly") {
    return null;
  }

  const interval =
    typeof parsed.interval === "number" && parsed.interval >= 1
      ? Math.floor(parsed.interval)
      : 1;
  const count =
    typeof parsed.count === "number" && parsed.count >= 1 ? Math.floor(parsed.count) : undefined;
  const endDate = typeof parsed.endDate === "number" ? parsed.endDate : undefined;

  // Sem fim definido a recorrência seria infinita: ignora.
  if (count === undefined && endDate === undefined) return null;

  return { frequency: parsed.frequency, interval, count, endDate };
}

/** Desloca `value` por `steps` unidades do calendário (dia/semana/mês). */
function shift(value: number, rule: RecurrenceRule, steps: number): number {
  const amount = steps * rule.interval;

  if (rule.frequency === "daily") return value + amount * DAY_MS;
  if (rule.frequency === "weekly") return value + amount * 7 * DAY_MS;

  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, date.getUTCDate());
}

/** Primeiro dia útil em ou após `value` (desloca feriados e fins de semana). */
function nextWorkingDay(value: number, calendar: Calendar): number {
  let day = value;
  let guard = 0;
  while (!isWorkingDay(calendar, day) && guard < 4_000) {
    day += DAY_MS;
    guard += 1;
  }
  return day;
}

/**
 * Expande tarefas recorrentes em ocorrências. Tarefas inativas, resumos ou
 * sem data de início não são expandidas.
 */
export function expandRecurrences(
  tasks: readonly ScheduleTaskInput[],
  calendar: Calendar,
): ScheduleTaskInput[] {
  const out: ScheduleTaskInput[] = [];

  for (const task of tasks) {
    out.push(task);

    const rule = parseRecurrence(task.recurrence);
    const base = task.start ?? task.manualStart;
    if (!rule || base === null || task.isInactive || task.isSummary) continue;

    const span = task.finish !== null && task.start !== null ? task.finish - task.start : 0;
    const limit = rule.count ?? Number.POSITIVE_INFINITY;

    for (let step = 1; step < limit; step += 1) {
      const start = nextWorkingDay(shift(base, rule, step), calendar);
      if (rule.endDate !== undefined && start > rule.endDate) break;
      if (step > 4_000) break;

      out.push({
        ...task,
        id: `${task.id}#${step + 1}`,
        isSummary: false,
        recurrence: null,
        // Ocorrência fixa na data deslocada (a primeira é a tarefa original).
        schedulingMode: "manual",
        manualStart: start,
        manualFinish: start + span,
        start,
        finish: start + span,
      });
    }
  }

  return out;
}
