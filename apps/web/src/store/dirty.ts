/**
 * Barramento de "sujidade" de domínio.
 *
 * As ações do `domainStore` emitem aqui; a camada de persistência
 * (SyncQueue) assina e envia em lote. A UI nunca passa por este canal —
 * é o que separa estado editável de estado de apresentação.
 */

export type DirtyKind = "upsert" | "delete";

/**
 * Chave de uma linha suja: id simples ou tupla da chave primária composta
 * (`baseline_values` usa `[baselineId, taskId]`).
 */
export type DirtyKey = string | [string, string];

export interface DirtyEvent {
  entity: string;
  key: DirtyKey;
  kind: DirtyKind;
  /** Linha completa para upsert; ausente para delete. */
  row?: Record<string, unknown>;
}

type Listener = (event: DirtyEvent) => void;

const listeners = new Set<Listener>();

export function onDirty(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitDirty(event: DirtyEvent): void {
  for (const listener of listeners) listener(event);
}

/** Apenas para testes: limpa assinantes. */
export function resetDirtyListeners(): void {
  listeners.clear();
}
