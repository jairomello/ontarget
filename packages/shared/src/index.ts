/**
 * Tipos e constantes compartilhados entre server e web.
 */
export type Id = string;

/** Unidades de tempo aceitas nas durações digitadas pelo usuário. */
export type DurationUnit = "minute" | "hour" | "day" | "week" | "month";

/** Modo de agendamento de uma tarefa (PRD RF-02.1). */
export type SchedulingMode = "manual" | "auto";

/** Tipo de tarefa: fixa a duração, ao trabalho ou às unidades (PRD RF-02.9). */
export type TaskType = "fixed_duration" | "fixed_work" | "fixed_units";
