/**
 * Domínio puro do ontarget.
 * Sem I/O, sem React, sem DOM — apenas regras testáveis isoladamente.
 */
export const CORE_VERSION = "0.1.0";
export { PROJECT_TEMPLATES, getTemplate, type ProjectTemplate, type TemplateTask } from "./templates";
export {
  indent,
  outdent,
  moveWithinLevel,
  insertSibling,
  insertChild,
  deleteSubtree,
  renumber,
  type WbsNode,
  type WbsResult,
  type WbsErrorCode,
  type WbsInsertResult,
  type InsertPosition,
  type DeleteResult,
} from "./wbs/tree";
export { visibleRows, type VisibleRow, type VisibleRowInput } from "./views/visibleRows";
export {
  EMPTY_FILTER,
  combineFlags,
  flattenGroups,
  groupTasks,
  isFilterActive,
  matchesCondition,
  matchesFilter,
  sortOrder,
  type FieldValue,
  type FieldValues,
  type FilterCombinator,
  type FilterCondition,
  type FilterOperator,
  type FilterPreset,
  type FilterSpec,
  type GroupSummary,
  type SortSpec,
  type TaskGroup,
} from "./views/query";
export {
  UNIT_MS,
  WORKDAY_MS,
  WORKMONTH_MS,
  WORKWEEK_MS,
  formatDurationMs,
  formatDateInput,
  parseDate,
  parseDuration,
  parseNumber,
  parsePercent,
  type DurationUnit,
  type ParsedDuration,
} from "./values/parse";
export {
  DAY_MS,
  HOUR_MS,
  MAX_PX_PER_DAY,
  MIN_PX_PER_DAY,
  addUnit,
  clampZoom,
  createTimeScale,
  displayUnitFor,
  labelFor,
  labelForBand,
  startOfUnit,
  type DisplayUnit,
  type HeaderBand,
  type ScaleTicks,
  type Tick,
  type TimeScale,
} from "./gantt/timeScale";
export {
  WEEKDAY_MASK_DEFAULT,
  addWorkingTime,
  defaultCalendar,
  durationBetween,
  isWorkingDay,
  isWorkingTime,
  nextWorkingMoment,
  startOfDay,
  subtractWorkingTime,
  workingDaysBetween,
  workingWindow,
  type Calendar,
  type CalendarException,
} from "./calendar/calendar";
export {
  rescheduleForCalendarChange,
  type RescheduleTask,
  type RescheduleUpdate,
} from "./calendar/reschedule";
export { runSchedule } from "./scheduling/pipeline";
export { buildGraph, type DependencyGraph } from "./scheduling/graph";
export {
  LINK_REJECTION_MESSAGES,
  validateLink,
  type LinkRejection,
  type LinkRef,
  type LinkTaskRef,
  type LinkValidationResult,
} from "./scheduling/links";
export { assignmentCost, assignmentWork } from "./resources/assignments";
export {
  evaluateIndicator,
  parseIndicatorRules,
  type IndicatorOperator,
  type IndicatorRule,
} from "./customfields/indicators";
export {
  formatWbsCode,
  validateCustomCode,
  wbsPath,
  type CodeValidation,
} from "./wbs/codes";
export {
  FORMULA_FUNCTIONS,
  FORMULA_MAX_DEPTH,
  FORMULA_MAX_LENGTH,
  evaluateFormula,
  type FormulaResult,
  type FormulaValue,
} from "./customfields/formula";
export { classifyDelay, progressAt, type DelayClassification, type StatusTaskInput } from "./tracking/status";
export {
  detectOverallocation,
  type AllocationAssignmentInput,
  type AllocationResourceInput,
  type AllocationTaskInput,
  type OverallocationDay,
  type OverallocationInput,
} from "./resources/allocation";
export {
  changedScheduleIds,
  type ScheduleSnapshot,
} from "./scheduling/incremental";
export {
  expandRecurrences,
  parseRecurrence,
  type RecurrenceRule,
} from "./scheduling/recurrence";
export type {
  ScheduleConflict,
  ScheduleConflictKind,
  ScheduleExclusion,
  ScheduleLinkInput,
  ScheduleOptions,
  ScheduleReason,
  ScheduleReasonSource,
  ScheduleResult,
  ScheduleRollup,
  ScheduleTaskInput,
  ScheduledTask,
  SchedulingLinkType,
} from "./scheduling/types";
export {
  barGeometry,
  barHeight,
  barKind,
  linkGeometry,
  roundedPath,
  type BarGeometry,
  type BarGeometryInput,
  type BarKind,
  type LinkAnchor,
  type LinkGeometry,
  type LinkGeometryInput,
  type LinkObstacle,
  type LinkType,
  type Point,
  type RowMetrics,
  type ScaleX,
} from "./gantt/geometry";

