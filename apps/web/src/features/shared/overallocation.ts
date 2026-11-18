import { useMemo } from "react";
import { detectOverallocation, type OverallocationDay } from "@ontarget/core";
import {
  selectActiveCalendar,
  toCoreCalendar,
  useDomainStore,
} from "../../store/domainStore";

/**
 * Superalocação compartilhada pelo painel de equipe e pelo Gantt
 * (specs/resources — "Detecção de superalocação"): uma única fonte para que
 * as duas superfícies marrem exatamente os mesmos períodos.
 */

export interface OverallocationInfo {
  days: OverallocationDay[];
  /** Tarefas com pelo menos um dia superalocado. */
  byTask: Set<string>;
  /** Período avaliado (janela do projeto). */
  from: number;
  to: number;
}

export function computeOverallocation(
  state: ReturnType<typeof useDomainStore.getState>,
): OverallocationInfo | null {
  const active = selectActiveCalendar(state);
  const calendar = active ? toCoreCalendar(state, active.id) : null;
  if (!calendar) return null;

  const tasks = Object.values(state.tasks);
  const dated = tasks.filter((task) => task.start !== null && task.finish !== null);
  if (dated.length === 0) return null;

  const from = Math.min(...dated.map((task) => task.start as number));
  const to = Math.max(...dated.map((task) => task.finish as number));

  const resources = Object.values(state.resources)
    .filter((resource) => resource.active)
    .map((resource) => ({
      id: resource.id,
      maxUnits: resource.maxUnits,
      calendar: resource.calendarId
        ? (toCoreCalendar(state, resource.calendarId) ?? undefined)
        : undefined,
    }));

  const days = detectOverallocation({
    tasks: tasks.map((task) => ({
      id: task.id,
      start: task.start,
      finish: task.finish,
      isInactive: task.isInactive,
    })),
    assignments: Object.values(state.assignments),
    resources,
    from,
    to,
    calendar,
  });

  const byTask = new Set<string>();
  for (const day of days) {
    for (const id of day.taskIds) byTask.add(id);
  }

  return { days, byTask, from, to };
}

/** Assina o domínio e memoiza o cálculo da superalocação. */
export function useOverallocation(): OverallocationInfo | null {
  const tasks = useDomainStore((state) => state.tasks);
  const assignments = useDomainStore((state) => state.assignments);
  const resources = useDomainStore((state) => state.resources);
  const calendars = useDomainStore((state) => state.calendars);
  const exceptions = useDomainStore((state) => state.calendarExceptions);
  const active = useDomainStore(selectActiveCalendar);

  return useMemo(() => computeOverallocation(useDomainStore.getState()), [
    tasks,
    assignments,
    resources,
    calendars,
    exceptions,
    active,
  ]);
}
