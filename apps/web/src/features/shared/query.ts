import {
  combineFlags,
  classifyDelay,
  flattenGroups,
  groupTasks,
  matchesCondition,
  parseDate,
  parseDuration,
  parsePercent,
  sortOrder,
  startOfDay,
  visibleRows,
  type FieldValues,
  type FilterCondition,
  type FilterPreset,
  type VisibleRow,
} from "@ontarget/core";
import { useMemo } from "react";
import { useComputedStore } from "../../store/computedStore";
import {
  selectActiveCalendar,
  selectWbsMask,
  toCoreCalendar,
  useDomainStore,
} from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import type { Task } from "../../store/types";
import { assignmentNamesText } from "./assignments";
import { fieldRawValueFor, wbsCodeText } from "./fields";

/**
 * Linhas da visão — fonte única da Task Sheet e do Gantt
 * (specs/views-and-filters — "Estado de agrupamento e filtros no Gantt"):
 * aplica filtro (presets + condições, E/OU), ordenação múltipla e
 * agrupamento com cabeçalhos sintéticos, e devolve as `VisibleRow` finais.
 */

/* --------------------------------------------------------------- valores */

/** Resolve todos os campos filtráveis/ordenáveis de uma tarefa. */
export function taskFieldValues(task: Task): FieldValues {
  const values: FieldValues = {
    name: task.name,
    wbs: wbsCodeText(task),
    start: task.start,
    finish: task.finish,
    duration: task.duration,
    percent: task.percentComplete,
    work: task.work,
    cost: task.cost,
    res: assignmentNamesText(task.id),
  };

  const state = useDomainStore.getState();
  for (const field of Object.values(state.customFields)) {
    if (field.entityType !== "task") continue;
    values[`cf:${field.id}`] = fieldRawValueFor(field.id, task);
  }
  return values;
}

/**
 * Converte o valor digitado para a unidade bruta do campo (datas em epoch,
 * duração em ms, percentual em número) — a comparação do core é numérica.
 */
function normalizeCondition(condition: FilterCondition): FilterCondition {
  const raw = condition.value ?? "";
  if (raw === "") return condition;

  if (condition.field === "start" || condition.field === "finish") {
    const date = parseDate(raw);
    return date === null ? condition : { ...condition, value: String(date) };
  }
  if (condition.field === "duration") {
    const parsed = parseDuration(raw);
    return parsed === null ? condition : { ...condition, value: String(parsed.ms) };
  }
  if (condition.field === "percent") {
    const parsed = parsePercent(raw);
    return parsed === null ? condition : { ...condition, value: String(parsed) };
  }
  return condition;
}

/* --------------------------------------------------------------- presets */

interface PresetContext {
  todayStart: number;
  criticalSet: Set<string>;
  statusDate: number | null;
  calendar: ReturnType<typeof toCoreCalendar>;
  assignedSet: Set<string>;
}

/** Filtros prontos (specs/views-and-filters — "Filtros"). */
function matchesPreset(preset: FilterPreset, task: Task, ctx: PresetContext): boolean {
  switch (preset) {
    case "late":
      // em atraso: prazo estourado (fim passou) e ainda não concluída
      return (
        task.finish !== null &&
        task.finish < ctx.todayStart &&
        (task.percentComplete ?? 0) < 100
      );
    case "critical":
      return ctx.criticalSet.has(task.id);
    case "delayed":
      return (
        ctx.statusDate !== null &&
        ctx.calendar !== null &&
        classifyDelay(task, ctx.statusDate, ctx.calendar).delayed
      );
    case "noResource":
      return !ctx.assignedSet.has(task.id);
    case "milestone":
      return task.isMilestone;
    case "manual":
      return task.schedulingMode === "manual";
    default:
      return true;
  }
}

/* ------------------------------------------------------------------ hook */

/**
 * Calcula as linhas visíveis aplicando a consulta da visão. É a mesma
 * função chamada pela grade e pelo Gantt — as duas superfícies não podem
 * divergir por construção.
 */
export function useQueryRows(): VisibleRow[] {
  const order = useDomainStore((state) => state.taskOrder);
  const tasks = useDomainStore((state) => state.tasks);
  const assignments = useDomainStore((state) => state.assignments);
  const statusDate = useDomainStore((state) => state.statusDate);
  const calendars = useDomainStore((state) => state.calendars);
  const exceptions = useDomainStore((state) => state.calendarExceptions);
  const active = useDomainStore(selectActiveCalendar);
  const criticalPath = useComputedStore((state) => state.schedule?.criticalPath);
  const collapsed = useUiStore((state) => state.collapsed);
  const query = useUiStore((state) => state.query);
  const sorts = useUiStore((state) => state.sorts);
  const groupFields = useUiStore((state) => state.groupFields);

  const criticalSet = useMemo(() => new Set(criticalPath ?? []), [criticalPath]);

  return useMemo(() => {
    const state = useDomainStore.getState();
    const calendar = active ? toCoreCalendar(state, active.id) : null;

    const ctx: PresetContext = {
      todayStart: startOfDay(Date.now()),
      criticalSet,
      statusDate,
      calendar,
      assignedSet: new Set(
        Object.values(assignments).map((assignment) => assignment.taskId),
      ),
    };

    // valores por tarefa (uma resolução para filtro, ordenação e agrupamento)
    const values: Record<string, FieldValues> = {};
    for (const id of order) {
      const task = tasks[id];
      if (task) values[id] = taskFieldValues(task);
    }

    // --- filtro (presets + condições, pelo combinador) -----------------------
    const conditions = query.conditions.map(normalizeCondition);
    const visibleIds = order.filter((id) => {
      const task = tasks[id];
      if (!task) return false;
      const flags: boolean[] = [];
      for (const preset of query.presets) flags.push(matchesPreset(preset, task, ctx));
      for (const condition of conditions) {
        flags.push(matchesCondition(condition, values[id] ?? {}));
      }
      return combineFlags(flags, query.combinator);
    });

    // --- ordenação (irmãos reordenados; resumo com as subtarefas) -----------
    const parents: Record<string, string | null> = {};
    const summaries: Record<string, boolean> = {};
    for (const id of visibleIds) {
      const task = tasks[id];
      if (!task) continue;
      parents[id] = task.parentId;
      summaries[id] = task.isSummary;
    }

    const sorted = sortOrder(visibleIds, values, sorts, true, parents);
    const rows = visibleRows({ order: sorted, parents, summaries, collapsed });

    // --- agrupamento (cabeçalhos sintéticos com contagem e sumário) ---------
    if (groupFields.length === 0) return rows;

    const byId = new Map(rows.map((row) => [row.id, row]));
    const flat = flattenGroups(groupTasks(sorted, groupFields, values));
    const grouped: VisibleRow[] = [];
    flat.forEach((entry, index) => {
      if (entry.kind === "header") {
        grouped.push({
          id: `__group__${index}`,
          depth: 0,
          isSummary: false,
          collapsed: false,
          hidden: 0,
          isGroup: true,
          groupLabel: entry.group.label,
          groupDepth: entry.group.depth,
          groupCount: entry.group.summary.count,
          groupSummary: entry.group.summary,
        });
      } else {
        const row = byId.get(entry.id);
        if (row) grouped.push({ ...row, depth: entry.depth });
      }
    });
    return grouped;
  }, [
    order,
    tasks,
    assignments,
    statusDate,
    calendars,
    exceptions,
    active,
    criticalSet,
    collapsed,
    query,
    sorts,
    groupFields,
  ]);
}
