import { newId } from "@ontarget/shared";
import { normalizeLabel, type ImportMode, type ImportPlan } from "./importing";
import type {
  Assignment,
  Baseline,
  CustomField,
  DurationUnit,
  Resource,
  SchedulingMode,
  Task,
  TaskLink,
  TaskType,
} from "../../store/types";

/**
 * Monta o payload do `POST /api/projects/:id/import` (specs/import-export —
 * "Importação transacional"): resolve ids por chave natural (mesclagem) ou
 * gera ids novos (substituição), remapeia referências e define quais
 * entidades a substituição remove. O servidor aplica tudo em uma transação.
 */

export interface ImportState {
  projectId: string;
  tasks: Task[];
  taskLinks: TaskLink[];
  resources: Resource[];
  assignments: Assignment[];
  baselines: Baseline[];
  customFields: CustomField[];
  calendarIds: string[];
  teamIds: string[];
  now?: number;
}

export interface ImportPayload {
  mode: ImportMode;
  replaceEntities: string[];
  /** Ordem das chaves respeita as chaves estrangeiras. */
  upserts: Record<string, Array<Record<string, unknown>>>;
}

const LINK_TYPES = new Set(["fs", "ss", "ff", "sf"]);

function upsert(
  upserts: Record<string, Array<Record<string, unknown>>>,
  entity: string,
  row: Record<string, unknown>,
): void {
  (upserts[entity] ??= []).push(row);
}

export function buildImportPayload(plan: ImportPlan, state: ImportState): ImportPayload {
  const mode = plan.mode;
  const now = state.now ?? Date.now();
  const upserts: Record<string, Array<Record<string, unknown>>> = {};
  const calendarIds = new Set(state.calendarIds);
  const teamIds = new Set(state.teamIds);

  /* ------------------------------------------------------------ recursos */

  const resourceByName = new Map(
    state.resources.map((resource) => [normalizeLabel(resource.name), resource]),
  );
  const resourceFinal = new Map<string, Resource>();

  for (const planned of plan.resources) {
    const existing =
      mode === "merge" ? resourceByName.get(normalizeLabel(planned.name)) : undefined;

    // CSV traz só o nome: quem já existe é mantido como está.
    if (!planned.raw) {
      if (existing) {
        resourceFinal.set(planned.key, existing);
        continue;
      }
      const row: Resource = {
        id: newId(),
        projectId: state.projectId,
        teamId: null,
        name: planned.name,
        initials: null,
        color: "#6366f1",
        type: "work",
        maxUnits: 1,
        standardRate: 0,
        costPerUse: 0,
        calendarId: null,
        email: null,
        active: true,
        notes: null,
      };
      resourceFinal.set(planned.key, row);
      upsert(upserts, "resources", row as unknown as Record<string, unknown>);
      continue;
    }

    const raw = planned.raw as Partial<Resource>;
    const id = existing?.id ?? newId();
    const row = {
      ...(existing ?? {}),
      ...raw,
      id,
      projectId: state.projectId,
      name: planned.name,
      teamId: raw.teamId && teamIds.has(raw.teamId) ? raw.teamId : (existing?.teamId ?? null),
      calendarId:
        raw.calendarId && calendarIds.has(raw.calendarId)
          ? raw.calendarId
          : (existing?.calendarId ?? null),
    } as Resource;
    resourceFinal.set(planned.key, row);
    upsert(upserts, "resources", row as unknown as Record<string, unknown>);
  }

  /* ------------------------------------------------------------- tarefas */

  const taskByOutline = new Map(state.tasks.map((task) => [task.outlineNumber, task]));
  const taskFinalIds = new Map<string, string>();

  for (const planned of plan.tasks) {
    const existing = mode === "merge" ? taskByOutline.get(planned.outlineNumber) : undefined;
    taskFinalIds.set(planned.key, existing?.id ?? newId());
  }

  const hasChild = new Set(
    plan.tasks.map((task) => task.parentKey).filter((key): key is string => key !== null),
  );

  for (const planned of plan.tasks) {
    const id = taskFinalIds.get(planned.key)!;
    const existing = mode === "merge" ? taskByOutline.get(planned.outlineNumber) : undefined;
    const parentId = planned.parentKey ? (taskFinalIds.get(planned.parentKey) ?? null) : null;
    const outlineLevel = planned.outlineNumber.split(".").length - 1;
    const isSummary = hasChild.has(planned.key);
    const calendarId =
      planned.calendarId && calendarIds.has(planned.calendarId) ? planned.calendarId : null;

    let row: Task;
    if (planned.raw) {
      // JSON: a linha original completa, com ids/estrutura resolvidos por cima
      const raw = planned.raw as Partial<Task>;
      row = {
        ...(existing ?? {}),
        ...raw,
        id,
        projectId: state.projectId,
        parentId,
        outlineLevel,
        outlineNumber: planned.outlineNumber,
        sortOrder: planned.sortOrder,
        name: planned.name,
        isSummary,
        calendarId,
        createdAt: existing?.createdAt ?? raw.createdAt ?? now,
        updatedAt: now,
      } as Task;
    } else {
      // CSV: campos mapeados com defaults do produto
      row = {
        id,
        projectId: state.projectId,
        parentId,
        outlineLevel,
        outlineNumber: planned.outlineNumber,
        sortOrder: planned.sortOrder,
        name: planned.name,
        notes: planned.notes,
        isSummary,
        isMilestone: planned.isMilestone,
        isInactive: planned.isInactive,
        isPlaceholder: planned.isPlaceholder,
        schedulingMode: planned.schedulingMode as SchedulingMode,
        taskType: planned.taskType as TaskType,
        effortDriven: true,
        constraintType: null,
        constraintDate: null,
        deadline: null,
        manualStart: planned.start,
        manualFinish: planned.finish,
        manualDuration: planned.duration,
        start: planned.start,
        finish: planned.finish,
        duration: planned.duration,
        durationUnit: planned.durationUnit as DurationUnit | null,
        work: planned.work,
        cost: planned.cost,
        fixedCost: null,
        actualStart: null,
        actualFinish: null,
        actualDuration: null,
        actualWork: null,
        actualCost: null,
        percentComplete: planned.percentComplete,
        physicalPercent: null,
        durationEstimated: false,
        priority: planned.priority,
        calendarId,
        wbsCode: planned.wbsCode,
        recurrence: null,
        segments: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
    }
    upsert(upserts, "tasks", row as unknown as Record<string, unknown>);
  }

  /* -------------------------------------------------------------- vínculos */

  const linkByTriple = new Map(
    state.taskLinks.map((link) => [
      `${link.predecessorId}|${link.successorId}|${link.type}`,
      link,
    ]),
  );
  const seenTriples = new Set<string>();

  for (const planned of plan.links) {
    const predecessorId = taskFinalIds.get(planned.predecessorKey);
    const successorId = taskFinalIds.get(planned.successorKey);
    if (!predecessorId || !successorId) continue;
    const type = LINK_TYPES.has(planned.type) ? planned.type : "fs";
    const triple = `${predecessorId}|${successorId}|${type}`;
    if (seenTriples.has(triple)) continue;
    seenTriples.add(triple);

    const existing = mode === "merge" ? linkByTriple.get(triple) : undefined;
    const raw = (planned.raw ?? {}) as Partial<TaskLink>;
    const row: TaskLink = {
      ...(existing ?? {}),
      ...raw,
      id: existing?.id ?? newId(),
      projectId: state.projectId,
      predecessorId,
      successorId,
      type: type as TaskLink["type"],
      lagMs: planned.lagMs,
      crossProjectRef: raw.crossProjectRef ?? null,
    };
    upsert(upserts, "task_links", row as unknown as Record<string, unknown>);
  }

  /* ----------------------------------------------------------- atribuições */

  const assignmentByPair = new Map(
    state.assignments.map((assignment) => [
      `${assignment.taskId}|${assignment.resourceId}`,
      assignment,
    ]),
  );
  const seenPairs = new Set<string>();

  for (const planned of plan.assignments) {
    const taskId = taskFinalIds.get(planned.taskKey);
    const resourceId = resourceFinal.get(planned.resourceKey)?.id;
    if (!taskId || !resourceId) continue;
    const pair = `${taskId}|${resourceId}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);

    const existing = mode === "merge" ? assignmentByPair.get(pair) : undefined;
    const raw = (planned.raw ?? {}) as Partial<Assignment>;
    const row: Assignment = {
      work: null,
      cost: null,
      actualWork: null,
      actualCost: null,
      start: null,
      finish: null,
      proposed: false,
      notes: null,
      ...(existing ?? {}),
      ...raw,
      id: existing?.id ?? newId(),
      projectId: state.projectId,
      taskId,
      resourceId,
      units: raw.units ?? planned.units,
    };
    upsert(upserts, "assignments", row as unknown as Record<string, unknown>);
  }

  /* ------------------------------------------------- campos personalizados */

  const fieldByName = new Map(
    state.customFields.map((field) => [
      `${normalizeLabel(field.name)}|${field.entityType}`,
      field,
    ]),
  );
  const fieldFinal = new Map<string, CustomField>();

  for (const planned of plan.customFields) {
    const existing =
      mode === "merge"
        ? fieldByName.get(`${normalizeLabel(planned.name)}|${planned.entityType}`)
        : undefined;
    const raw = (planned.raw ?? {}) as Partial<CustomField>;
    const row = {
      ...(existing ?? {}),
      ...raw,
      id: existing?.id ?? newId(),
      projectId: state.projectId,
      name: planned.name,
      entityType: planned.entityType,
      dataType: planned.dataType,
      sortOrder: raw.sortOrder ?? existing?.sortOrder ?? 0,
    } as CustomField;
    fieldFinal.set(planned.key, row);
    upsert(upserts, "custom_fields", row as unknown as Record<string, unknown>);
  }

  for (const value of plan.customFieldValues) {
    const field = fieldFinal.get(value.fieldKey);
    const entityId = taskFinalIds.get(value.entityKey) ?? resourceFinal.get(value.entityKey)?.id;
    if (!field || !entityId) continue;
    upsert(upserts, "custom_field_values", {
      fieldId: field.id,
      entityId,
      valueText: value.valueText,
      valueNum: value.valueNum,
      valueDate: value.valueDate,
    });
  }

  /* ------------------------------------------------------------- baselines */

  const baselineByName = new Map(
    state.baselines.map((baseline) => [normalizeLabel(baseline.name), baseline]),
  );
  const baselineFinal = new Map<string, Baseline>();

  for (const planned of plan.baselines) {
    const existing = mode === "merge" ? baselineByName.get(normalizeLabel(planned.name)) : undefined;
    const raw = (planned.raw ?? {}) as Partial<Baseline>;
    const row: Baseline = {
      ...(existing ?? {}),
      ...raw,
      id: existing?.id ?? newId(),
      projectId: state.projectId,
      name: planned.name,
      savedAt: raw.savedAt ?? existing?.savedAt ?? now,
      kind: raw.kind ?? existing?.kind ?? "baseline",
      scope: raw.scope ?? existing?.scope ?? "project",
    };
    baselineFinal.set(planned.key, row);
    upsert(upserts, "baselines", row as unknown as Record<string, unknown>);
  }

  for (const value of plan.baselineValues) {
    const baseline = baselineFinal.get(value.baselineKey);
    const taskId = taskFinalIds.get(value.taskKey);
    if (!baseline || !taskId) continue;
    upsert(upserts, "baseline_values", {
      baselineId: baseline.id,
      taskId,
      start: value.start,
      finish: value.finish,
      duration: value.duration,
      work: value.work,
      cost: value.cost,
    });
  }

  /* --------------------------------------------------------- substituição */

  // O arquivo substitui exatamente o que carrega: JSON leva o projeto todo
  // (tarefas, recursos, campos e baselines); CSV é centrado em tarefas.
  const replaceEntities =
    mode === "replace"
      ? plan.source === "json"
        ? ["tasks", "resources", "custom_fields", "baselines"]
        : ["tasks"]
      : [];

  return { mode, replaceEntities, upserts };
}
