/**
 * Data de status e atualização em lote (specs/tracking — "Data de status" e
 * "Atualização em lote").
 *
 * Convenção inclusive: `finish` é a meia-noite do último dia trabalhado, e
 * o limite do período de progresso é `finish + 1 dia`.
 *
 * Funções puras — sem I/O, sem DOM.
 */

import { DAY_MS, durationBetween, workingDaysBetween, type Calendar } from "../calendar/calendar";

export interface StatusTaskInput {
  start: number | null;
  finish: number | null;
  percentComplete: number;
  /** Data de término real, quando registrada. */
  actualFinish?: number | null;
}

export interface DelayClassification {
  /** O plano terminou antes da data de status e a tarefa não concluiu. */
  delayed: boolean;
  /** Dias úteis entre o fim planejado e a data de status. */
  deviationDays: number;
}

/**
 * Classifica a tarefa contra a data de status e calcula o desvio em dias
 * úteis (specs/tracking — "Data de status": o cenário "Atraso em relação à
 * data de status").
 */
export function classifyDelay(
  task: StatusTaskInput,
  statusDate: number,
  calendar: Calendar,
): DelayClassification {
  if (task.start === null || task.finish === null) return { delayed: false, deviationDays: 0 };

  const finished = (task.percentComplete ?? 0) >= 100 || task.actualFinish != null;
  if (finished) return { delayed: false, deviationDays: 0 };
  if (!(task.finish < statusDate)) return { delayed: false, deviationDays: 0 };

  const deviationDays = workingDaysBetween(calendar, task.finish + DAY_MS, statusDate);
  return { delayed: true, deviationDays };
}

/**
 * Progresso proporcional à data de status, em porcentagem (0–100, duas
 * casas). Devolve `null` quando não se aplica: sem datas, ainda não iniciada
 * ou já concluída.
 */
export function progressAt(
  task: StatusTaskInput,
  statusDate: number,
  calendar: Calendar,
): number | null {
  if (task.start === null || task.finish === null) return null;
  if (task.start > statusDate) return null;
  if (task.start === task.finish) return 100; // marco já alcançado na data
  if ((task.percentComplete ?? 0) >= 100) return null;

  const total = durationBetween(calendar, task.start, task.finish + DAY_MS);
  if (total <= 0) return statusDate >= task.finish ? 100 : 0;

  // o dia da data de status conta no período transcorrido
  const boundary = Math.min(statusDate + DAY_MS, task.finish + DAY_MS);
  const elapsed = durationBetween(calendar, task.start, boundary);
  const percent = (elapsed / total) * 100;
  return Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
}
