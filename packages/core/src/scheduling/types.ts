/**
 * Contratos do motor de agendamento (docs/architecture.md §8.3).
 *
 * Funções puras: mesma entrada → mesma entrada → mesma saída. Sem I/O,
 * sem DOM, sem relógio (a não ser o fallback de `projectStart`).
 * Datas em epoch ms UTC-naive; durações em ms de tempo útil.
 */
import type { Calendar } from "../calendar/calendar";

export type SchedulingLinkType = "fs" | "ss" | "ff" | "sf";

export interface ScheduleTaskInput {
  id: string;
  parentId: string | null;
  /** Nome exibido — usado nos textos do Task Inspector. */
  name?: string;
  isSummary: boolean;
  isInactive: boolean;
  isPlaceholder: boolean;
  isMilestone: boolean;
  schedulingMode: "manual" | "auto";
  /** Datas manuais (tarefa manual é imune ao cálculo). */
  manualStart: number | null;
  manualFinish: number | null;
  /** Duração planejada em ms de tempo útil. */
  duration: number | null;
  /** Datas atuais — semente para manuais e para derivar duração ausente. */
  start: number | null;
  finish: number | null;
  /** Regra de recorrência em JSON (ver `parseRecurrence`). */
  recurrence?: string | null;
  /** Segmentos de split em JSON: `[{"start": ms, "finish": ms}, …]`. */
  segments?: string | null;
  /** Restrição de data: asap, alap, snet, snlt, fnet, fnlt, must_start_on, must_finish_on. */
  constraintType?: string | null;
  /** Data da restrição (epoch ms UTC-naive). */
  constraintDate?: number | null;
  /** Prazo (deadline): gera alerta quando o término calculado o excede. */
  deadline?: number | null;
  /** fixed_duration | fixed_work | fixed_units (specs/scheduling). */
  taskType?: string | null;
  /** Agendamento condicionado pelo esforço. */
  effortDriven?: boolean | null;
  /** Trabalho planejado em ms de tempo útil. */
  work?: number | null;
  /** Calendário próprio da tarefa; `null`/ausente = calendário do projeto. */
  calendarId?: string | null;
}

export interface ScheduleLinkInput {
  id: string;
  predecessorId: string;
  successorId: string;
  type: SchedulingLinkType;
  /** Latência em ms de tempo útil; negativa = antecipação (lead). */
  lagMs: number;
}

export interface ScheduleOptions {
  tasks: readonly ScheduleTaskInput[];
  links: readonly ScheduleLinkInput[];
  calendar: Calendar;
  /** Primeira data possível das automáticas sem predecessor. */
  projectStart?: number;
  /** Referência do backward pass (padrão: maior término calculado). */
  projectEnd?: number;
  /** Soma das unidades (0..n) por tarefa; padrão 1. */
  units?: Record<string, number>;
  /** Calendários próprios por id (tarefa → calendário distinto do projeto). */
  calendars?: Record<string, Calendar>;
  /**
   * Recálculo incremental (specs/scheduling): com um baseline e o conjunto
   * de tarefas alteradas, recalcula apenas a cadeia afetada e remenda o
   * resultado anterior. Quando a diferença escapa do fecho (ciclo, envelope
   * do projeto, entrada estrutural), o pipeline cai no recálculo completo.
   */
  incremental?: {
    baseline: ScheduleResult;
    changedIds: readonly string[];
  };
}

/** Motivo de uma tarefa ficar fora do cálculo. */
export type ScheduleExclusion = "inactive" | "cycle" | "pending";

export type ScheduleConflictKind = "constraint" | "deadline" | "cycle";

/** Origem da data calculada de uma tarefa (Task Inspector). */
export type ScheduleReasonSource =
  | "project"
  | "manual"
  | "segments"
  | "rollup"
  | "constraint"
  | "predecessor";

/** Motivo do agendamento de uma tarefa, pronto para exibição. */
export interface ScheduleReason {
  source: ScheduleReasonSource;
  /** Predecessor determinante (quando `source` é `predecessor`). */
  predecessorId: string | null;
  linkType: SchedulingLinkType | null;
  /** Latência do vínculo determinante, em ms. */
  lagMs: number;
  /** Texto em pt-BR explicando o cálculo. */
  text: string;
}

/** Conflito registrado pelo cálculo (specs/scheduling — "Restrição conflitante"). */
export interface ScheduleConflict {
  taskId: string;
  kind: ScheduleConflictKind;
  /** Código estável para a UI. */
  code: string;
  /** Mensagem em pt-BR pronta para exibição. */
  message: string;
}

export interface ScheduledTask {
  id: string;
  start: number | null;
  finish: number | null;
  duration: number | null;
  /** Trabalho derivado (ms de tempo útil): duração × unidades. */
  work: number | null;
  lateStart: number | null;
  lateFinish: number | null;
  /** Float total em ms de tempo útil. */
  totalFloat: number | null;
  /** Float livre em ms de tempo útil. */
  freeFloat: number | null;
  critical: boolean;
  /** Presente quando a tarefa não participou do cálculo. */
  excluded?: ScheduleExclusion;
}

/** Roll-up de um resumo: datas dos filhos ativos e divergência do top-down. */
export interface ScheduleRollup {
  start: number | null;
  finish: number | null;
  /** `true` quando datas manuais do resumo diferem do roll-up dos filhos. */
  divergent: boolean;
}

export interface ScheduleResult {
  /** Todas as entradas (mais as ocorrências de recorrência expandidas). */
  tasks: Record<string, ScheduledTask>;
  /** Ordem topológica de cálculo (ativos). */
  order: string[];
  /** Tarefas críticas em ordem de cálculo (múltiplos caminhos suportados). */
  criticalPath: string[];
  /** Ids de tarefas presas em ciclo (cálculo mantido para as demais). */
  cycles: string[];
  /** Conflitos registrados: restrições, prazos e ciclos. */
  conflicts: ScheduleConflict[];
  /** Roll-up por resumo (datas dos filhos ativos e divergência top-down). */
  rollups: Record<string, ScheduleRollup>;
  /**
   * Cadeia condutora por tarefa (Task Inspector): predecessores que de fato
   * determinam a data, do predecessor direto para trás.
   */
  chains: Record<string, string[]>;
  /** Motivo do agendamento por tarefa (Task Inspector). */
  reasons: Record<string, ScheduleReason>;
  projectStart: number;
  projectFinish: number;
  /** Origem do cálculo: incremental (só a cadeia afetada) ou completo. */
  meta: { incremental: boolean };
}
