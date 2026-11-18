/**
 * Detecção de superalocação (specs/resources — "Detecção de superalocação").
 *
 * Para cada pessoa, varre dia a dia o período do projeto e compara a demanda
 * (soma das unidades das atribuições cujas tarefas ocupam o dia) com a
 * capacidade máxima. Tarefas inativas ficam de fora do cálculo
 * (specs/scheduling — "Tarefas inativas fora do cálculo"; verificação
 * adiada da tarefa 6.5 e coberta aqui). A capacidade respeita o calendário
 * da pessoa, quando houver, e o do projeto como base.
 *
 * Função pura — sem I/O, sem DOM.
 */

import { DAY_MS, isWorkingDay, startOfDay, type Calendar } from "../calendar/calendar";

export interface AllocationTaskInput {
  id: string;
  start: number | null;
  finish: number | null;
  isInactive?: boolean | null;
}

export interface AllocationAssignmentInput {
  id: string;
  taskId: string;
  resourceId: string;
  units: number;
}

export interface AllocationResourceInput {
  id: string;
  maxUnits: number;
  /** Calendário próprio da pessoa; ausente usa o do projeto. */
  calendar?: Calendar;
}

export interface OverallocationDay {
  resourceId: string;
  /** Dia (meia-noite UTC-naive) com demanda acima da capacidade. */
  date: number;
  /** Soma das unidades demandadas no dia. */
  demand: number;
  /** Unidades máximas da pessoa. */
  capacity: number;
  /** demanda ÷ capacidade (ex.: 2 = 200%). */
  ratio: number;
  /** Tarefas ativas que geram a demanda do dia. */
  taskIds: string[];
}

export interface OverallocationInput {
  tasks: readonly AllocationTaskInput[];
  assignments: readonly AllocationAssignmentInput[];
  resources: readonly AllocationResourceInput[];
  /** Início da janela a verificar (dia UTC-naive). */
  from: number;
  /** Fim da janela (dia UTC-naive, inclusivo). */
  to: number;
  /** Calendário do projeto (base de dias úteis). */
  calendar: Calendar;
}

export function detectOverallocation(input: OverallocationInput): OverallocationDay[] {
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const byResource = new Map<string, AllocationAssignmentInput[]>();
  for (const assignment of input.assignments) {
    const list = byResource.get(assignment.resourceId);
    if (list) list.push(assignment);
    else byResource.set(assignment.resourceId, [assignment]);
  }

  const first = startOfDay(input.from);
  const last = startOfDay(input.to);
  const out: OverallocationDay[] = [];

  for (const resource of input.resources) {
    const capacity = resource.maxUnits;
    if (!(capacity > 0)) continue;

    // tarefas válidas da pessoa (ativas e com datas) — inativas ficam fora
    const spans: Array<{ units: number; taskId: string; from: number; to: number }> = [];
    for (const assignment of byResource.get(resource.id) ?? []) {
      const task = taskById.get(assignment.taskId);
      if (!task || task.isInactive) continue;
      if (task.start === null || task.finish === null) continue;
      const from = startOfDay(task.start);
      const to = startOfDay(task.finish);
      if (to < from) continue;
      spans.push({ units: assignment.units, taskId: task.id, from, to });
    }
    if (spans.length === 0) continue;

    const calendar = resource.calendar ?? input.calendar;
    for (let day = first; day <= last; day += DAY_MS) {
      if (!isWorkingDay(calendar, day)) continue;

      let demand = 0;
      const taskIds: string[] = [];
      for (const span of spans) {
        if (day < span.from || day > span.to) continue;
        demand += span.units;
        if (!taskIds.includes(span.taskId)) taskIds.push(span.taskId);
      }

      if (demand > capacity + 1e-9) {
        out.push({
          resourceId: resource.id,
          date: day,
          demand,
          capacity,
          ratio: demand / capacity,
          taskIds,
        });
      }
    }
  }

  return out;
}
