/**
 * Fila de sincronização em lote (specs/persistence).
 *
 * Marca entidades como sujas e envia um único lote após 800 ms de inatividade.
 * Se o envio falhar, as alterações permanecem sujas e são reenviadas.
 */

import type { DirtyKey } from "../store/dirty";

export interface SyncBatch {
  upserts?: Record<string, Array<Record<string, unknown>>>;
  /** Ids simples ou tuplas da chave primária composta. */
  deletes?: Record<string, Array<DirtyKey>>;
}

export type SyncSender = (projectId: string, batch: SyncBatch) => Promise<unknown>;

export interface SyncQueueOptions {
  projectId: string;
  send: SyncSender;
  /** Padrão: 800 ms (specs/persistence). */
  debounceMs?: number;
  onError?: (error: unknown) => void;
}

interface PendingUpsert {
  key: string;
  row: Record<string, unknown>;
}

export class SyncQueue {
  private readonly projectId: string;
  private readonly send: SyncSender;
  /** Janela de debounce em ms (padrão 800). */
  readonly debounceMs: number;
  private readonly onError?: (error: unknown) => void;

  private readonly upserts = new Map<string, Map<string, PendingUpsert>>();
  /** entity → chave codificada (JSON) → chave enviada no lote. */
  private readonly deletes = new Map<string, Map<string, DirtyKey>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;

  constructor(options: SyncQueueOptions) {
    this.projectId = options.projectId;
    this.send = options.send;
    this.debounceMs = options.debounceMs ?? 800;
    this.onError = options.onError;
  }

  /** Marca uma linha para gravação; uma linha marcada como excluída limpa upsert pendente. */
  markUpsert(entity: string, key: DirtyKey, row: Record<string, unknown>): void {
    // A chave interna é sempre derivada da própria linha (`keyOf`) para que o
    // commit do lote a reconheça — inclusive em chaves compostas.
    void key;
    const rowKey = keyOf(row);
    let bucket = this.upserts.get(entity);
    if (!bucket) {
      bucket = new Map();
      this.upserts.set(entity, bucket);
    }
    bucket.set(rowKey, { key: rowKey, row });
    this.schedule();
  }

  /** Marca uma linha para remoção. */
  markDelete(entity: string, key: DirtyKey): void {
    const encoded = JSON.stringify(key);
    // cancela um upsert pendente da mesma linha (caminho simples: id único)
    if (typeof key === "string") this.upserts.get(entity)?.delete(key);
    let bucket = this.deletes.get(entity);
    if (!bucket) {
      bucket = new Map();
      this.deletes.set(entity, bucket);
    }
    bucket.set(encoded, key);
    this.schedule();
  }

  get isDirty(): boolean {
    for (const bucket of this.upserts.values()) if (bucket.size > 0) return true;
    for (const bucket of this.deletes.values()) if (bucket.size > 0) return true;
    return false;
  }

  /** Número de linhas pendentes (para exibir estado de salvamento). */
  get pendingCount(): number {
    let total = 0;
    for (const bucket of this.upserts.values()) total += bucket.size;
    for (const bucket of this.deletes.values()) total += bucket.size;
    return total;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Envia o lote pendente imediatamente. Idempotente no servidor. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight || !this.isDirty) return;

    const batch = this.buildBatch();
    if (!batch) return;

    this.inFlight = true;
    try {
      await this.send(this.projectId, batch);
      this.commit(batch);
    } catch (error) {
      // Mantém as linhas sujas para nova tentativa.
      this.onError?.(error);
    } finally {
      this.inFlight = false;
    }
  }

  private buildBatch(): SyncBatch | null {
    const upserts: NonNullable<SyncBatch["upserts"]> = {};
    for (const [entity, bucket] of this.upserts) {
      if (bucket.size === 0) continue;
      upserts[entity] = [...bucket.values()].map((entry) => entry.row);
    }

    const deletes: NonNullable<SyncBatch["deletes"]> = {};
    for (const [entity, keys] of this.deletes) {
      if (keys.size === 0) continue;
      deletes[entity] = [...keys.values()];
    }

    if (Object.keys(upserts).length === 0 && Object.keys(deletes).length === 0) return null;
    return { upserts, deletes };
  }

  /** Remove do sujo apenas o que foi enviado com sucesso. */
  private commit(batch: SyncBatch): void {
    for (const [entity, rows] of Object.entries(batch.upserts ?? {})) {
      const bucket = this.upserts.get(entity);
      if (!bucket) continue;
      for (const row of rows) {
        const key = keyOf(row);
        const current = bucket.get(key);
        // Se a linha mudou durante o envio, permanece suja.
        if (current && JSON.stringify(current.row) === JSON.stringify(row)) bucket.delete(key);
      }
    }
    for (const [entity, keys] of Object.entries(batch.deletes ?? {})) {
      const bucket = this.deletes.get(entity);
      if (!bucket) continue;
      for (const key of keys) bucket.delete(JSON.stringify(key));
    }
  }
}

/** Chave de identidade de uma linha para rastreamento de sujeira. */
export function keyOf(row: Record<string, unknown>): string {
  if (typeof row.id === "string") return row.id;
  return JSON.stringify([row.baselineId ?? null, row.taskId ?? null, row.fieldId ?? null, row.entityId ?? null]);
}
