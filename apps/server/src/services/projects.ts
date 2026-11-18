import { eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getTemplate, WORKDAY_MS, type ProjectTemplate } from "@ontarget/core";
import { newId } from "@ontarget/shared";
import type { Db } from "../db/index";
import * as t from "../db/schema";
import { insertAggregate, serializeAggregate } from "./snapshot";

const DAY_MS = 86_400_000;
const DEFAULT_CALENDAR_MASK = 0b00011111; // seg..sex (bit 0 = segunda)

/** Prefixo do snapshot que permite desfazer uma exclusão em até 10 s. */
export const DELETED_SNAPSHOT_PREFIX = "deleted:";

export interface CreateProjectInput {
  name: string;
  color?: string;
  /** Epoch ms UTC-naive do início do projeto. */
  start?: number | null;
  templateKey?: string | null;
}

export interface ProjectSummaryRow {
  project_id: string;
  name: string;
  code: string | null;
  color: string | null;
  start: number | null;
  finish: number | null;
  archived: number;
  updated_at: number;
  task_count: number;
  resource_count: number;
  percent_complete: number;
  min_start: number | null;
  max_finish: number | null;
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

/** Lista o portfólio a partir da visão resumida, sem carregar as tarefas. */
export function listProjects(db: Db, options: { archived?: boolean } = {}): ProjectSummaryRow[] {
  const archived = options.archived ? 1 : 0;
  return db.all<ProjectSummaryRow>(
    sql`SELECT * FROM v_project_summary WHERE archived = ${archived} ORDER BY updated_at DESC`,
  );
}

export function getProjectRow(db: Db, id: string): t.Project | undefined {
  return db.select().from(t.projects).where(eq(t.projects.id, id)).get();
}

export function getSummary(db: Db, id: string): ProjectSummaryRow | undefined {
  return db
    .all<ProjectSummaryRow>(sql`SELECT * FROM v_project_summary WHERE project_id = ${id}`)
    .at(0);
}

export interface ProjectAggregate {
  project: t.Project;
  summary: ProjectSummaryRow | undefined;
}

export function getProject(db: Db, id: string): ProjectAggregate | undefined {
  const project = getProjectRow(db, id);
  if (!project) return undefined;
  return { project, summary: getSummary(db, id) };
}

/** Aggregate completo (o que o client carrega ao abrir o projeto). */
export interface ProjectDetail extends ProjectAggregate {
  data: {
    tasks: t.Task[];
    taskLinks: t.TaskLink[];
    resources: t.Resource[];
    assignments: t.Assignment[];
    calendars: t.Calendar[];
    calendarExceptions: Array<typeof t.calendarExceptions.$inferSelect>;
    /** Equipes são globais (sem projeto); vêm completas no aggregate. */
    teams: t.Team[];
    baselines: t.Baseline[];
    baselineValues: t.BaselineValue[];
    customFields: t.CustomField[];
    customFieldValues: t.CustomFieldValue[];
    libraryItems: t.LibraryItem[];
  };
}

export function getProjectDetail(db: Db, id: string): ProjectDetail | undefined {
  const base = getProject(db, id);
  if (!base) return undefined;

  const calendars = db.select().from(t.calendars).where(eq(t.calendars.projectId, id)).all();
  const calendarIds = calendars.map((calendar) => calendar.id);

  return {
    ...base,
    data: {
      tasks: db
        .select()
        .from(t.tasks)
        .where(eq(t.tasks.projectId, id))
        .all()
        .sort((a, b) => a.sortOrder - b.sortOrder),
      taskLinks: db.select().from(t.taskLinks).where(eq(t.taskLinks.projectId, id)).all(),
      resources: db.select().from(t.resources).where(eq(t.resources.projectId, id)).all(),
      assignments: db.select().from(t.assignments).where(eq(t.assignments.projectId, id)).all(),
      calendars,
      calendarExceptions:
        calendarIds.length > 0
          ? db
              .select()
              .from(t.calendarExceptions)
              .where(inArray(t.calendarExceptions.calendarId, calendarIds))
              .all()
          : [],
      teams: db.select().from(t.teams).all(),
      baselines: db.select().from(t.baselines).where(eq(t.baselines.projectId, id)).all(),
      baselineValues: db
        .select()
        .from(t.baselineValues)
        .innerJoin(t.baselines, eq(t.baselineValues.baselineId, t.baselines.id))
        .where(eq(t.baselines.projectId, id))
        .all()
        .map((row) => row.baseline_values),
      customFields: db
        .select()
        .from(t.customFields)
        .where(eq(t.customFields.projectId, id))
        .all(),
      customFieldValues: db
        .select()
        .from(t.customFieldValues)
        .innerJoin(t.customFields, eq(t.customFieldValues.fieldId, t.customFields.id))
        .where(eq(t.customFields.projectId, id))
        .all()
        .map((row) => row.custom_field_values),
      // Itens do projeto e da biblioteca global (projectId nulo), que vale
      // para todos os projetos (specs/views-and-filters — "Biblioteca global").
      libraryItems: db
        .select()
        .from(t.libraryItems)
        .where(or(eq(t.libraryItems.projectId, id), isNull(t.libraryItems.projectId)))
        .all(),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

/** Início padrão: primeiro dia útil (seg–sex) a partir de agora. */
function nextWorkingDay(now: number): number {
  const date = new Date(now);
  let day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

  for (let guard = 0; guard < 4_000; guard += 1) {
    const weekday = new Date(day).getUTCDay(); // 0 = domingo
    const bit = weekday === 0 ? 6 : weekday - 1; // seg = bit 0
    if ((DEFAULT_CALENDAR_MASK & (1 << bit)) !== 0) return day;
    day += DAY_MS;
  }
  return now;
}

export function createProject(db: Db, input: CreateProjectInput): ProjectAggregate {
  const template = getTemplate(input.templateKey) ?? getTemplate("vazio")!;
  const now = Date.now();
  const projectId = newId();
  const calendarId = newId();
  const start = input.start ?? nextWorkingDay(now);

  return db.transaction((tx) => {
    tx.insert(t.projects)
      .values({
        id: projectId,
        name: input.name,
        color: input.color ?? "#4f46e5",
        start,
        statusDate: start,
        calendarId: null,
        templateKey: template.key,
        archived: false,
        percentComplete: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Calendário padrão criado antes de o projeto apontar para ele
    // (referência lógica — ver nota no schema).
    tx.insert(t.calendars)
      .values({
        id: calendarId,
        projectId,
        name: "Calendário padrão",
        isDefault: true,
        weeklyMask: DEFAULT_CALENDAR_MASK,
        workingHoursStart: "09:00",
        workingHoursEnd: "18:00",
      })
      .run();

    tx.update(t.projects).set({ calendarId }).where(eq(t.projects.id, projectId)).run();

    insertTemplateTasks(tx, projectId, template, start);

    return getProject(tx, projectId)!;
  });
}

/** Insere a árvore do template mantendo nível, numeração WBS e ordem. */
function insertTemplateTasks(
  tx: Db,
  projectId: string,
  template: ProjectTemplate,
  start: number,
): void {
  const now = Date.now();
  const parents: string[] = [];
  const counters: number[] = [];
  let sortOrder = 0;

  template.tasks.forEach((task, index) => {
    parents.length = task.level;
    counters.length = task.level + 1;
    counters[task.level] = (counters[task.level] ?? 0) + 1;

    const outlineNumber = counters.slice(0, task.level + 1).join(".");
    const parentId = task.level > 0 ? (parents[task.level - 1] ?? null) : null;
    const next = template.tasks[index + 1];
    const isSummary = Boolean(next && next.level > task.level);
    const isMilestone = Boolean(task.milestone) || task.durationDays === 0;
    const id = newId();

    tx.insert(t.tasks)
      .values({
        id,
        projectId,
        parentId,
        outlineLevel: task.level,
        outlineNumber,
        sortOrder: sortOrder++,
        name: task.name,
        isSummary,
        isMilestone,
        isInactive: false,
        schedulingMode: "auto",
        isPlaceholder: false,
        taskType: "fixed_duration",
        effortDriven: true,
        duration: isMilestone ? 0 : task.durationDays * WORKDAY_MS,
        durationUnit: "day",
        percentComplete: 0,
        priority: 500,
        durationEstimated: true,
        start,
        // término inclusive: meia-noite do último dia trabalhado
        finish: isMilestone ? start : start + Math.max(0, task.durationDays - 1) * DAY_MS,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    parents[task.level] = id;
  });
}

/* -------------------------------------------------------------------------- */
/* Alteração, arquivamento e exclusão                                          */
/* -------------------------------------------------------------------------- */

export interface UpdateProjectInput {
  name?: string;
  code?: string | null;
  color?: string;
  start?: number | null;
  finish?: number | null;
  statusDate?: number | null;
  statusAuto?: boolean;
  budget?: number | null;
  notes?: string | null;
  archived?: boolean;
}

export function updateProject(
  db: Db,
  id: string,
  input: UpdateProjectInput,
): ProjectAggregate | undefined {
  const existing = getProjectRow(db, id);
  if (!existing) return undefined;

  const patch: Partial<t.NewProject> = { updatedAt: Date.now() };
  const assignable: Array<keyof UpdateProjectInput> = [
    "name",
    "code",
    "color",
    "start",
    "finish",
    "statusDate",
    "statusAuto",
    "budget",
    "notes",
    "archived",
  ];
  for (const key of assignable) {
    if (input[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = input[key];
    }
  }

  db.update(t.projects).set(patch).where(eq(t.projects.id, id)).run();
  return getProject(db, id);
}

export function deleteProject(db: Db, id: string): boolean {
  const existing = getProjectRow(db, id);
  if (!existing) return false;

  // Guarda o agregado para permitir "Desfazer" por 10 s (specs/portfolio).
  const payload = serializeAggregate(db, id);

  db.transaction((tx) => {
    if (payload) {
      tx.insert(t.snapshots)
        .values({
          id: `${DELETED_SNAPSHOT_PREFIX}${id}`,
          projectId: id,
          payload: JSON.stringify(payload),
          createdAt: Date.now(),
        })
        .run();
    }
    tx.delete(t.projects).where(eq(t.projects.id, id)).run();
  });

  return true;
}

/** Restaura uma exclusão recente (janela de desfazer). */
export function restoreProject(db: Db, id: string): ProjectAggregate | undefined {
  const snapshotId = `${DELETED_SNAPSHOT_PREFIX}${id}`;
  const row = db.select().from(t.snapshots).where(eq(t.snapshots.id, snapshotId)).get();
  if (!row) return undefined;

  const payload = JSON.parse(row.payload) as Parameters<typeof insertAggregate>[1];
  insertAggregate(db, payload);
  db.delete(t.snapshots).where(eq(t.snapshots.id, snapshotId)).run();

  return getProject(db, id);
}

/* -------------------------------------------------------------------------- */
/* Duplicação                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cópia integral do projeto: calendários, tarefas, vínculos, recursos,
 * atribuições, baselines, campos personalizados e itens de biblioteca.
 */
export function duplicateProject(db: Db, id: string): ProjectAggregate | undefined {
  const source = getProjectRow(db, id);
  if (!source) return undefined;

  const now = Date.now();
  const newProjectId = newId();

  return db.transaction((tx) => {
    tx.insert(t.projects)
      .values({
        ...source,
        id: newProjectId,
        name: `${source.name} (cópia)`,
        calendarId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const calendarMap = new Map<string, string>();
    for (const cal of tx.select().from(t.calendars).where(eq(t.calendars.projectId, id)).all()) {
      const newCalId = newId();
      calendarMap.set(cal.id, newCalId);
      tx.insert(t.calendars).values({ ...cal, id: newCalId, projectId: newProjectId }).run();
    }

    if (source.calendarId) {
      tx.update(t.projects)
        .set({ calendarId: calendarMap.get(source.calendarId) ?? null })
        .where(eq(t.projects.id, newProjectId))
        .run();
    }

    const taskMap = new Map<string, string>();
    const tasks = tx.select().from(t.tasks).where(eq(t.tasks.projectId, id)).all();
    for (const task of tasks) {
      const newTaskId = newId();
      taskMap.set(task.id, newTaskId);
      tx.insert(t.tasks)
        .values({
          ...task,
          id: newTaskId,
          projectId: newProjectId,
          parentId: null,
          calendarId: task.calendarId ? (calendarMap.get(task.calendarId) ?? null) : null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    // Segunda passada: restaura a hierarquia com os novos ids.
    for (const task of tasks) {
      if (!task.parentId) continue;
      const newTaskId = taskMap.get(task.id);
      if (!newTaskId) continue;
      tx.update(t.tasks)
        .set({ parentId: taskMap.get(task.parentId) ?? null })
        .where(eq(t.tasks.id, newTaskId))
        .run();
    }

    for (const link of tx
      .select()
      .from(t.taskLinks)
      .where(eq(t.taskLinks.projectId, id))
      .all()) {
      const predecessor = taskMap.get(link.predecessorId);
      const successor = taskMap.get(link.successorId);
      if (!predecessor || !successor) continue;
      tx.insert(t.taskLinks)
        .values({
          ...link,
          id: newId(),
          projectId: newProjectId,
          predecessorId: predecessor,
          successorId: successor,
        })
        .run();
    }

    const resourceMap = new Map<string, string>();
    for (const resource of tx
      .select()
      .from(t.resources)
      .where(eq(t.resources.projectId, id))
      .all()) {
      const newResourceId = newId();
      resourceMap.set(resource.id, newResourceId);
      tx.insert(t.resources)
        .values({
          ...resource,
          id: newResourceId,
          projectId: newProjectId,
          calendarId: resource.calendarId
            ? (calendarMap.get(resource.calendarId) ?? null)
            : null,
        })
        .run();
    }

    for (const assignment of tx
      .select()
      .from(t.assignments)
      .where(eq(t.assignments.projectId, id))
      .all()) {
      const taskId = taskMap.get(assignment.taskId);
      const resourceId = resourceMap.get(assignment.resourceId);
      if (!taskId || !resourceId) continue;
      tx.insert(t.assignments)
        .values({ ...assignment, id: newId(), projectId: newProjectId, taskId, resourceId })
        .run();
    }

    const baselineMap = new Map<string, string>();
    for (const baseline of tx
      .select()
      .from(t.baselines)
      .where(eq(t.baselines.projectId, id))
      .all()) {
      const newBaselineId = newId();
      baselineMap.set(baseline.id, newBaselineId);
      tx.insert(t.baselines)
        .values({ ...baseline, id: newBaselineId, projectId: newProjectId })
        .run();
    }
    for (const value of tx.select().from(t.baselineValues).all()) {
      const baselineId = baselineMap.get(value.baselineId);
      const taskId = taskMap.get(value.taskId);
      if (!baselineId || !taskId) continue;
      tx.insert(t.baselineValues).values({ ...value, baselineId, taskId }).run();
    }

    const fieldMap = new Map<string, string>();
    for (const field of tx
      .select()
      .from(t.customFields)
      .where(eq(t.customFields.projectId, id))
      .all()) {
      const newFieldId = newId();
      fieldMap.set(field.id, newFieldId);
      tx.insert(t.customFields).values({ ...field, id: newFieldId, projectId: newProjectId }).run();
    }
    for (const value of tx.select().from(t.customFieldValues).all()) {
      const fieldId = fieldMap.get(value.fieldId);
      if (!fieldId) continue;
      const entityId =
        taskMap.get(value.entityId) ?? resourceMap.get(value.entityId) ?? value.entityId;
      tx.insert(t.customFieldValues).values({ ...value, fieldId, entityId }).run();
    }

    for (const item of tx
      .select()
      .from(t.libraryItems)
      .where(eq(t.libraryItems.projectId, id))
      .all()) {
      tx.insert(t.libraryItems)
        .values({ ...item, id: newId(), projectId: newProjectId, createdAt: now })
        .run();
    }

    return getProject(tx, newProjectId)!;
  });
}
