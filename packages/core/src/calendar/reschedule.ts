/**
 * Propagação de mudanças de calendário (specs/calendars — "Propagação de
 * mudanças de calendário").
 *
 * Quando um calendário é alterado (feriado, máscara semanal, turno), as
 * tarefas afetadas são reagendadas preservando a duração útil de cada uma.
 * Tarefas manuais são imunes ao calendário e inativas ficam fora do cálculo
 * (specs/scheduling). Função pura — sem I/O, sem DOM.
 *
 * Convenção: `finish` é inclusive (meia-noite do último dia trabalhado).
 */

import {
  addWorkingTime,
  DAY_MS,
  durationBetween,
  isWorkingDay,
  startOfDay,
  type Calendar,
} from "./calendar";

export interface RescheduleTask {
  id: string;
  start: number | null;
  finish: number | null;
  schedulingMode?: string | null;
  isInactive?: boolean | null;
  isMilestone?: boolean | null;
}

export interface RescheduleUpdate {
  id: string;
  start: number;
  finish: number;
}

/**
 * Recalcula as datas das tarefas afetadas por uma mudança de calendário.
 *
 * A duração útil medida no calendário anterior é preservada no novo; o
 * início só avança quando o dia em que ele caía deixou de ser útil. Com o
 * término em meia-noite (inclusive), o novo término é arredondado para o
 * último dia trabalhado.
 */
export function rescheduleForCalendarChange(
  tasks: readonly RescheduleTask[],
  before: Calendar,
  after: Calendar,
): RescheduleUpdate[] {
  const updates: RescheduleUpdate[] = [];

  for (const task of tasks) {
    // Tarefas manuais são imunes ao calendário (specs/scheduling).
    if (task.schedulingMode === "manual") continue;
    // Inativas ficam fora do cálculo de datas (specs/scheduling).
    if (task.isInactive) continue;

    const { start, finish } = task;
    if (start === null || finish === null || finish < start) continue;

    // Marcos têm duração zero; as demais incluem o último dia (inclusive).
    const workBefore = task.isMilestone
      ? 0
      : durationBetween(before, start, finish + DAY_MS);
    const workAfter = task.isMilestone ? 0 : durationBetween(after, start, finish + DAY_MS);

    // Início que deixou de ser dia útil avança para o próximo dia útil.
    let newStart = start;
    if (!isWorkingDay(after, start) && isWorkingDay(before, start)) {
      let day = start;
      let guard = 0;
      while (!isWorkingDay(after, day) && guard < 4_000) {
        day += DAY_MS;
        guard += 1;
      }
      newStart = day;
    }

    if (workBefore === workAfter && newStart === start) continue;

    if (task.isMilestone) {
      if (newStart !== start) updates.push({ id: task.id, start: newStart, finish: newStart });
      continue;
    }

    // As demais preservam a duração útil; o término fica no último dia útil.
    let newFinish = startOfDay(addWorkingTime(after, newStart, workBefore));
    if (finish % DAY_MS !== 0) {
      // término não alinhado a dia (dado bruto preservado)
      newFinish = addWorkingTime(after, newStart, workBefore);
    }
    if (newFinish < newStart) newFinish = newStart;

    if (newStart !== start || newFinish !== finish) {
      updates.push({ id: task.id, start: newStart, finish: newFinish });
    }
  }

  return updates;
}
