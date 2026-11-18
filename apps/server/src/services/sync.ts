import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index";
import * as t from "../db/schema";

/**
 * Sincronização em lote (specs/persistence — "Gravação automática em lote"
 * e "Gravação idempotente").
 *
 * O cliente marca entidades como sujas e envia um único lote; cada linha é
 * aplicada por chave primária (`ON CONFLICT DO UPDATE`), de modo que reenviar
 * o mesmo lote não duplica nem corrompe dados.
 */

export interface SyncBatch {
  upserts?: Record<string, Array<Record<string, unknown>>>;
  deletes?: Record<string, Array<string | [string, string]>>;
}

export interface SyncResult {
  upserted: Record<string, number>;
  deleted: Record<string, number>;
}

interface TableSpec {
  table: any;
  /** Colunas-alvo do `ON CONFLICT` (objetos de coluna do Drizzle). */
  target: any[];
  /** Coluna e chave JS do projeto, quando a linha é ancorada nele. */
  projectField?: any;
  projectKey?: string;
  /**
   * A entidade aceita linhas da biblioteca global (`projectId` nulo) além
   * das do projeto aberto (specs/views-and-filters — "Biblioteca global").
   */
  allowGlobal?: boolean;
  /** Colunas da chave primária composta (objetos de coluna). */
  composite?: any[];
  /** Correspondentes chaves JS da linha enviada pelo cliente. */
  compositeKeys?: string[];
}

const TABLES: Record<string, TableSpec> = {
  projects: { table: t.projects, target: [t.projects.id] },
  calendars: {
    table: t.calendars,
    target: [t.calendars.id],
    projectField: t.calendars.projectId,
    projectKey: "projectId",
  },
  calendar_exceptions: {
    table: t.calendarExceptions,
    target: [t.calendarExceptions.id],
  },
  tasks: {
    table: t.tasks,
    target: [t.tasks.id],
    projectField: t.tasks.projectId,
    projectKey: "projectId",
  },
  task_links: {
    table: t.taskLinks,
    target: [t.taskLinks.id],
    projectField: t.taskLinks.projectId,
    projectKey: "projectId",
  },
  teams: { table: t.teams, target: [t.teams.id] },
  resources: {
    table: t.resources,
    target: [t.resources.id],
    projectField: t.resources.projectId,
    projectKey: "projectId",
  },
  assignments: {
    table: t.assignments,
    target: [t.assignments.id],
    projectField: t.assignments.projectId,
    projectKey: "projectId",
  },
  baselines: {
    table: t.baselines,
    target: [t.baselines.id],
    projectField: t.baselines.projectId,
    projectKey: "projectId",
  },
  baseline_values: {
    table: t.baselineValues,
    composite: [t.baselineValues.baselineId, t.baselineValues.taskId],
    compositeKeys: ["baselineId", "taskId"],
    target: [t.baselineValues.baselineId, t.baselineValues.taskId],
  },
  custom_fields: {
    table: t.customFields,
    target: [t.customFields.id],
    projectField: t.customFields.projectId,
    projectKey: "projectId",
  },
  custom_field_values: {
    table: t.customFieldValues,
    composite: [t.customFieldValues.fieldId, t.customFieldValues.entityId],
    compositeKeys: ["fieldId", "entityId"],
    target: [t.customFieldValues.fieldId, t.customFieldValues.entityId],
  },
  library_items: {
    table: t.libraryItems,
    target: [t.libraryItems.id],
    projectField: t.libraryItems.projectId,
    projectKey: "projectId",
    allowGlobal: true,
  },
  import_templates: { table: t.importTemplates, target: [t.importTemplates.id] },
};

export class SyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/** Lê a linha atual pela chave primária (simples ou composta). */
function readRow(
  tx: Db,
  spec: TableSpec,
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (spec.composite && spec.compositeKeys) {
    const [first, second] = spec.composite;
    const keyA = spec.compositeKeys[0]!;
    const keyB = spec.compositeKeys[1]!;
    const row = tx
      .select()
      .from(spec.table)
      .where(sql`${first} = ${value[keyA]} AND ${second} = ${value[keyB]}`)
      .get();
    return row as Record<string, unknown> | undefined;
  }
  const row = tx.select().from(spec.table).where(eq(spec.table.id, value.id)).get();
  return row as Record<string, unknown> | undefined;
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/**
 * Registra em `change_log` campo a campo o que mudou (specs/persistence —
 * "Histórico de alterações"), alimentando o realce de alterações.
 */
function logChanges(
  tx: Db,
  projectId: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | null,
): void {
  const changedAt = Date.now();
  // Atualizações são parciais: só os campos presentes no lote contam.
  // Em remoções (after = null) registra todos os campos da linha apagada.
  const fields = after ? Object.keys(after) : Object.keys(before ?? {});

  for (const field of fields) {
    const oldValue = before ? serialize(before[field]) : null;
    const newValue = after ? serialize(after[field]) : null;
    if (oldValue === newValue) continue;

    tx.insert(t.changeLog)
      .values({
        projectId,
        entityType,
        entityId,
        field,
        oldValue,
        newValue,
        changedAt,
      })
      .run();
  }
}

export function applySync(db: Db, projectId: string, batch: SyncBatch): SyncResult {
  const result: SyncResult = { upserted: {}, deleted: {} };
  db.transaction((tx) => {
    applySyncTx(tx, projectId, batch, result);
  });
  return result;
}

/**
 * Mesma aplicação, dentro de uma transação do chamador — usada pela
 * importação, que precisa ordenar remoções e gravações no mesmo `tx`
 * (specs/import-export — "Importação transacional").
 */
export function applySyncTx(
  tx: Db,
  projectId: string,
  batch: SyncBatch,
  result: SyncResult = { upserted: {}, deleted: {} },
): SyncResult {
  for (const name of Object.keys(batch.upserts ?? {})) {
    if (!TABLES[name]) throw new SyncError("unknown_entity", `Entidade desconhecida: ${name}`);
  }
  for (const name of Object.keys(batch.deletes ?? {})) {
    if (!TABLES[name]) throw new SyncError("unknown_entity", `Entidade desconhecida: ${name}`);
  }

  {
    // Remoções primeiro: liberam chaves únicas (ex.: `sort_order` de tasks)
    // que os upserts do mesmo lote precisam reutilizar — na ordem contrária,
    // o upsert colidia com a linha que ia ser excluída (UNIQUE constraint).
    for (const [name, keys] of Object.entries(batch.deletes ?? {})) {
      const spec = TABLES[name]!;
      if (keys.length === 0) continue;

      if (spec.composite) {
        const [first, second] = spec.composite;
        const pairs = keys as Array<[string, string]>;
        const orConditions = pairs.map((pair) =>
          sql`(${first} = ${pair[0]} AND ${second} = ${pair[1]})`,
        );
        const condition = sql.join(orConditions, sql` OR `);
        const existing = tx.select().from(spec.table).where(condition).all() as Array<
          Record<string, unknown>
        >;
        tx.delete(spec.table).where(condition).run();
        for (const row of existing) {
          logChanges(
            tx,
            projectId,
            name,
            `${String(row[spec.compositeKeys![0]!])}|${String(row[spec.compositeKeys![1]!])}`,
            row,
            null,
          );
        }
        result.deleted[name] = (result.deleted[name] ?? 0) + existing.length;
        continue;
      }

      const ids = keys as string[];
      const inIds = sql`${spec.table.id} IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`;
      // Com `allowGlobal`, a exclusão alcança os itens da biblioteca
      // global (project_id nulo), mas continua bloqueada para outros projetos.
      const scoped = spec.projectField
        ? spec.allowGlobal
          ? sql`(${spec.projectField} = ${projectId} OR ${spec.projectField} IS NULL) AND ${inIds}`
          : sql`${spec.projectField} = ${projectId} AND ${inIds}`
        : inIds;

      const existing = tx.select().from(spec.table).where(scoped).all() as Array<
        Record<string, unknown>
      >;
      tx.delete(spec.table).where(scoped).run();
      for (const row of existing) {
        logChanges(tx, projectId, name, String(row.id), row, null);
      }
      result.deleted[name] = (result.deleted[name] ?? 0) + existing.length;
    }

    // `tasks.sort_order` é único por projeto e um lote de reordenação troca
    // posições entre as próprias linhas: cada upsert intermediário violaria o
    // índice único. Neutraliza as linhas do lote (mesma técnica da
    // importação) e devolve o valor final no próprio upsert; o valor anterior
    // é guardado para o change_log não registrar o estado temporário.
    const taskRows = batch.upserts?.tasks ?? [];
    const originalSort = new Map<string, unknown>();
    if (taskRows.length > 0) {
      const ids = taskRows
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ids.length > 0) {
        const scope = and(eq(t.tasks.projectId, projectId), inArray(t.tasks.id, ids));
        const current = tx
          .select({ id: t.tasks.id, sortOrder: t.tasks.sortOrder })
          .from(t.tasks)
          .where(scope)
          .all();
        const reordered = current.some(
          (row) => taskRows.find((candidate) => candidate.id === row.id)?.sortOrder !== row.sortOrder,
        );

        if (reordered) {
          for (const row of current) originalSort.set(String(row.id), row.sortOrder);
          tx.update(t.tasks).set({ sortOrder: sql`-rowid` }).where(scope).run();
        }
      }
    }

    for (const [name, rows] of Object.entries(batch.upserts ?? {})) {
      const spec = TABLES[name]!;
      for (const row of rows) {
        const value: Record<string, unknown> = { ...row };

        if (spec.projectField && spec.projectKey) {
          const key = spec.projectKey;
          const current = value[key];
          // `null` explícito em entidade que aceita global = item da
          // biblioteca global (fica sem projeto); os demais casos são do
          // projeto aberto ou rejeitados como escrita cruzada.
          if (!(spec.allowGlobal && current === null)) {
            if (current !== undefined && current !== null && current !== projectId) {
              throw new SyncError(
                "cross_project_write",
                `Linha de ${name} pertence a outro projeto`,
              );
            }
            value[key] = projectId;
          }
        }

        const missing = spec.compositeKeys
          ? spec.compositeKeys.some((key) => value[key] === undefined || value[key] === null)
          : value.id === undefined || value.id === null;
        if (missing) {
          throw new SyncError("missing_key", `Linha de ${name} sem chave primária`);
        }

        const before = readRow(tx, spec, value);
        // devolve o `sort_order` anterior quando a neutralização acima rodou
        if (before && name === "tasks") {
          const original = originalSort.get(String(value.id));
          if (original !== undefined) before.sortOrder = original;
        }

        tx.insert(spec.table)
          .values(value as any)
          .onConflictDoUpdate({ target: spec.target, set: value as any })
          .run();

        const entityId = spec.compositeKeys
          ? `${String(value[spec.compositeKeys[0]!])}|${String(value[spec.compositeKeys[1]!])}`
          : String(value.id);
        logChanges(tx, projectId, name, entityId, before, value);

        result.upserted[name] = (result.upserted[name] ?? 0) + 1;
      }
    }
  }

  return result;
}

/** Conta linhas de uma entidade no projeto (utilitário de teste/verificação). */
export function countEntity(db: Db, projectId: string, name: string): number {
  const spec = TABLES[name];
  if (!spec) throw new SyncError("unknown_entity", `Entidade desconhecida: ${name}`);
  if (!spec.projectField) return -1;

  const rows = db
    .select({ value: sql<number>`COUNT(*)` })
    .from(spec.table)
    .where(sql`${spec.projectField} = ${projectId}`)
    .all();
  return Number(rows[0]?.value ?? 0);
}
