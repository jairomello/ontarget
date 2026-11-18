/**
 * Grafo de dependências do agendamento (docs/architecture.md §8.3, etapa 3).
 *
 * Constrói arestas predecessor → sucessor a partir dos vínculos e devolve uma
 * ordem topológica estável (Kahn, preservando a ordem de entrada) — ciclos
 * ficam de fora, identificados em `cyclic`, para que o restante do projeto
 * seja calculado (specs/scheduling — "Detecção de ciclos").
 */
import type { ScheduleLinkInput } from "./types";

export interface DependencyGraph {
  /** Ordem topológica dos nós sem ciclo (estável pela ordem de entrada). */
  order: string[];
  /** Nós que participam (ou descem) de um ciclo. */
  cyclic: string[];
  /** Vínculos de entrada por nó. */
  predecessors: Map<string, ScheduleLinkInput[]>;
  /** Vínculos de saída por nó. */
  successors: Map<string, ScheduleLinkInput[]>;
}

export function buildGraph(
  nodes: readonly string[],
  links: readonly ScheduleLinkInput[],
): DependencyGraph {
  const present = new Set(nodes);
  const predecessors = new Map<string, ScheduleLinkInput[]>();
  const successors = new Map<string, ScheduleLinkInput[]>();
  const indegree = new Map<string, number>();

  for (const id of nodes) {
    predecessors.set(id, []);
    successors.set(id, []);
    indegree.set(id, 0);
  }

  // Apenas vínculos cujas duas pontas participam do cálculo.
  for (const link of links) {
    if (!present.has(link.predecessorId) || !present.has(link.successorId)) continue;
    if (link.predecessorId === link.successorId) continue;

    successors.get(link.predecessorId)!.push(link);
    predecessors.get(link.successorId)!.push(link);
    indegree.set(link.successorId, (indegree.get(link.successorId) ?? 0) + 1);
  }

  const order: string[] = [];
  const queue = nodes.filter((id) => indegree.get(id) === 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);

    for (const link of successors.get(id) ?? []) {
      const next = indegree.get(link.successorId)! - 1;
      indegree.set(link.successorId, next);
      if (next === 0) queue.push(link.successorId);
    }
  }

  const placed = new Set(order);
  const cyclic = nodes.filter((id) => !placed.has(id));
  return { order, cyclic, predecessors, successors };
}
