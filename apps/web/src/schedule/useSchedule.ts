import { useEffect } from "react";
import type { Calendar } from "@ontarget/core";
import { useComputedStore } from "../store/computedStore";
import { selectActiveCalendar, toCoreCalendar, useDomainStore } from "../store/domainStore";
import { ScheduleClient, type ScheduleInput } from "./scheduleClient";

/** Debounce do disparo: agrupa edições rápidas em um único snapshot. */
const DEBOUNCE_MS = 100;

/** Snapshot puro do domínio para o motor (tasks + links + calendários). */
function snapshotOf(state: ReturnType<typeof useDomainStore.getState>): ScheduleInput | null {
  const active = selectActiveCalendar(state);
  const calendar = active ? toCoreCalendar(state, active.id) : null;
  if (!calendar) return null;

  // Calendários próprios (tarefa → calendário distinto do projeto).
  const calendars: Record<string, Calendar> = {};
  for (const entry of Object.values(state.calendars)) {
    const core = toCoreCalendar(state, entry.id);
    if (core) calendars[entry.id] = core;
  }

  const units: Record<string, number> = {};
  for (const assignment of Object.values(state.assignments)) {
    units[assignment.taskId] = (units[assignment.taskId] ?? 0) + assignment.units;
  }

  let projectStart: number | undefined;
  for (const id of state.taskOrder) {
    const task = state.tasks[id];
    if (!task) continue;
    const value = task.start ?? task.manualStart;
    if (value !== null && value !== undefined && (projectStart === undefined || value < projectStart)) {
      projectStart = value;
    }
  }

  return {
    tasks: Object.values(state.tasks),
    links: Object.values(state.taskLinks),
    calendar,
    calendars,
    units,
    projectStart,
  };
}

/**
 * Executa o agendamento em Web Worker a cada mudança de domínio e publica
 * o resultado no `computedStore` (specs/scheduling — "Recálculo incremental
 * e desempenho"). O worker mantém o snapshot anterior e recalcula apenas a
 * cadeia afetada.
 */
export function useSchedule(projectId: string | undefined): void {
  useEffect(() => {
    if (!projectId) return;

    const client = new ScheduleClient();
    const off = client.onChange(({ result, ms }) => {
      useComputedStore.getState().setSchedule(result, { at: Date.now(), ms });

      // Datas calculadas voltam para o domínio como cache persistido (sem
      // passo de desfazer): a grade, o Gantt e o portfólio enxergam o
      // resultado e o próximo recálculo parte do estado atual.
      const updates: Array<{ id: string; start: number; finish: number }> = [];
      for (const [id, scheduled] of Object.entries(result.tasks)) {
        if (scheduled.excluded !== undefined) continue;
        if (scheduled.start === null || scheduled.finish === null) continue;
        updates.push({ id, start: scheduled.start, finish: scheduled.finish });
      }
      if (updates.length > 0) useDomainStore.getState().applyScheduleDates(updates);
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = () => {
      const input = snapshotOf(useDomainStore.getState());
      if (input) client.request(input);
    };

    const unsubscribe = useDomainStore.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        send();
      }, DEBOUNCE_MS);
    });

    send();

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      off();
      client.dispose();
      useComputedStore.getState().clear();
    };
  }, [projectId]);
}
