import { applyPatches, enablePatches, produce, produceWithPatches, type Draft } from "immer";
import { create } from "zustand";
import {
  assignmentCost,
  assignmentWork,
  indent,
  outdent,
  defaultCalendar,
  moveWithinLevel,
  progressAt,
  rescheduleForCalendarChange,
  renumber,
  startOfDay,
  validateLink,
  WEEKDAY_MASK_DEFAULT,
  type Calendar as CoreCalendar,
  type LinkRejection,
  type WbsErrorCode,
  type WbsNode,
  type WbsResult,
} from "@ontarget/core";
import { newId } from "@ontarget/shared";
import { emitDirty } from "./dirty";
import { useHistoryStore } from "./historyStore";
import type {
  Assignment,
  Baseline,
  BaselineValue,
  Calendar,
  CalendarException,
  CustomField,
  CustomFieldValue,
  Id,
  LibraryItem,
  ProjectData,
  Resource,
  Task,
  TaskLink,
  Team,
} from "./types";
import { keyOf } from "../lib/syncQueue";

// Habilita os plugins de patch usados pelo undo/redo.
enablePatches();

/** Resultado da tentativa de criação de um vínculo (motivo da recusa). */
export interface LinkAddResult {
  ok: boolean;
  reason?: LinkRejection;
  message?: string;
  /** Caminho que formaria o ciclo (ids), do sucessor até o predecessor. */
  path?: string[];
}

/**
 * Estado de domínio: a única fonte de verdade do que o usuário edita.
 * Toda mutação passa por `commit`, que grava patches e inversos no
 * histórico — assim uma operação estrutural em várias tarefas é um único
 * passo de desfazer (specs/editing-history).
 */
export interface DomainState {
  projectId: Id | null;
  tasks: Record<Id, Task>;
  /** Ordem de exibição (pré-ordem da árvore WBS). */
  taskOrder: Id[];
  taskLinks: Record<Id, TaskLink>;
  resources: Record<Id, Resource>;
  assignments: Record<Id, Assignment>;
  calendars: Record<Id, Calendar>;
  calendarExceptions: Record<Id, CalendarException>;
  /** Equipes (globais ao projeto). */
  teams: Record<Id, Team>;
  /** Fatia do projeto: data de status (specs/tracking). */
  statusDate: number | null;
  statusAuto: boolean;
  baselines: Record<Id, Baseline>;
  /** baselineId → taskId → valores capturados. */
  baselineValues: Record<Id, Record<Id, BaselineValue>>;
  customFields: Record<Id, CustomField>;
  /** fieldId → entityId → valor gravado (fórmulas não guardam: calculam). */
  customFieldValues: Record<Id, Record<Id, CustomFieldValue>>;
  /** Biblioteca do projeto (máscara WBS, visões…; specs/views-and-filters). */
  libraryItems: Record<Id, LibraryItem>;

  load: (
    projectId: Id,
    data: ProjectData,
    project?: { statusDate: number | null; statusAuto: boolean },
  ) => void;
  /** Atualiza a fatia do projeto (persistida por PATCH, sem undo). */
  setProjectStatus: (patch: { statusDate?: number | null; statusAuto?: boolean }) => void;
  reset: () => void;
  undo: () => boolean;
  redo: () => boolean;

  updateTask: (id: Id, patch: Partial<Task>) => void;
  addTask: (task: Task, index?: number) => void;
  removeTask: (id: Id) => void;
  addLink: (link: TaskLink) => LinkAddResult;
  updateLink: (id: Id, patch: Partial<TaskLink>) => void;
  removeLink: (id: Id) => void;

  /** Altera dias úteis/turno e reagenda as tarefas afetadas. */
  updateCalendar: (id: Id, patch: Partial<Calendar>) => void;
  /** Cadastra uma exceção (feriado ou dia útil especial) e reagenda. */
  addCalendarException: (exception: CalendarException) => void;
  /** Remove uma exceção e reagenda as tarefas afetadas. */
  removeCalendarException: (id: Id) => void;

  indentTasks: (ids: Id[]) => { ok: boolean; error?: WbsErrorCode };
  outdentTasks: (ids: Id[]) => { ok: boolean; error?: WbsErrorCode };
  /**
   * Move tarefas dentro do próprio nível (uma ou várias posições) em um
   * único comando de desfazer (specs/task-structure — "Ordenação de tarefas").
   */
  moveTasks: (
    ids: Id[],
    direction: "up" | "down",
    steps?: number,
  ) => { ok: boolean; error?: WbsErrorCode };
  /**
   * Exclui tarefas com as subárvores, vínculos, atribuições e valores
   * associados — tudo em um único comando (specs/editing-history e
   * specs/persistence — "Integridade referencial").
   */
  removeTasks: (ids: Id[]) => boolean;
  /** Cola um plano de clipboard como um único comando de desfazer. */
  applyPaste: (input: {
    anchorId: Id;
    updates: Array<{ id: Id; patch: Partial<Task> }>;
    creates: Task[];
  }) => boolean;
  /** Cria um calendário (cópia do `sourceId`, ou do projeto) e devolve o id. */
  createCalendar: (name: string, sourceId?: Id) => Id;
  /**
   * Exclui um calendário não utilizado. Recusa o padrão do projeto e o que
   * estiver em uso (specs/calendars — "Gerenciamento de calendários").
   */
  removeCalendar: (id: Id) => { ok: boolean; reason?: string };
  /** Cadastro de equipes e pessoas (specs/resources). */
  addTeam: (team: Team) => void;
  updateTeam: (id: Id, patch: Partial<Team>) => void;
  /** Exclui a equipe e desvincula as pessoas dela (mesmo comando). */
  removeTeam: (id: Id) => void;
  addResource: (resource: Resource) => void;
  removeResource: (id: Id) => void;
  /** Atribui uma pessoa à tarefa (100% por padrão) com trabalho e custo. */
  addAssignment: (assignment: Assignment) => { ok: boolean; message?: string };
  updateAssignment: (id: Id, patch: Partial<Assignment>) => void;
  /** Remove a atribuição sem apagar a tarefa; o roll-up é zerado. */
  removeAssignment: (id: Id) => void;
  /**
   * Salva baseline ou plano provisório (até 11 baselines) com escopo de
   * projeto ou de seleção (specs/tracking — "Linhas de base múltiplas").
   */
  saveBaseline: (input: {
    name: string;
    kind: "baseline" | "interim";
    scope: "project" | "selection";
    taskIds?: Id[];
  }) => { ok: boolean; message?: string };
  removeBaseline: (id: Id) => void;
  /** Cria um campo personalizado (specs/custom-fields). */
  addCustomField: (field: CustomField) => void;
  updateCustomField: (id: Id, patch: Partial<CustomField>) => void;
  /**
   * Exclui o campo. Sem `confirm`, recusa quando está em uso devolvendo a
   * contagem (specs/custom-fields — "Campo em uso").
   */
  removeCustomField: (
    id: Id,
    options?: { confirm?: boolean },
  ) => { ok: boolean; inUse?: number; reason?: string };
  /** Grava (ou limpa, com `null`) o valor de um campo numa entidade. */
  setCustomFieldValue: (
    fieldId: Id,
    entityId: Id,
    value: { text?: string | null; num?: number | null; date?: number | null } | null,
  ) => void;
  /** Salva a máscara do código de estrutura (kind `outline_code`). */
  setWbsMask: (mask: string) => void;
  /**
   * Salva um item da biblioteca (visão, filtro…; specs/views-and-filters —
   * "Visões nomeadas" e "Biblioteca global"). `scope: "global"` grava sem
   * projeto, tornando o item disponível em todos os projetos.
   */
  saveLibraryItem: (input: {
    kind: string;
    name: string;
    config: string;
    scope: "project" | "global";
  }) => Id;
  /** Renomear ou reconfigurar um item da biblioteca. */
  updateLibraryItem: (id: Id, patch: { name?: string; config?: string }) => void;
  /** Remove um item da biblioteca (do projeto ou da biblioteca global). */
  removeLibraryItem: (id: Id) => void;
  /**
   * Atualização em lote do progresso (specs/tracking): aplica o percentual
   * proporcional à data de status nas tarefas selecionadas ou em todas.
   * Devolve quantas tarefas foram alteradas.
   */
  bulkUpdateProgress: (target: Id[] | "all", statusDate: number) => number;
  /**
   * Aplica as datas calculadas pelo motor sem criar passo de desfazer
   * (estado derivado persistido como cache — sempre recalculável).
   */
  applyScheduleDates: (updates: Array<{ id: Id; start: number; finish: number }>) => void;
}

const indexById = <T extends { id: Id }>(rows: T[]): Record<Id, T> => {
  const map: Record<Id, T> = {};
  for (const row of rows) map[row.id] = row;
  return map;
};

/** Agrupa os valores de baseline por baseline → tarefa. */
const indexBaselineValues = (rows: BaselineValue[]): Record<Id, Record<Id, BaselineValue>> => {
  const map: Record<Id, Record<Id, BaselineValue>> = {};
  for (const row of rows) {
    (map[row.baselineId] ??= {})[row.taskId] = row;
  }
  return map;
};

/** Agrupa valores de campo por campo → entidade. */
const indexFieldValues = (
  rows: CustomFieldValue[],
): Record<Id, Record<Id, CustomFieldValue>> => {
  const map: Record<Id, Record<Id, CustomFieldValue>> = {};
  for (const row of rows) {
    (map[row.fieldId] ??= {})[row.entityId] = row;
  }
  return map;
};

/**
 * Recalcula trabalho e custo das atribuições da tarefa — duração × unidades
 * e trabalho × taxa (specs/resources — "Cálculo de trabalho e custo") — e
 * grava o roll-up na própria tarefa. Em tarefas de trabalho fixo sem duração
 * informada, a duração é derivada do trabalho e das unidades.
 */
function refreshTaskAssignments(draft: Draft<DomainState>, taskId: Id): void {
  const task = draft.tasks[taskId];
  if (!task) return;

  const ofTask = Object.values(draft.assignments).filter(
    (assignment) => assignment.taskId === taskId,
  );
  const totalUnits = ofTask.reduce((sum, assignment) => sum + assignment.units, 0);

  let duration = task.duration ?? 0;
  if (duration <= 0 && task.work !== null && task.work > 0 && totalUnits > 0) {
    duration = task.work / totalUnits;
  }

  let work = 0;
  let cost = 0;
  for (const assignment of ofTask) {
    const rate = draft.resources[assignment.resourceId]?.standardRate ?? 0;
    assignment.work = assignmentWork(duration, assignment.units);
    assignment.cost = assignmentCost(assignment.work, rate);
    work += assignment.work;
    cost += assignment.cost;
  }

  task.work = work;
  task.cost = cost;
}

const EMPTY = {
  projectId: null as Id | null,
  tasks: {} as Record<Id, Task>,
  taskOrder: [] as Id[],
  taskLinks: {} as Record<Id, TaskLink>,
  resources: {} as Record<Id, Resource>,
  assignments: {} as Record<Id, Assignment>,
  calendars: {} as Record<Id, Calendar>,
  calendarExceptions: {} as Record<Id, CalendarException>,
  teams: {} as Record<Id, Team>,
  statusDate: null as number | null,
  statusAuto: false,
  baselines: {} as Record<Id, Baseline>,
  baselineValues: {} as Record<Id, Record<Id, BaselineValue>>,
  customFields: {} as Record<Id, CustomField>,
  customFieldValues: {} as Record<Id, Record<Id, CustomFieldValue>>,
  libraryItems: {} as Record<Id, LibraryItem>,
};

/** Estrutura mínima que as operações de árvore precisam ler. */
type DomainLike = { taskOrder: Id[]; tasks: Record<Id, Task> };

/** Converte o domínio para os nós puros do `core/wbs`. */
function toWbsNodes(state: DomainLike): WbsNode[] {
  const counters = new Map<string | null, number>();
  const nodes: WbsNode[] = [];

  for (const id of state.taskOrder) {
    const task = state.tasks[id];
    if (!task) continue;
    const siblingIndex = counters.get(task.parentId) ?? 0;
    counters.set(task.parentId, siblingIndex + 1);
    nodes.push({
      id,
      parentId: task.parentId,
      sortOrder: siblingIndex,
      outlineLevel: task.outlineLevel,
      outlineNumber: task.outlineNumber,
    });
  }

  return nodes;
}

/**
 * Recalcula estrutura, nível e numeração WBS dentro do rascunho — sempre
 * parte do mesmo comando (um único passo de desfazer).
 */
function applyRenumber(draft: Draft<DomainState>): void {
  const rebuilt = renumber(toWbsNodes(draft as unknown as DomainLike));
  draft.taskOrder = rebuilt.map((node) => node.id);

  rebuilt.forEach((node, index) => {
    const task = draft.tasks[node.id];
    if (!task) return;
    task.parentId = node.parentId;
    task.outlineLevel = node.outlineLevel;
    task.outlineNumber = node.outlineNumber;
    task.sortOrder = index;
  });
}

/** Assinatura da estrutura WBS de cada tarefa (para detectar mudanças). */
function wbsSignature(state: DomainLike): Record<Id, string> {
  const out: Record<Id, string> = {};
  for (const id of state.taskOrder) {
    const task = state.tasks[id];
    if (task) {
      out[id] = `${String(task.parentId)}|${task.outlineLevel}|${task.outlineNumber}|${task.sortOrder}`;
    }
  }
  return out;
}

/** Ids cuja estrutura mudou entre duas assinaturas. */
function changedSince(before: Record<Id, string>, after: Record<Id, string>): Id[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...ids].filter((id) => before[id] !== after[id]);
}

/** Converte um calendário do domínio para o formato puro do `core/calendar`. */
export function toCoreCalendar(state: DomainState, calendarId: Id): CoreCalendar | null {
  const calendar = state.calendars[calendarId];
  if (!calendar) return null;

  return {
    id: calendar.id,
    name: calendar.name,
    weeklyMask: calendar.weeklyMask,
    workingHoursStart: calendar.workingHoursStart,
    workingHoursEnd: calendar.workingHoursEnd,
    exceptions: Object.values(state.calendarExceptions)
      .filter((exception) => exception.calendarId === calendarId)
      .map((exception) => ({
        date: startOfDay(exception.date),
        isWorking: exception.isWorking,
        startTime: exception.startTime,
        endTime: exception.endTime,
        name: exception.name,
      })),
  };
}

export const useDomainStore = create<DomainState>()((set, get) => {
  /**
   * Aplica uma receita como **um** comando de histórico.
   * Retorna `false` quando nada mudou.
   */
  const commit = (label: string, recipe: (draft: DomainState) => void): boolean => {
    const current = get();
    const [next, patches, inverse] = produceWithPatches(current, recipe as (draft: Draft<DomainState>) => void);
    if (patches.length === 0) return false;
    useHistoryStore.getState().push({ label, patches, inverse });
    set(next as DomainState);
    return true;
  };

  const markTaskDirty = (id: Id) => {
    const row = get().tasks[id];
    if (row) {
      emitDirty({
        entity: "tasks",
        key: id,
        kind: "upsert",
        row: row as unknown as Record<string, unknown>,
      });
    }
  };

  /** Executa uma operação de árvore do core como um único comando. */
  const runWbs = (
    label: string,
    operation: (nodes: WbsNode[]) => WbsResult,
  ): { ok: boolean; error?: WbsErrorCode } => {
    const state = get();
    const nodes = toWbsNodes(state);
    const result = operation(nodes);
    if (!result.ok) return { ok: false, error: result.error };

    const order = result.nodes.map((node) => node.id);
    const changed: Id[] = [];

    commit(label, (draft) => {
      draft.taskOrder = order;
      result.nodes.forEach((node, index) => {
        const task = draft.tasks[node.id];
        if (!task) return;

        const moved =
          task.parentId !== node.parentId ||
          task.outlineLevel !== node.outlineLevel ||
          task.outlineNumber !== node.outlineNumber ||
          task.sortOrder !== index;
        if (!moved) return;

        task.parentId = node.parentId;
        task.outlineLevel = node.outlineLevel;
        task.outlineNumber = node.outlineNumber;
        task.sortOrder = index;
        task.updatedAt = Date.now();
        changed.push(node.id);
      });

      // specs/task-structure — "Tarefa-resumo e roll-up": a tarefa-resumo é
      // criada (ou removida) automaticamente pela estrutura — quem tem
      // filhos é resumo, em qualquer operação de árvore.
      const parents = new Set(
        result.nodes.map((node) => node.parentId).filter((id): id is string => id !== null),
      );
      for (const task of Object.values(draft.tasks)) {
        const shouldBeSummary = parents.has(task.id);
        if (task.isSummary === shouldBeSummary) continue;
        task.isSummary = shouldBeSummary;
        task.updatedAt = Date.now();
        if (!changed.includes(task.id)) changed.push(task.id);
      }
    });

    for (const id of changed) markTaskDirty(id);
    return { ok: true };
  };

  /**
   * Executa uma mudança de calendário e o reagendamento das tarefas
   * afetadas como **um** comando de histórico (specs/calendars —
   * "Propagação de mudanças de calendário"; specs/editing-history).
   *
   * Tarefas sem calendário próprio seguem o calendário padrão do projeto;
   * manuais e inativas são imunes (specs/scheduling).
   */
  const runCalendarChange = (
    label: string,
    calendarId: Id,
    before: CoreCalendar,
    after: CoreCalendar,
    recipe: (draft: Draft<DomainState>) => void,
    extraDirty: Array<{ entity: string; key: string; kind: "upsert" | "delete"; row?: Record<string, unknown> }> = [],
  ): void => {
    const state = get();
    const isDefault = state.calendars[calendarId]?.isDefault ?? false;
    const affected = Object.values(state.tasks).filter(
      (task) => task.calendarId === calendarId || (isDefault && task.calendarId === null),
    );
    const updates = rescheduleForCalendarChange(affected, before, after);

    const rescheduled: Id[] = [];
    const changed = commit(label, (draft) => {
      recipe(draft);

      const now = Date.now();
      for (const update of updates) {
        const task = draft.tasks[update.id];
        if (!task) continue;
        task.start = update.start;
        task.finish = update.finish;
        task.updatedAt = now;
        rescheduled.push(task.id);
      }
    });

    if (!changed) return;

    for (const event of extraDirty) emitDirty(event);
    for (const id of rescheduled) markTaskDirty(id);
  };

  return {
    ...EMPTY,

    load: (projectId, data, project) => {
      const tasks = indexById(data.tasks);
      const taskOrder = data.tasks
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((task) => task.id);

      set({
        ...EMPTY,
        projectId,
        tasks,
        taskOrder,
        taskLinks: indexById(data.taskLinks),
        resources: indexById(data.resources),
        assignments: indexById(data.assignments),
        calendars: indexById(data.calendars ?? []),
        calendarExceptions: indexById(data.calendarExceptions ?? []),
        teams: indexById(data.teams ?? []),
        baselines: indexById(data.baselines ?? []),
        baselineValues: indexBaselineValues(data.baselineValues ?? []),
        customFields: indexById(data.customFields ?? []),
        customFieldValues: indexFieldValues(data.customFieldValues ?? []),
        libraryItems: indexById(data.libraryItems ?? []),
        statusDate: project?.statusDate ?? null,
        statusAuto: project?.statusAuto ?? false,
      });
      useHistoryStore.getState().clear();
    },

    setProjectStatus: (patch) => set((state) => ({ ...state, ...patch })),

    reset: () => {
      set({ ...EMPTY, taskOrder: [] });
      useHistoryStore.getState().clear();
    },

    undo: () => {
      const entry = useHistoryStore.getState().undo();
      if (!entry) return false;
      set(applyPatches(get(), entry.inverse) as DomainState);
      return true;
    },

    redo: () => {
      const entry = useHistoryStore.getState().redo();
      if (!entry) return false;
      set(applyPatches(get(), entry.patches) as DomainState);
      return true;
    },

    updateTask: (id, patch) => {
      const changed = commit("editar tarefa", (draft) => {
        const task = draft.tasks[id];
        if (!task) return;
        Object.assign(task, patch, { updatedAt: Date.now() });
        // a duração move o trabalho/custo das atribuições da tarefa
        if (patch.duration !== undefined) refreshTaskAssignments(draft, id);
      });

      if (changed) {
        markTaskDirty(id);
        if (patch.duration !== undefined) {
          for (const assignment of Object.values(get().assignments)) {
            if (assignment.taskId === id) {
              emitDirty({
                entity: "assignments",
                key: assignment.id,
                kind: "upsert",
                row: assignment as unknown as Record<string, unknown>,
              });
            }
          }
        }
      }
    },

    addTask: (task, index) => {
      const before = wbsSignature(get());
      const added = commit("inserir tarefa", (draft) => {
        draft.tasks[task.id] = task;
        const position = index ?? draft.taskOrder.length;
        draft.taskOrder.splice(position, 0, task.id);
        applyRenumber(draft);
        // specs/task-structure — "Tarefa-resumo e roll-up": receber filho
        // promove a tarefa a resumo (mesmo na criação direta).
        const parent = task.parentId ? draft.tasks[task.parentId] : undefined;
        if (parent && !parent.isSummary) {
          parent.isSummary = true;
          parent.updatedAt = Date.now();
        }
      });

      if (added) {
        const after = wbsSignature(get());
        for (const id of changedSince(before, after)) markTaskDirty(id);
        if (task.parentId) markTaskDirty(task.parentId);
      }
    },

    removeTask: (id) => {
      void get().removeTasks([id]);
    },

    removeTasks: (ids) => {
      const state = get();

      // filhos diretos para expandir cada id para a sua subárvore
      const childrenOf = new Map<Id, Id[]>();
      for (const id of state.taskOrder) {
        const parentId = state.tasks[id]?.parentId;
        if (!parentId) continue;
        const list = childrenOf.get(parentId);
        if (list) list.push(id);
        else childrenOf.set(parentId, [id]);
      }

      const doomed = new Set<Id>();
      const queue = [...ids];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (doomed.has(id) || !state.tasks[id]) continue;
        doomed.add(id);
        for (const child of childrenOf.get(id) ?? []) queue.push(child);
      }
      if (doomed.size === 0) return false;

      // registros dependentes: vínculos, valores de campo, de baseline e
      // atribuições (o servidor apaga em cascata; o estado em memória também)
      const links = Object.values(state.taskLinks).filter(
        (link) => doomed.has(link.predecessorId) || doomed.has(link.successorId),
      );
      const staleFieldValues: Array<[Id, Id]> = [];
      for (const [fieldId, byEntity] of Object.entries(state.customFieldValues)) {
        for (const entityId of Object.keys(byEntity)) {
          if (doomed.has(entityId)) staleFieldValues.push([fieldId, entityId]);
        }
      }
      const staleBaselineValues: Array<[Id, Id]> = [];
      for (const [baselineId, byTask] of Object.entries(state.baselineValues)) {
        for (const taskId of Object.keys(byTask)) {
          if (doomed.has(taskId)) staleBaselineValues.push([baselineId, taskId]);
        }
      }
      const assignments = Object.values(state.assignments).filter((assignment) =>
        doomed.has(assignment.taskId),
      );

      const before = wbsSignature(get());
      const summaryChanged: Id[] = [];
      const removed = commit("excluir tarefas", (draft) => {
        for (const id of doomed) delete draft.tasks[id];
        draft.taskOrder = draft.taskOrder.filter((id) => !doomed.has(id));
        for (const link of links) delete draft.taskLinks[link.id];
        for (const [fieldId, entityId] of staleFieldValues) {
          const byEntity = draft.customFieldValues[fieldId];
          if (byEntity) delete byEntity[entityId];
        }
        for (const [baselineId, taskId] of staleBaselineValues) {
          const byTask = draft.baselineValues[baselineId];
          if (byTask) delete byTask[taskId];
        }
        for (const assignment of assignments) delete draft.assignments[assignment.id];
        applyRenumber(draft);

        // quem perdeu os filhos deixa de ser tarefa-resumo
        const parents = new Set<Id>();
        for (const id of draft.taskOrder) {
          const parentId = draft.tasks[id]?.parentId;
          if (parentId) parents.add(parentId);
        }
        for (const task of Object.values(draft.tasks)) {
          const shouldBeSummary = parents.has(task.id);
          if (task.isSummary === shouldBeSummary) continue;
          task.isSummary = shouldBeSummary;
          task.updatedAt = Date.now();
          summaryChanged.push(task.id);
        }
      });

      if (!removed) return false;

      const after = wbsSignature(get());
      for (const changedId of changedSince(before, after)) {
        if (doomed.has(changedId)) continue;
        markTaskDirty(changedId);
      }
      for (const id of summaryChanged) markTaskDirty(id);
      for (const id of doomed) {
        emitDirty({ entity: "tasks", key: id, kind: "delete" });
      }
      for (const link of links) {
        emitDirty({ entity: "task_links", key: link.id, kind: "delete" });
      }
      for (const [fieldId, entityId] of staleFieldValues) {
        emitDirty({ entity: "custom_field_values", key: [fieldId, entityId], kind: "delete" });
      }
      for (const [baselineId, taskId] of staleBaselineValues) {
        emitDirty({ entity: "baseline_values", key: [baselineId, taskId], kind: "delete" });
      }
      for (const assignment of assignments) {
        emitDirty({ entity: "assignments", key: assignment.id, kind: "delete" });
      }
      return true;
    },

    moveTasks: (ids, direction, steps = 1) =>
      runWbs("mover tarefas", (nodes) => {
        const indexOf = new Map(nodes.map((node, index) => [node.id, index]));
        const ordered = ids
          .filter((id) => indexOf.has(id))
          .sort((a, b) => indexOf.get(a)! - indexOf.get(b)!);
        // o bloco preserva a ordem relativa: para cima o de cima troca
        // primeiro, para baixo o de baixo
        const sequence = direction === "up" ? ordered : [...ordered].reverse();

        let current = nodes;
        for (const id of sequence) {
          for (let step = 0; step < steps; step += 1) {
            const result = moveWithinLevel(current, id, direction);
            if (!result.ok) return result;
            current = result.nodes;
          }
        }
        return { ok: true, nodes: current, changed: ordered };
      }),

    addLink: (link) => {
      const state = get();
      // Validação única para os três caminhos de criação (specs/task-dependencies).
      const validation = validateLink(
        link,
        Object.values(state.tasks),
        Object.values(state.taskLinks),
      );
      if (!validation.ok) {
        return {
          ok: false,
          reason: validation.reason,
          message: validation.message,
          path: validation.path,
        };
      }

      const added = commit("vincular tarefas", (draft) => {
        draft.taskLinks[link.id] = link;
      });
      if (added) {
        emitDirty({
          entity: "task_links",
          key: link.id,
          kind: "upsert",
          row: link as unknown as Record<string, unknown>,
        });
      }
      return { ok: true };
    },

    updateLink: (id, patch) => {
      const changed = commit("alterar vínculo", (draft) => {
        const link = draft.taskLinks[id];
        if (!link) return;
        Object.assign(link, patch);
      });
      if (changed) {
        const row = get().taskLinks[id];
        if (row) {
          emitDirty({
            entity: "task_links",
            key: id,
            kind: "upsert",
            row: row as unknown as Record<string, unknown>,
          });
        }
      }
    },

    removeLink: (id) => {
      const removed = commit("remover vínculo", (draft) => {
        delete draft.taskLinks[id];
      });
      if (removed) emitDirty({ entity: "task_links", key: id, kind: "delete" });
    },

    updateCalendar: (id, patch) => {
      const state = get();
      const before = toCoreCalendar(state, id);
      const calendar = state.calendars[id];
      if (!before || !calendar) return;

      const after: CoreCalendar = { ...before, ...patch };
      const row = { ...calendar, ...patch };

      runCalendarChange(
        "alterar calendário",
        id,
        before,
        after,
        (draft) => {
          const target = draft.calendars[id];
          if (target) Object.assign(target, patch);
        },
        [{ entity: "calendars", key: id, kind: "upsert", row: row as unknown as Record<string, unknown> }],
      );
    },

    addCalendarException: (exception) => {
      const state = get();
      const before = toCoreCalendar(state, exception.calendarId);
      if (!before) return;

      const date = startOfDay(exception.date);
      const stored: CalendarException = { ...exception, date };
      const mapped = {
        date,
        isWorking: exception.isWorking,
        startTime: exception.startTime,
        endTime: exception.endTime,
        name: exception.name,
      };
      // Uma exceção por dia: a nova substitui a anterior (regras do core).
      const after: CoreCalendar = {
        ...before,
        exceptions: [...before.exceptions.filter((entry) => entry.date !== date), mapped],
      };

      runCalendarChange(
        "adicionar exceção de calendário",
        exception.calendarId,
        before,
        after,
        (draft) => {
          draft.calendarExceptions[stored.id] = stored;
        },
        [
          {
            entity: "calendar_exceptions",
            key: stored.id,
            kind: "upsert",
            row: stored as unknown as Record<string, unknown>,
          },
        ],
      );
    },

    removeCalendarException: (id) => {
      const state = get();
      const exception = state.calendarExceptions[id];
      if (!exception) return;

      const before = toCoreCalendar(state, exception.calendarId);
      if (!before) return;

      const date = startOfDay(exception.date);
      const after: CoreCalendar = {
        ...before,
        exceptions: before.exceptions.filter((entry) => entry.date !== date),
      };

      runCalendarChange(
        "remover exceção de calendário",
        exception.calendarId,
        before,
        after,
        (draft) => {
          delete draft.calendarExceptions[id];
        },
        [{ entity: "calendar_exceptions", key: id, kind: "delete" }],
      );
    },

    indentTasks: (ids) => runWbs("indentar tarefas", (nodes) => indent(nodes, ids)),
    outdentTasks: (ids) => runWbs("outdentar tarefas", (nodes) => outdent(nodes, ids)),

    applyPaste: ({ anchorId, updates, creates }) => {
      const state = get();
      const anchorIndex = state.taskOrder.indexOf(anchorId);
      const before = wbsSignature(state);

      const applied = commit("colar do clipboard", (draft) => {
        for (const update of updates) {
          const task = draft.tasks[update.id];
          if (task) Object.assign(task, update.patch, { updatedAt: Date.now() });
        }

        if (creates.length > 0) {
          let insertAt = anchorIndex >= 0 ? anchorIndex + 1 : draft.taskOrder.length;
          for (const task of creates) {
            draft.tasks[task.id] = task;
            draft.taskOrder.splice(insertAt, 0, task.id);
            insertAt += 1;
          }
        }

        applyRenumber(draft);
      });

      if (!applied) return false;

      const after = wbsSignature(get());
      for (const id of changedSince(before, after)) markTaskDirty(id);
      return true;
    },

    addTeam: (team) => {
      const created = commit("criar equipe", (draft) => {
        draft.teams[team.id] = team;
      });
      if (created) {
        emitDirty({
          entity: "teams",
          key: team.id,
          kind: "upsert",
          row: team as unknown as Record<string, unknown>,
        });
      }
    },

    updateTeam: (id, patch) => {
      const state = get();
      if (!state.teams[id]) return;
      const row = { ...state.teams[id], ...patch };
      const changed = commit("alterar equipe", (draft) => {
        const target = draft.teams[id];
        if (target) Object.assign(target, patch);
      });
      if (changed) {
        emitDirty({
          entity: "teams",
          key: id,
          kind: "upsert",
          row: row as unknown as Record<string, unknown>,
        });
      }
    },

    removeTeam: (id) => {
      const state = get();
      if (!state.teams[id]) return;
      const affected = Object.values(state.resources).filter(
        (resource) => resource.teamId === id,
      );

      const removed = commit("excluir equipe", (draft) => {
        delete draft.teams[id];
        for (const resource of affected) {
          const target = draft.resources[resource.id];
          if (target) target.teamId = null;
        }
      });

      if (removed) {
        emitDirty({ entity: "teams", key: id, kind: "delete" });
        for (const resource of affected) {
          emitDirty({
            entity: "resources",
            key: resource.id,
            kind: "upsert",
            row: { ...state.resources[resource.id], teamId: null } as unknown as Record<
              string,
              unknown
            >,
          });
        }
      }
    },

    addResource: (resource) => {
      const created = commit("cadastrar pessoa", (draft) => {
        draft.resources[resource.id] = resource;
      });
      if (created) {
        emitDirty({
          entity: "resources",
          key: resource.id,
          kind: "upsert",
          row: resource as unknown as Record<string, unknown>,
        });
      }
    },

    removeResource: (id) => {
      const removed = commit("excluir pessoa", (draft) => {
        delete draft.resources[id];
      });
      if (removed) emitDirty({ entity: "resources", key: id, kind: "delete" });
    },

    addAssignment: (assignment) => {
      const state = get();
      const duplicate = Object.values(state.assignments).some(
        (entry) =>
          entry.taskId === assignment.taskId && entry.resourceId === assignment.resourceId,
      );
      if (duplicate) {
        return { ok: false, message: "Esta pessoa já está atribuída à tarefa." };
      }

      const created = commit("atribuir recurso", (draft) => {
        draft.assignments[assignment.id] = assignment;
        refreshTaskAssignments(draft, assignment.taskId);
      });

      if (created) {
        const current = get();
        emitDirty({
          entity: "assignments",
          key: assignment.id,
          kind: "upsert",
          row: current.assignments[assignment.id] as unknown as Record<string, unknown>,
        });
        emitDirty({
          entity: "tasks",
          key: assignment.taskId,
          kind: "upsert",
          row: current.tasks[assignment.taskId] as unknown as Record<string, unknown>,
        });
      }
      return created
        ? { ok: true }
        : { ok: false, message: "Não foi possível criar a atribuição." };
    },

    updateAssignment: (id, patch) => {
      const state = get();
      const existing = state.assignments[id];
      if (!existing) return;

      const changed = commit("alterar atribuição", (draft) => {
        const target = draft.assignments[id];
        if (!target) return;
        Object.assign(target, patch);
        refreshTaskAssignments(draft, target.taskId);
      });

      if (changed) {
        const current = get();
        emitDirty({
          entity: "assignments",
          key: id,
          kind: "upsert",
          row: current.assignments[id] as unknown as Record<string, unknown>,
        });
        emitDirty({
          entity: "tasks",
          key: existing.taskId,
          kind: "upsert",
          row: current.tasks[existing.taskId] as unknown as Record<string, unknown>,
        });
      }
    },

    removeAssignment: (id) => {
      const state = get();
      const existing = state.assignments[id];
      if (!existing) return;

      const removed = commit("remover atribuição", (draft) => {
        delete draft.assignments[id];
        refreshTaskAssignments(draft, existing.taskId);
      });

      if (removed) {
        emitDirty({ entity: "assignments", key: id, kind: "delete" });
        emitDirty({
          entity: "tasks",
          key: existing.taskId,
          kind: "upsert",
          row: get().tasks[existing.taskId] as unknown as Record<string, unknown>,
        });
      }
    },

    saveBaseline: (input) => {
      const state = get();
      const name = input.name.trim();
      if (!name) return { ok: false, message: "Informe o nome." };
      if (!state.projectId) return { ok: false, message: "Nenhum projeto aberto." };

      // specs/tracking — "Linhas de base múltiplas": até 11 por projeto.
      if (input.kind === "baseline") {
        const count = Object.values(state.baselines).filter(
          (baseline) => baseline.kind === "baseline",
        ).length;
        if (count >= 11) {
          return { ok: false, message: "Limite de 11 linhas de base por projeto." };
        }
      }

      const scopeIds =
        input.scope === "selection" ? (input.taskIds ?? []) : state.taskOrder;
      const unique = [...new Set(scopeIds)].filter((id) => state.tasks[id]);
      if (unique.length === 0) {
        return { ok: false, message: "Nenhuma tarefa para incluir na cópia." };
      }

      const baseline: Baseline = {
        id: newId(),
        projectId: state.projectId,
        name,
        kind: input.kind,
        savedAt: Date.now(),
        scope: input.scope,
      };
      const values: BaselineValue[] = unique.map((taskId) => {
        const task = state.tasks[taskId]!;
        return {
          baselineId: baseline.id,
          taskId,
          start: task.start,
          finish: task.finish,
          duration: task.duration,
          work: task.work,
          cost: task.cost,
        };
      });

      const created = commit("salvar baseline", (draft) => {
        draft.baselines[baseline.id] = baseline;
        const bucket: Record<Id, BaselineValue> = {};
        for (const value of values) bucket[value.taskId] = value;
        draft.baselineValues[baseline.id] = bucket;
      });

      if (created) {
        emitDirty({
          entity: "baselines",
          key: baseline.id,
          kind: "upsert",
          row: baseline as unknown as Record<string, unknown>,
        });
        for (const value of values) {
          const row = value as unknown as Record<string, unknown>;
          emitDirty({ entity: "baseline_values", key: keyOf(row), kind: "upsert", row });
        }
      }
      return created ? { ok: true } : { ok: false, message: "Não foi possível salvar." };
    },

    removeBaseline: (id) => {
      const state = get();
      const baseline = state.baselines[id];
      if (!baseline) return;
      const values = Object.values(state.baselineValues[id] ?? {});

      const removed = commit("excluir baseline", (draft) => {
        delete draft.baselines[id];
        delete draft.baselineValues[id];
      });

      if (removed) {
        emitDirty({ entity: "baselines", key: id, kind: "delete" });
        for (const value of values) {
          emitDirty({
            entity: "baseline_values",
            key: [value.baselineId, value.taskId],
            kind: "delete",
          });
        }
      }
    },

    bulkUpdateProgress: (target, statusDate) => {
      const state = get();
      const active = selectActiveCalendar(state);
      const calendar = (active ? toCoreCalendar(state, active.id) : null) ?? defaultCalendar();

      const ids = target === "all" ? state.taskOrder : [...new Set(target)];
      const updates: Array<{ id: Id; percent: number }> = [];
      for (const id of ids) {
        const task = state.tasks[id];
        if (!task || task.isInactive) continue;
        const percent = progressAt(task, statusDate, calendar);
        if (percent === null || percent === task.percentComplete) continue;
        updates.push({ id, percent });
      }
      if (updates.length === 0) return 0;

      const changed = commit("atualizar progresso", (draft) => {
        const now = Date.now();
        for (const update of updates) {
          const task = draft.tasks[update.id];
          if (!task) continue;
          task.percentComplete = update.percent;
          task.updatedAt = now;
        }
      });

      if (changed) for (const update of updates) markTaskDirty(update.id);
      return updates.length;
    },

    addCustomField: (field) => {
      const created = commit("criar campo personalizado", (draft) => {
        draft.customFields[field.id] = field;
      });
      if (created) {
        emitDirty({
          entity: "custom_fields",
          key: field.id,
          kind: "upsert",
          row: field as unknown as Record<string, unknown>,
        });
      }
    },

    updateCustomField: (id, patch) => {
      const state = get();
      if (!state.customFields[id]) return;
      const row = { ...state.customFields[id], ...patch };
      const changed = commit("alterar campo personalizado", (draft) => {
        const target = draft.customFields[id];
        if (target) Object.assign(target, patch);
      });
      if (changed) {
        emitDirty({
          entity: "custom_fields",
          key: id,
          kind: "upsert",
          row: row as unknown as Record<string, unknown>,
        });
      }
    },

    removeCustomField: (id, options) => {
      const state = get();
      const field = state.customFields[id];
      if (!field) return { ok: false, reason: "Campo não encontrado." };

      const values = Object.values(state.customFieldValues[id] ?? {});
      const inUse = new Set(values.map((value) => value.entityId)).size;
      if (inUse > 0 && !options?.confirm) {
        // specs/custom-fields — "Campo em uso": avisa da contagem e pede confirmação
        return { ok: false, inUse, reason: `Campo em uso em ${inUse} ${field.entityType === "task" ? (inUse === 1 ? "tarefa" : "tarefas") : "registros"}.` };
      }

      const removed = commit("excluir campo personalizado", (draft) => {
        delete draft.customFields[id];
        delete draft.customFieldValues[id];
      });
      if (removed) {
        emitDirty({ entity: "custom_fields", key: id, kind: "delete" });
        for (const value of values) {
          emitDirty({
            entity: "custom_field_values",
            key: [value.fieldId, value.entityId],
            kind: "delete",
          });
        }
      }
      return { ok: removed };
    },

    setCustomFieldValue: (fieldId, entityId, value) => {
      const state = get();
      const field = state.customFields[fieldId];
      if (!field) return;

      const current = state.customFieldValues[fieldId]?.[entityId];
      if (value === null) {
        if (!current) return;
        const removed = commit("limpar campo personalizado", (draft) => {
          delete draft.customFieldValues[fieldId]![entityId];
        });
        if (removed) {
          emitDirty({
            entity: "custom_field_values",
            key: [current.fieldId, current.entityId],
            kind: "delete",
          });
        }
        return;
      }

      const next: CustomFieldValue = {
        fieldId,
        entityId,
        valueText: value.text ?? null,
        valueNum: value.num ?? null,
        valueDate: value.date ?? null,
      };
      const changed = commit("editar campo personalizado", (draft) => {
        (draft.customFieldValues[fieldId] ??= {})[entityId] = next;
      });
      if (changed) {
        emitDirty({
          entity: "custom_field_values",
          key: keyOf(next as unknown as Record<string, unknown>),
          kind: "upsert",
          row: next as unknown as Record<string, unknown>,
        });
      }
    },

    setWbsMask: (mask) => {
      const state = get();
      if (!state.projectId) return;
      const trimmed = mask.trim();

      // upsert: reaproveita o item `outline_code` existente, ou cria o primeiro
      const existing = Object.values(state.libraryItems).find(
        (item) => item.kind === "outline_code",
      );

      if (existing) {
        const row = { ...existing, config: JSON.stringify({ mask: trimmed }) };
        const changed = commit("alterar máscara WBS", (draft) => {
          const target = draft.libraryItems[existing.id];
          if (target) target.config = row.config;
        });
        if (changed) {
          emitDirty({
            entity: "library_items",
            key: existing.id,
            kind: "upsert",
            row: row as unknown as Record<string, unknown>,
          });
        }
        return;
      }

      const item: LibraryItem = {
        id: newId(),
        kind: "outline_code",
        name: "Código WBS",
        projectId: state.projectId,
        config: JSON.stringify({ mask: trimmed }),
        createdAt: Date.now(),
      };
      const created = commit("salvar máscara WBS", (draft) => {
        draft.libraryItems[item.id] = item;
      });
      if (created) {
        emitDirty({
          entity: "library_items",
          key: item.id,
          kind: "upsert",
          row: item as unknown as Record<string, unknown>,
        });
      }
    },

    saveLibraryItem: (input) => {
      const state = get();
      if (!state.projectId) return "";
      const name = input.name.trim();
      if (!name) return "";

      const item: LibraryItem = {
        id: newId(),
        kind: input.kind,
        name,
        // `null` = biblioteca global, visível em todos os projetos.
        projectId: input.scope === "global" ? null : state.projectId,
        config: input.config,
        createdAt: Date.now(),
      };
      const created = commit("salvar item da biblioteca", (draft) => {
        draft.libraryItems[item.id] = item;
      });
      if (created) {
        emitDirty({
          entity: "library_items",
          key: item.id,
          kind: "upsert",
          row: item as unknown as Record<string, unknown>,
        });
      }
      return item.id;
    },

    updateLibraryItem: (id, patch) => {
      const state = get();
      const existing = state.libraryItems[id];
      if (!existing) return;
      const name = patch.name?.trim() || existing.name;
      const config = patch.config ?? existing.config;
      if (name === existing.name && config === existing.config) return;

      const next: LibraryItem = { ...existing, name, config };
      const changed = commit("editar item da biblioteca", (draft) => {
        const target = draft.libraryItems[id];
        if (!target) return;
        target.name = name;
        target.config = config;
      });
      if (changed) {
        emitDirty({
          entity: "library_items",
          key: id,
          kind: "upsert",
          row: next as unknown as Record<string, unknown>,
        });
      }
    },

    removeLibraryItem: (id) => {
      const state = get();
      if (!state.libraryItems[id]) return;
      const removed = commit("excluir item da biblioteca", (draft) => {
        delete draft.libraryItems[id];
      });
      if (removed) {
        emitDirty({ entity: "library_items", key: id, kind: "delete" });
      }
    },

    createCalendar: (name, sourceId) => {
      const state = get();
      const source = sourceId ? state.calendars[sourceId] : undefined;
      const id = newId();
      const calendar: Calendar = {
        id,
        projectId: state.projectId,
        name,
        isDefault: false,
        weeklyMask: source?.weeklyMask ?? WEEKDAY_MASK_DEFAULT,
        workingHoursStart: source?.workingHoursStart ?? "09:00",
        workingHoursEnd: source?.workingHoursEnd ?? "18:00",
      };
      // Duplicar copia as exceções; criar começa sem exceções.
      const copies =
        sourceId !== undefined
          ? Object.values(state.calendarExceptions)
              .filter((exception) => exception.calendarId === sourceId)
              .map((exception) => ({ ...exception, id: newId(), calendarId: id }))
          : [];

      const created = commit("criar calendário", (draft) => {
        draft.calendars[id] = calendar;
        for (const copy of copies) draft.calendarExceptions[copy.id] = copy;
      });

      if (created) {
        emitDirty({
          entity: "calendars",
          key: id,
          kind: "upsert",
          row: calendar as unknown as Record<string, unknown>,
        });
        for (const copy of copies) {
          emitDirty({
            entity: "calendar_exceptions",
            key: copy.id,
            kind: "upsert",
            row: copy as unknown as Record<string, unknown>,
          });
        }
      }
      return id;
    },

    removeCalendar: (id) => {
      const state = get();
      const calendar = state.calendars[id];
      if (!calendar) return { ok: false, reason: "Calendário não encontrado." };
      if (calendar.isDefault) {
        return { ok: false, reason: "O calendário padrão do projeto não pode ser excluído." };
      }

      const usedByTask = Object.values(state.tasks).find((task) => task.calendarId === id);
      if (usedByTask) return { ok: false, reason: `Em uso pela tarefa "${usedByTask.name}".` };
      const usedByResource = Object.values(state.resources).find(
        (resource) => resource.calendarId === id,
      );
      if (usedByResource) {
        return { ok: false, reason: `Em uso pelo recurso "${usedByResource.name}".` };
      }

      const exceptions = Object.values(state.calendarExceptions).filter(
        (exception) => exception.calendarId === id,
      );
      const removed = commit("excluir calendário", (draft) => {
        delete draft.calendars[id];
        for (const exception of exceptions) delete draft.calendarExceptions[exception.id];
      });

      if (removed) {
        emitDirty({ entity: "calendars", key: id, kind: "delete" });
        for (const exception of exceptions) {
          emitDirty({ entity: "calendar_exceptions", key: exception.id, kind: "delete" });
        }
      }
      return { ok: removed };
    },

    applyScheduleDates: (updates) => {
      const state = get();
      const changed: Id[] = [];

      const next = produce(state, (draft) => {
        for (const update of updates) {
          const task = draft.tasks[update.id];
          if (!task) continue;
          // Manuais e inativas são imunes ao cálculo (specs/scheduling).
          if (task.schedulingMode === "manual" || task.isInactive) continue;
          if (task.start === update.start && task.finish === update.finish) continue;

          task.start = update.start;
          task.finish = update.finish;
          task.updatedAt = Date.now();
          changed.push(task.id);
        }
      }) as DomainState;

      if (changed.length === 0) return;
      set(next);
      // Sem passo de desfazer (é cache derivado), mas persiste como sempre.
      for (const id of changed) markTaskDirty(id);
    },
  };
});

/** Seletores simples (evitam re-render por referência instável). */
export const selectTasksInOrder = (state: DomainState): Task[] =>
  state.taskOrder.map((id) => state.tasks[id]).filter((task): task is Task => Boolean(task));

/** Calendário ativo do projeto: o padrão, ou o primeiro cadastrado. */
/** Máscara do código de estrutura (kind `outline_code`), ou `null`. */
export const selectWbsMask = (state: DomainState): string | null => {
  const item = Object.values(state.libraryItems).find(
    (entry) => entry.kind === "outline_code",
  );
  if (!item) return null;
  try {
    const parsed = JSON.parse(item.config) as { mask?: unknown };
    return typeof parsed.mask === "string" && parsed.mask !== "" ? parsed.mask : null;
  } catch {
    return null;
  }
};

export const selectActiveCalendar = (state: DomainState): Calendar | null => {
  const list = Object.values(state.calendars);
  return list.find((calendar) => calendar.isDefault) ?? list[0] ?? null;
};
