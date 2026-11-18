import { formatWbsCode, validateCustomCode, wbsPath } from "@ontarget/core";
import { applyPredecessors } from "../shared/predecessors";
import { applyResourceList } from "../shared/assignments";
import { selectWbsMask, useDomainStore } from "../../store/domainStore";
import type { Task } from "../../store/types";
import type { CellType } from "./cells";

/** Definição estática de uma coluna da Task Sheet. */
export interface ColumnDef {
  key: string;
  label: string;
  width: number;
  numeric?: boolean;
  /** Coluna fixa durante a rolagem horizontal. */
  sticky?: "start";
  /** Tipo do editor inline; ausente = coluna somente leitura. */
  type?: CellType;
  /** Opções para o editor do tipo `list`. */
  options?: readonly string[];
  /** Converte o valor editado em patch da tarefa. */
  apply?: (task: Task, value: unknown) => Partial<Task>;
  /**
   * Confirmação especial (colunas que não viram patch de tarefa).
   * Devolve os erros em pt-BR para exibição.
   */
  commit?: (taskId: string, raw: string) => string[];
}

/** Estado configurável por coluna (largura, visibilidade e ordem). */
export interface ColumnState {
  key: string;
  visible: boolean;
  width: number;
}

export const COLUMNS: ColumnDef[] = [
  { key: "toggle", label: "", width: 28, sticky: "start" },
  {
    key: "wbs",
    label: "WBS",
    width: 76,
    sticky: "start",
    type: "text",
    // código de estrutura: validação de duplicidade antes de gravar
    commit: (taskId, raw) => {
      const domain = useDomainStore.getState();
      const task = domain.tasks[taskId];
      if (!task) return ["Tarefa não encontrada."];

      // os códigos em uso incluem os derivados da máscara (a coluna os exibe)
      const mask = selectWbsMask(domain);
      const inUse = Object.values(domain.tasks).map((entry) => ({
        id: entry.id,
        wbsCode:
          entry.wbsCode ??
          (mask ? formatWbsCode(mask, wbsPath(entry.outlineNumber)) : entry.outlineNumber),
        outlineNumber: entry.outlineNumber,
      }));
      const result = validateCustomCode(raw, inUse, taskId);
      if (!result.ok) return [result.reason ?? "Código inválido."];

      // igual ao código gerado → volta a ser derivado (sem cópia pessoal)
      const trimmed = raw.trim();
      const derived = mask
        ? formatWbsCode(mask, wbsPath(task.outlineNumber))
        : task.outlineNumber;
      domain.updateTask(taskId, { wbsCode: trimmed === derived ? null : trimmed });
      return [];
    },
  },
  {
    key: "name",
    label: "Nome da tarefa",
    width: 320,
    sticky: "start",
    type: "text",
    apply: (_task, value) => ({ name: String(value) }),
  },
  // indicadores gráficos dos campos personalizados (somente leitura)
  { key: "indicator", label: "⚑", width: 64 },
  {
    key: "pred",
    label: "Predecessores",
    width: 110,
    type: "text",
    commit: (taskId, raw) => applyPredecessors(taskId, raw).errors,
  },
  {
    key: "res",
    label: "Recursos",
    width: 130,
    type: "list",
    commit: (taskId, raw) => applyResourceList(taskId, raw).errors,
  },
  {
    key: "start",
    label: "Início",
    width: 96,
    numeric: true,
    type: "date",
    apply: (_task, value) => ({ start: value as number, manualStart: value as number }),
  },
  {
    key: "finish",
    label: "Término",
    width: 96,
    numeric: true,
    type: "date",
    apply: (_task, value) => ({ finish: value as number, manualFinish: value as number }),
  },
  {
    key: "duration",
    label: "Duração",
    width: 88,
    numeric: true,
    type: "duration",
    apply: (_task, value) => ({ duration: value as number, durationUnit: "day" }),
  },
  {
    key: "percent",
    label: "%",
    width: 56,
    numeric: true,
    type: "percent",
    apply: (_task, value) => ({ percentComplete: value as number }),
  },
  // --- Tracking Gantt (specs/tracking — "Tracking Gantt") -------------------
  { key: "devStart", label: "Desvio início", width: 96, numeric: true },
  { key: "devFinish", label: "Desvio término", width: 96, numeric: true },
  { key: "devDuration", label: "Desvio duração", width: 96, numeric: true },
  { key: "devCost", label: "Desvio custo", width: 110, numeric: true },
];

/** Colunas de desvio: visíveis por padrão apenas na visão de Controle. */
export const TRACKING_ONLY_COLUMNS: string[] = [
  "devStart",
  "devFinish",
  "devDuration",
  "devCost",
];

export const COLUMN_DEFS: Record<string, ColumnDef> = Object.fromEntries(
  COLUMNS.map((column) => [column.key, column]),
);

/** Chave dinâmica de coluna de um campo personalizado (`cf:<id>`). */
export const isCustomColumnKey = (key: string): boolean => key.startsWith("cf:");

/** Estado padrão de todas as colunas, visíveis, na ordem canônica. */
export function defaultColumnState(): ColumnState[] {
  return COLUMNS.map((column) => ({ key: column.key, visible: true, width: column.width }));
}

/** Template CSS das colunas visíveis. */
export function buildTemplate(state: ColumnState[]): string {
  return state
    .filter((column) => column.visible)
    .map((column) => `${Math.max(48, column.width)}px`)
    .join(" ");
}

/** Offset esquerdo de cada coluna fixa visível (para `position: sticky`). */
export function stickyOffsets(state: ColumnState[]): Record<string, number> {
  const offsets: Record<string, number> = {};
  let accumulated = 0;

  for (const column of state) {
    if (!column.visible) continue;
    const def = COLUMN_DEFS[column.key];
    if (!def?.sticky) break;
    offsets[column.key] = accumulated;
    accumulated += Math.max(48, column.width);
  }

  return offsets;
}

/**
 * Colunas visíveis, na ordem configurada.
 * `extra` resolve as colunas dinâmicas (campos personalizados).
 */
export function visibleColumns(
  state: ColumnState[],
  extra: readonly ColumnDef[] = [],
): ColumnDef[] {
  const dynamic = new Map(extra.map((def) => [def.key, def]));
  return state
    .filter((column) => column.visible)
    .map((column) => COLUMN_DEFS[column.key] ?? dynamic.get(column.key))
    .filter((def): def is ColumnDef => Boolean(def));
}
