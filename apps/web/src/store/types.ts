/**
 * Tipos do domínio tal como chegam da API (chaves em camelCase).
 * Mantidos aqui — não no core — porque descrevem o formato de transferência.
 */

export type Id = string;
export type SchedulingMode = "manual" | "auto";
export type TaskType = "fixed_duration" | "fixed_work" | "fixed_units";
export type DurationUnit = "minute" | "hour" | "day" | "week" | "month";
export type LinkType = "fs" | "ss" | "ff" | "sf";

export interface Task {
  id: Id;
  projectId: Id;
  parentId: Id | null;
  outlineLevel: number;
  outlineNumber: string;
  sortOrder: number;
  name: string;
  notes: string | null;
  isSummary: boolean;
  isMilestone: boolean;
  isInactive: boolean;
  schedulingMode: SchedulingMode;
  isPlaceholder: boolean;
  taskType: TaskType;
  effortDriven: boolean;
  constraintType: string | null;
  constraintDate: number | null;
  deadline: number | null;
  manualStart: number | null;
  manualFinish: number | null;
  manualDuration: number | null;
  start: number | null;
  finish: number | null;
  duration: number | null;
  durationUnit: DurationUnit | null;
  work: number | null;
  cost: number | null;
  fixedCost: number | null;
  actualStart: number | null;
  actualFinish: number | null;
  actualDuration: number | null;
  actualWork: number | null;
  actualCost: number | null;
  percentComplete: number;
  physicalPercent: number | null;
  durationEstimated: boolean;
  priority: number;
  calendarId: Id | null;
  wbsCode: string | null;
  recurrence: string | null;
  segments: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskLink {
  id: Id;
  projectId: Id;
  predecessorId: Id;
  successorId: Id;
  type: LinkType;
  lagMs: number;
  crossProjectRef: string | null;
}

/** Equipe nomeada e colorida (global ao projeto; specs/resources). */
export interface Team {
  id: Id;
  name: string;
  color: string;
  sortOrder: number;
}

/** Linha de base ou plano provisório (specs/tracking). */
export interface Baseline {
  id: Id;
  projectId: Id;
  name: string;
  /** baseline | interim */
  kind: string;
  savedAt: number;
  /** project | selection */
  scope: string;
}

/** Item da biblioteca (visões, filtros, máscara WBS…; specs/views-and-filters). */
export interface LibraryItem {
  id: Id;
  /** view | filter | group | sort | calendar | outline_code | table */
  kind: string;
  name: string;
  projectId: Id | null;
  config: string;
  createdAt: number | null;
}

/** Campo personalizado (specs/custom-fields). */
export interface CustomField {
  id: Id;
  projectId: Id;
  /** task | resource | project */
  entityType: string;
  name: string;
  /** text|number|date|duration|cost|flag|formula|list */
  dataType: string;
  formula: string | null;
  /** JSON de configuração (ex.: valores de uma lista). */
  config: string | null;
  showIndicator: boolean | null;
  indicatorRules: string | null;
  sortOrder: number;
}

/** Valor de um campo personalizado por entidade (chave: fieldId+entityId). */
export interface CustomFieldValue {
  fieldId: Id;
  entityId: Id;
  valueText: string | null;
  valueNum: number | null;
  valueDate: number | null;
}

/** Valores capturados de cada tarefa na cópia (chave: baselineId+taskId). */
export interface BaselineValue {
  baselineId: Id;
  taskId: Id;
  start: number | null;
  finish: number | null;
  duration: number | null;
  work: number | null;
  cost: number | null;
}

/** Recurso de trabalho (pessoa) pré-cadastrado no projeto. */
export interface Resource {
  id: Id;
  projectId: Id;
  teamId: Id | null;
  name: string;
  initials: string | null;
  color: string;
  type: string;
  maxUnits: number;
  standardRate: number;
  costPerUse: number;
  calendarId: Id | null;
  email: string | null;
  active: boolean;
  notes: string | null;
}

export interface Assignment {
  id: Id;
  projectId: Id;
  taskId: Id;
  resourceId: Id;
  units: number;
  work: number | null;
  cost: number | null;
  actualWork: number | null;
  actualCost: number | null;
  start: number | null;
  finish: number | null;
  proposed: boolean;
  notes: string | null;
}

/** Calendário de trabalho do projeto (specs/calendars). */
export interface Calendar {
  id: Id;
  projectId: Id | null;
  name: string;
  isDefault: boolean;
  /** Bits seg..dom (bit 0 = segunda-feira). */
  weeklyMask: number;
  /** Turno no formato "HH:MM". */
  workingHoursStart: string;
  workingHoursEnd: string;
}

/** Exceção pontual de calendário: feriado ou dia útil especial. */
export interface CalendarException {
  id: Id;
  calendarId: Id;
  /** Epoch ms UTC-naive (meia-noite do dia). */
  date: number;
  isWorking: boolean;
  name: string | null;
  startTime: string | null;
  endTime: string | null;
}

/** Coleções carregadas ao abrir um projeto. */
export interface ProjectData {
  tasks: Task[];
  taskLinks: TaskLink[];
  resources: Resource[];
  assignments: Assignment[];
  calendars?: Calendar[];
  calendarExceptions?: CalendarException[];
  teams?: Team[];
  baselines?: Baseline[];
  baselineValues?: BaselineValue[];
  customFields?: CustomField[];
  customFieldValues?: CustomFieldValue[];
  libraryItems?: LibraryItem[];
}
