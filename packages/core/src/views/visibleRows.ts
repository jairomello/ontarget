import type { GroupSummary } from "./query";

/**
 * Linhas visíveis da árvore de tarefas — fonte única usada pela Task Sheet
 * e pelo Gantt (docs/architecture.md §7.5). Qualquer divergência entre os
 * dois painéis é impossível por construção.
 */

export interface VisibleRowInput {
  /** Ids em pré-ordem (ordem de exibição). */
  order: readonly string[];
  /** `parentId` por id. */
  parents: Readonly<Record<string, string | null>>;
  /** Indica se a tarefa é resumo. */
  summaries: Readonly<Record<string, boolean>>;
  /** Nós recolhidos. */
  collapsed: Readonly<Record<string, boolean>>;
}

export interface VisibleRow {
  id: string;
  /** Profundidade na árvore (0 = raiz). */
  depth: number;
  isSummary: boolean;
  collapsed: boolean;
  /** Quantos descendentes estão ocultos por este nó (0 se aberto). */
  hidden: number;
  /**
   * Linha sintética de cabeçalho de grupo (specs/views-and-filters —
   * "Agrupamento"): não corresponde a nenhuma tarefa.
   */
  isGroup?: boolean;
  groupLabel?: string;
  groupDepth?: number;
  groupCount?: number;
  groupSummary?: GroupSummary;
}

/**
 * Calcula as linhas a exibir, respeitando o recolhimento da hierarquia.
 * Pré-ordem preservada; operação O(n) com pré-cálculo do tamanho das subárvores.
 */
export function visibleRows(input: VisibleRowInput): VisibleRow[] {
  const { order, parents, summaries, collapsed } = input;

  // Tamanho da subárvore (nós filhos, netos etc.) por nó.
  const subtreeSize = new Map<string, number>();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const id = order[index]!;
    const parentId = parents[id] ?? null;
    const own = subtreeSize.get(id) ?? 0;
    if (parentId !== null) {
      subtreeSize.set(parentId, (subtreeSize.get(parentId) ?? 0) + own + 1);
    }
  }

  const rows: VisibleRow[] = [];

  for (const id of order) {
    // Profundidade e verificação de ancestrais recolhidos.
    let depth = 0;
    let hiddenByAncestor = false;
    let parentId = parents[id] ?? null;

    while (parentId !== null) {
      if (collapsed[parentId]) {
        hiddenByAncestor = true;
        break;
      }
      depth += 1;
      parentId = parents[parentId] ?? null;
    }

    if (hiddenByAncestor) continue;

    const isSummary = Boolean(summaries[id]);
    const isCollapsed = Boolean(collapsed[id]);

    rows.push({
      id,
      depth,
      isSummary,
      collapsed: isCollapsed,
      hidden: isCollapsed && isSummary ? (subtreeSize.get(id) ?? 0) : 0,
    });
  }

  return rows;
}
