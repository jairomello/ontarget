import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { DurationUnit, SchedulingMode, TaskType } from "@ontarget/shared";

/**
 * Esquema do ontarget — fonte: docs/architecture.md §4.
 *
 * Convenções:
 *  - IDs TEXT (UUIDv7, gerados no client)
 *  - Datas INTEGER epoch ms em relógio UTC-naive
 *  - Durações/trabalho INTEGER ms de tempo útil
 *  - Booleans INTEGER 0/1 via `mode: "boolean"`
 *  - JSON estruturado em TEXT
 *
 * Nota de integridade: `projects.calendar_id` é uma referência lógica, sem
 * constraint, porque calendário e projeto formam um ciclo de FK (o projeto
 * aponta para o calendário padrão e o calendário pertence ao projeto). A
 * aplicação garante a consistência ao criar o projeto.
 */

const ts = (name: string) => integer(name, { mode: "number" }).notNull();
const optTs = (name: string) => integer(name, { mode: "number" });
const bool = (name: string, fallback = false) =>
  integer(name, { mode: "boolean" }).notNull().default(fallback);

/* -------------------------------------------------------------------------- */
/* Projeto e biblioteca global                                                 */
/* -------------------------------------------------------------------------- */

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  color: text("color").notNull().default("#4f46e5"),
  start: optTs("start"),
  finish: optTs("finish"),
  statusDate: optTs("status_date"),
  /** Data de status segue a data corrente, quando configurado. */
  statusAuto: bool("status_auto", false),
  /** Referência lógica para o calendário padrão (ver nota no topo do arquivo). */
  calendarId: text("calendar_id"),
  defaultTaskType: text("default_task_type")
    .$type<TaskType>()
    .notNull()
    .default("fixed_duration"),
  defaultSchedulingMode: text("default_scheduling_mode")
    .$type<SchedulingMode>()
    .notNull()
    .default("auto"),
  percentComplete: real("percent_complete").notNull().default(0),
  budget: real("budget"),
  notes: text("notes"),
  archived: bool("archived"),
  templateKey: text("template_key"),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export const libraryItems = sqliteTable(
  "library_items",
  {
    id: text("id").primaryKey(),
    /** view | filter | group | sort | calendar | outline_code | table */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    config: text("config").notNull().default("{}"),
    createdAt: ts("created_at"),
  },
  (t) => [index("ix_library_project").on(t.projectId)],
);

/* -------------------------------------------------------------------------- */
/* Calendários                                                                 */
/* -------------------------------------------------------------------------- */

export const calendars = sqliteTable(
  "calendars",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: bool("is_default"),
    /** Bits seg..dom (bit 0 = segunda). */
    weeklyMask: integer("weekly_mask").notNull().default(0b00011111),
    workingHoursStart: text("working_hours_start").notNull().default("09:00"),
    workingHoursEnd: text("working_hours_end").notNull().default("18:00"),
  },
  (t) => [index("ix_calendars_project").on(t.projectId)],
);

export const calendarExceptions = sqliteTable(
  "calendar_exceptions",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    date: optTs("date"),
    isWorking: bool("is_working"),
    name: text("name"),
    startTime: text("start_time"),
    endTime: text("end_time"),
  },
  (t) => [index("ix_cal_exceptions_cal").on(t.calendarId, t.date)],
);

/* -------------------------------------------------------------------------- */
/* Tarefas                                                                     */
/* -------------------------------------------------------------------------- */

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    outlineLevel: integer("outline_level").notNull().default(0),
    outlineNumber: text("outline_number").notNull().default("1"),
    sortOrder: integer("sort_order").notNull().default(0),
    name: text("name").notNull(),
    notes: text("notes"),
    isSummary: bool("is_summary"),
    isMilestone: bool("is_milestone"),
    isInactive: bool("is_inactive"),
    schedulingMode: text("scheduling_mode").$type<SchedulingMode>().notNull().default("auto"),
    isPlaceholder: bool("is_placeholder"),
    taskType: text("task_type").$type<TaskType>().notNull().default("fixed_duration"),
    effortDriven: bool("effort_driven", true),
    constraintType: text("constraint_type"),
    constraintDate: optTs("constraint_date"),
    deadline: optTs("deadline"),
    manualStart: optTs("manual_start"),
    manualFinish: optTs("manual_finish"),
    manualDuration: integer("manual_duration"),
    start: optTs("start"),
    finish: optTs("finish"),
    duration: integer("duration"),
    durationUnit: text("duration_unit").$type<DurationUnit>().default("day"),
    work: integer("work"),
    cost: real("cost"),
    fixedCost: real("fixed_cost"),
    actualStart: optTs("actual_start"),
    actualFinish: optTs("actual_finish"),
    actualDuration: integer("actual_duration"),
    actualWork: integer("actual_work"),
    actualCost: real("actual_cost"),
    percentComplete: real("percent_complete").notNull().default(0),
    physicalPercent: real("physical_percent"),
    durationEstimated: bool("duration_estimated"),
    priority: integer("priority").notNull().default(500),
    calendarId: text("calendar_id").references(() => calendars.id, { onDelete: "set null" }),
    wbsCode: text("wbs_code"),
    recurrence: text("recurrence"),
    segments: text("segments"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("ix_tasks_proj_order").on(t.projectId, t.sortOrder),
    index("ix_tasks_parent").on(t.projectId, t.parentId),
    index("ix_tasks_outline").on(t.projectId, t.outlineNumber),
  ],
);

export const taskLinks = sqliteTable(
  "task_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    predecessorId: text("predecessor_id").notNull(),
    successorId: text("successor_id").notNull(),
    /** fs | ss | ff | sf */
    type: text("type").notNull().default("fs"),
    lagMs: integer("lag_ms").notNull().default(0),
    crossProjectRef: text("cross_project_ref"),
  },
  (t) => [
    uniqueIndex("ix_links_unique").on(t.predecessorId, t.successorId, t.type),
    index("ix_links_pred").on(t.predecessorId),
    index("ix_links_succ").on(t.successorId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Recursos e equipes                                                          */
/* -------------------------------------------------------------------------- */

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#0ea5e9"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const resources = sqliteTable(
  "resources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    initials: text("initials"),
    color: text("color").notNull().default("#6366f1"),
    /** work | material | cost | budget — v1 usa apenas "work" */
    type: text("type").notNull().default("work"),
    maxUnits: real("max_units").notNull().default(1),
    standardRate: real("standard_rate").notNull().default(0),
    costPerUse: real("cost_per_use").notNull().default(0),
    calendarId: text("calendar_id").references(() => calendars.id, { onDelete: "set null" }),
    email: text("email"),
    active: bool("active", true),
    notes: text("notes"),
  },
  (t) => [index("ix_resources_project").on(t.projectId)],
);

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    units: real("units").notNull().default(1),
    work: integer("work"),
    cost: real("cost"),
    actualWork: integer("actual_work"),
    actualCost: real("actual_cost"),
    start: optTs("start"),
    finish: optTs("finish"),
    proposed: bool("proposed"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("ix_assign_unique").on(t.taskId, t.resourceId),
    index("ix_assign_task").on(t.taskId),
    index("ix_assign_resource").on(t.resourceId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Baselines e planos provisórios                                              */
/* -------------------------------------------------------------------------- */

export const baselines = sqliteTable(
  "baselines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** baseline | interim */
    kind: text("kind").notNull().default("baseline"),
    savedAt: ts("saved_at"),
    /** project | selection */
    scope: text("scope").notNull().default("project"),
  },
  (t) => [index("ix_baselines_project").on(t.projectId)],
);

export const baselineValues = sqliteTable(
  "baseline_values",
  {
    baselineId: text("baseline_id")
      .notNull()
      .references(() => baselines.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    start: optTs("start"),
    finish: optTs("finish"),
    duration: integer("duration"),
    work: integer("work"),
    cost: real("cost"),
  },
  // PK composta (docs/architecture.md §4): exige-se para o upsert idempotente
  // do sync — sem ela, `ON CONFLICT (baseline_id, task_id)` é rejeitado.
  (t) => [
    primaryKey({ columns: [t.baselineId, t.taskId] }),
    index("ix_baseline_values_task").on(t.taskId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Campos personalizados                                                       */
/* -------------------------------------------------------------------------- */

export const customFields = sqliteTable(
  "custom_fields",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** task | resource | project */
    entityType: text("entity_type").notNull(),
    name: text("name").notNull(),
    /** text|number|date|duration|cost|flag|formula|list */
    dataType: text("data_type").notNull(),
    formula: text("formula"),
    config: text("config"),
    showIndicator: bool("show_indicator"),
    indicatorRules: text("indicator_rules"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("ix_custom_fields_project").on(t.projectId, t.entityType)],
);

export const customFieldValues = sqliteTable(
  "custom_field_values",
  {
    fieldId: text("field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    valueText: text("value_text"),
    valueNum: real("value_num"),
    valueDate: optTs("value_date"),
  },
  // PK composta (docs/architecture.md §4): exige-se para o upsert idempotente
  // do sync — sem ela, `ON CONFLICT (field_id, entity_id)` é rejeitado.
  (t) => [
    primaryKey({ columns: [t.fieldId, t.entityId] }),
    index("ix_cf_values_entity").on(t.entityId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Histórico, snapshots e templates de importação                              */
/* -------------------------------------------------------------------------- */

export const changeLog = sqliteTable(
  "change_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    changedAt: ts("changed_at"),
  },
  (t) => [index("ix_log_project_time").on(t.projectId, t.changedAt)],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    payload: text("payload").notNull(),
    createdAt: ts("created_at"),
  },
  (t) => [index("ix_snapshots_project").on(t.projectId, t.createdAt)],
);

export const importTemplates = sqliteTable("import_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** json | csv */
  format: text("format").notNull(),
  mapping: text("mapping").notNull().default("{}"),
  sample: text("sample"),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskLink = typeof taskLinks.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Resource = typeof resources.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Baseline = typeof baselines.$inferSelect;
export type BaselineValue = typeof baselineValues.$inferSelect;
export type Calendar = typeof calendars.$inferSelect;
export type LibraryItem = typeof libraryItems.$inferSelect;
export type CustomField = typeof customFields.$inferSelect;
export type CustomFieldValue = typeof customFieldValues.$inferSelect;
export type ChangeLogEntry = typeof changeLog.$inferSelect;
