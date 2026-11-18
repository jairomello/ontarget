/**
 * Validação de vínculos (specs/task-dependencies — "Validação de vínculos").
 *
 * Toda criação passa por aqui — coluna de predecessores, formulário e
 * arraste no Gantt — para que os três caminhos recusem exatamente as
 * mesmas entradas. Função pura: sem I/O, sem DOM.
 */

/** Motivo da recusa de um vínculo. */
export type LinkRejection = "self" | "descendant" | "duplicate" | "cycle" | "missing";

/** Referência mínima de tarefa para a validação (id + hierarquia). */
export interface LinkTaskRef {
  id: string;
  parentId?: string | null;
}

/** Vínculo existente mínimo. */
export interface LinkRef {
  predecessorId: string;
  successorId: string;
}

export interface LinkValidationResult {
  ok: boolean;
  /** Motivo da recusa (quando `ok` é falso). */
  reason?: LinkRejection;
  /** Mensagem em pt-BR pronta para exibição. */
  message?: string;
  /**
   * Caminho que formaria o ciclo, do sucessor até o predecessor
   * (specs/scheduling — "Detecção de ciclos").
   */
  path?: string[];
}

export const LINK_REJECTION_MESSAGES: Record<LinkRejection, string> = {
  self: "Uma tarefa não pode depender de si mesma",
  descendant: "Uma tarefa não pode depender de sua própria subtarefa",
  duplicate: "Já existe este vínculo",
  cycle: "O vínculo criaria um ciclo de dependências",
  missing: "Tarefa de origem ou destino não encontrada",
};

function reject(reason: LinkRejection, path?: string[]): LinkValidationResult {
  return { ok: false, reason, message: LINK_REJECTION_MESSAGES[reason], path };
}

/**
 * Pode criar o vínculo `predecessorId → successorId`?
 * Ordem das recusas: inexistente, autovínculo, subtarefa, duplicata, ciclo.
 */
export function validateLink(
  candidate: LinkRef,
  tasks: readonly LinkTaskRef[],
  links: readonly LinkRef[],
): LinkValidationResult {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const { predecessorId, successorId } = candidate;

  // tarefa inexistente
  if (!byId.has(predecessorId) || !byId.has(successorId)) return reject("missing");

  // autovínculo
  if (predecessorId === successorId) return reject("self");

  // o destino é subtree do origem? (pai → filho criaria ciclo com o roll-up)
  const parents = new Map(tasks.map((task) => [task.id, task.parentId ?? null]));
  {
    let current = parents.get(successorId) ?? null;
    const guard = new Set<string>();
    while (current !== null) {
      if (current === predecessorId) return reject("descendant");
      if (guard.has(current)) break;
      guard.add(current);
      current = parents.get(current) ?? null;
    }
  }

  // duplicata (o mesmo par já vinculado, em qualquer tipo)
  const duplicate = links.some(
    (link) => link.predecessorId === predecessorId && link.successorId === successorId,
  );
  if (duplicate) return reject("duplicate");

  // ciclo: alcançando a origem a partir do destino?
  const next = new Map<string, string[]>();
  for (const link of links) {
    const list = next.get(link.predecessorId);
    if (list) list.push(link.successorId);
    else next.set(link.predecessorId, [link.successorId]);
  }

  const previous = new Map<string, string>();
  const queue = [successorId];
  const seen = new Set<string>([successorId]);
  let found = false;

  while (queue.length > 0 && !found) {
    const current = queue.shift()!;
    for (const adjacent of next.get(current) ?? []) {
      if (adjacent === predecessorId) {
        previous.set(adjacent, current);
        found = true;
        break;
      }
      if (seen.has(adjacent)) continue;
      seen.add(adjacent);
      previous.set(adjacent, current);
      queue.push(adjacent);
    }
  }

  if (found) {
    const path = [predecessorId];
    let cursor = predecessorId;
    while (cursor !== successorId) {
      cursor = previous.get(cursor)!;
      path.push(cursor);
    }
    // ordem de leitura: do sucessor até o predecessor (o caminho de volta).
    path.reverse();
    return reject("cycle", path);
  }

  return { ok: true };
}
