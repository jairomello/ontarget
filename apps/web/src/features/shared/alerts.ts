import { classifyDelay } from "@ontarget/core";
import { useMemo } from "react";
import { useComputedStore } from "../../store/computedStore";
import { selectActiveCalendar, toCoreCalendar, useDomainStore } from "../../store/domainStore";
import { useOverallocation } from "./overallocation";

/**
 * Alertas de desempenho (specs/tracking — "Alertas de desempenho"): tarefas
 * atrasadas, com prazo excedido, com restrição conflitante, superalocadas e
 * com vínculo inválido — fonte única do painel e do contador no shell.
 */

export type AlertKind =
  | "delayed"
  | "deadline"
  | "constraint"
  | "overallocated"
  | "cycle";

export const ALERT_LABELS: Record<AlertKind, string> = {
  delayed: "Atraso",
  deadline: "Prazo excedido",
  constraint: "Restrição conflitante",
  overallocated: "Superalocação",
  cycle: "Vínculo inválido",
};

export interface Alert {
  taskId: string;
  kind: AlertKind;
  message: string;
}

export function useAlerts(): Alert[] {
  const tasks = useDomainStore((state) => state.tasks);
  const taskOrder = useDomainStore((state) => state.taskOrder);
  const statusDate = useDomainStore((state) => state.statusDate);
  const calendars = useDomainStore((state) => state.calendars);
  const exceptions = useDomainStore((state) => state.calendarExceptions);
  const active = useDomainStore(selectActiveCalendar);
  const schedule = useComputedStore((state) => state.schedule);
  const overallocation = useOverallocation();

  return useMemo(() => {
    const state = useDomainStore.getState();
    const calendar = active ? toCoreCalendar(state, active.id) : null;
    const out: Alert[] = [];
    if (!calendar) return out;

    // atrasadas (specs/tracking — "Data de status")
    if (statusDate !== null) {
      for (const id of taskOrder) {
        const task = tasks[id];
        if (!task || task.isInactive) continue;
        const delay = classifyDelay(task, statusDate, calendar);
        if (delay.delayed) {
          out.push({ taskId: id, kind: "delayed", message: `${delay.deviationDays}d de atraso` });
        }
      }
    }

    // prazos excedidos, restrições conflitantes e vínculos inválidos (motor)
    for (const conflict of schedule?.conflicts ?? []) {
      const kind: AlertKind =
        conflict.kind === "deadline"
          ? "deadline"
          : conflict.kind === "constraint"
            ? "constraint"
            : "cycle";
      out.push({ taskId: conflict.taskId, kind, message: conflict.message });
    }

    // superalocadas — maior razão por tarefa
    const ratios = new Map<string, number>();
    for (const day of overallocation?.days ?? []) {
      for (const taskId of day.taskIds) {
        const current = ratios.get(taskId) ?? 0;
        if (day.ratio > current) ratios.set(taskId, day.ratio);
      }
    }
    for (const [taskId, ratio] of ratios) {
      out.push({
        taskId,
        kind: "overallocated",
        message: `Demanda de ${ratio.toFixed(1).replace(".", ",")}× a capacidade`,
      });
    }

    // ordena pela ordem da grade
    const position = new Map(taskOrder.map((id, index) => [id, index]));
    return out.sort((a, b) => (position.get(a.taskId) ?? 0) - (position.get(b.taskId) ?? 0));
  }, [tasks, taskOrder, statusDate, calendars, exceptions, active, schedule, overallocation]);
}
