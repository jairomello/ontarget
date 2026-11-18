/**
 * Sincronização de rolagem vertical entre a Task Sheet e o Gantt
 * (docs/architecture.md §7.1 — "scroll compartilhado").
 *
 * Apenas o eixo vertical é compartilhado: as colunas da grade e a escala do
 * Gantt têm conteúdos de larguras diferentes.
 */

export interface ScrollState {
  top: number;
}

type Listener = (state: ScrollState, source: string) => void;

const listeners = new Set<Listener>();

export function subscribeScroll(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyScroll(source: string, top: number): void {
  for (const listener of listeners) listener({ top }, source);
}

/** Apenas para testes. */
export function resetScrollListeners(): void {
  listeners.clear();
}
