import { DAY_MS, WORKDAY_MS } from "@ontarget/core";
import { useMemo } from "react";
import { useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import type { Baseline, BaselineValue, Id, Task } from "../../store/types";

/**
 * Tracking Gantt (specs/tracking — "Tracking Gantt" e "Valores de desvio por
 * baseline"): baseline selecionada, desvios por tarefa e desvio acumulado do
 * projeto.
 */

export interface SelectedBaseline {
  baseline: Baseline | null;
  /** taskId → valores capturados da baseline selecionada. */
  values: Record<Id, BaselineValue>;
}

/** Resolve a baseline escolhida (ou a mais recente) a partir dos índices. */
export function resolveSelectedBaseline(
  baselines: Record<Id, Baseline>,
  baselineValues: Record<Id, Record<Id, BaselineValue>>,
  selected: Id | null,
): SelectedBaseline {
  const list = Object.values(baselines);
  if (list.length === 0) return { baseline: null, values: {} };

  const chosen =
    (selected !== null ? baselines[selected] : undefined) ??
    list.slice().sort((a, b) => b.savedAt - a.savedAt)[0];

  if (!chosen) return { baseline: null, values: {} };
  return { baseline: chosen, values: baselineValues[chosen.id] ?? {} };
}

/**
 * Baseline selecionada para o Tracking: a escolhida pelo usuário ou, por
 * padrão, a mais recente salva.
 */
export function useSelectedBaseline(): SelectedBaseline {
  const baselines = useDomainStore((state) => state.baselines);
  const baselineValues = useDomainStore((state) => state.baselineValues);
  const selected = useUiStore((state) => state.trackingBaselineId);

  return useMemo(
    () => resolveSelectedBaseline(baselines, baselineValues, selected),
    [baselines, baselineValues, selected],
  );
}

/** Leitura pontual (sem hook) a partir do estado atual dos stores. */
export function currentSelectedBaseline(): SelectedBaseline {
  const domain = useDomainStore.getState();
  return resolveSelectedBaseline(
    domain.baselines,
    domain.baselineValues,
    useUiStore.getState().trackingBaselineId,
  );
}

/* ------------------------------------------------------- formatadores ------ */

/** Desvio em dias com sinal (`+2d`, `-1d`, `0d`, `+1,5d`). */
export function formatSignedDays(value: number): string {
  const rounded = Number(value.toFixed(2));
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${text}d`;
}

/** Desvio em custo com sinal, em pt-BR (`+R$ 1.200,00`, `-R$ 300`). */
export function formatSignedCost(value: number): string {
  const formatted = Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value > 0) return `+R$ ${formatted}`;
  if (value < 0) return `-R$ ${formatted}`;
  return `R$ ${formatted}`;
}

/** Chaves das colunas de desvio. */
export const DEVIATION_KEYS = ["devStart", "devFinish", "devDuration", "devCost"] as const;
export type DeviationKey = (typeof DEVIATION_KEYS)[number];

/**
 * Valor bruto da coluna de desvio para uma tarefa: dias corridos para
 * início/término, dias de duração (unidade de 8 h) e custo em reais.
 * `null` quando a tarefa não tem linha na baseline selecionada.
 */
export function deviationValue(
  key: DeviationKey,
  task: Task,
  baseline: Baseline | null,
  values: Record<Id, BaselineValue>,
): number | null {
  if (!baseline) return null;
  const value = values[task.id];
  if (!value) return null;

  switch (key) {
    case "devStart":
      if (task.start === null || value.start === null) return null;
      return Math.round((task.start - value.start) / DAY_MS);
    case "devFinish":
      if (task.finish === null || value.finish === null) return null;
      return Math.round((task.finish - value.finish) / DAY_MS);
    case "devDuration": {
      if (task.duration === null || value.duration === null) return null;
      return Number((((task.duration - value.duration) / WORKDAY_MS)).toFixed(2));
    }
    case "devCost":
      return (task.cost ?? 0) - (value.cost ?? 0);
    default:
      return null;
  }
}

/** Texto de uma coluna de desvio (`+2d`, `-R$ 300`, `—`). */
export function deviationText(
  key: DeviationKey,
  task: Task,
  baseline: Baseline | null,
  values: Record<Id, BaselineValue>,
): string {
  const value = deviationValue(key, task, baseline, values);
  if (value === null) return "—";
  if (key === "devCost") return formatSignedCost(value);
  return formatSignedDays(value);
}

/**
 * Desvio acumulado do projeto: diferença entre o maior término atual e o
 * maior término da baseline, em dias corridos (`null` sem baseline usada).
 */
export function projectFinishDeviation(
  tasks: Record<Id, Task>,
  values: Record<Id, BaselineValue>,
): number | null {
  let current: number | null = null;
  let planned: number | null = null;

  for (const [id, value] of Object.entries(values)) {
    const task = tasks[id];
    if (!task || task.finish === null || value.finish === null) continue;
    if (current === null || task.finish > current) current = task.finish;
    if (planned === null || value.finish > planned) planned = value.finish;
  }

  if (current === null || planned === null) return null;
  return Math.round((current - planned) / DAY_MS);
}
