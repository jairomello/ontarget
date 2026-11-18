import { validateLink, type LinkRejection } from "@ontarget/core";
import type { DomainState } from "../../store/domainStore";
import type { Id, LinkType } from "../../store/types";

export type { LinkRejection };

export type LinkDecision = { ok: true } | { ok: false; reason: LinkRejection };

/** `candidate` é descendente de `ancestor` na árvore de tarefas? */
export function isDescendant(state: DomainState, candidate: Id, ancestor: Id): boolean {
  let current = state.tasks[candidate]?.parentId ?? null;
  const guard = new Set<string>();

  while (current !== null) {
    if (current === ancestor) return true;
    if (guard.has(current)) return false;
    guard.add(current);
    current = state.tasks[current]?.parentId ?? null;
  }
  return false;
}

/** Existe vínculo `from → to` em algum tipo? */
export function hasLink(state: DomainState, from: Id, to: Id): boolean {
  return Object.values(state.taskLinks).some(
    (link) => link.predecessorId === from && link.successorId === to,
  );
}

/** Seguindo os sucessores de `start`, alcança `target`? (detecta ciclo) */
export function reaches(state: DomainState, start: Id, target: Id): boolean {
  const queue = [start];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const link of Object.values(state.taskLinks)) {
      if (link.predecessorId === current) queue.push(link.successorId);
    }
  }
  return false;
}

/**
 * Pode criar o vínculo `from → to`?
 * Delega à validação única do domínio (`core.validateLink`), a mesma que
 * barra a criação pela coluna, pelo formulário e pelo Gantt
 * (specs/task-dependencies — "Validação de vínculos").
 */
export function canLink(state: DomainState, from: Id, to: Id): LinkDecision {
  const validation = validateLink(
    { predecessorId: from, successorId: to },
    Object.values(state.tasks),
    Object.values(state.taskLinks),
  );
  return validation.ok ? { ok: true } : { ok: false, reason: validation.reason! };
}

/**
 * Identificador determinístico de um vínculo: a mesma tripla
 * (origem, destino, tipo) gera sempre o mesmo id — o que torna a gravação
 * idempotente e impede duplicatas no banco.
 */
export function linkId(from: Id, to: Id, type: LinkType): string {
  return `link:${from}:${to}:${type}`;
}
