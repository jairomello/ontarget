import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index";
import * as t from "../db/schema";

/**
 * Serialização do agregado de um projeto.
 *
 * Usado por dois fluxos:
 *  - exclusão com desfazer (10 s) — specs/portfolio
 *  - snapshot de recuperação após falha — specs/persistence
 */
export interface AggregatePayload {
  version: 1;
  project: t.Project;
  calendars: t.Calendar[];
  calendarExceptions: Array<typeof t.calendarExceptions.$inferSelect>;
  tasks: t.Task[];
  taskLinks: t.TaskLink[];
  resources: t.Resource[];
  assignments: t.Assignment[];
  baselines: t.Baseline[];
  baselineValues: Array<typeof t.baselineValues.$inferSelect>;
  customFields: t.CustomField[];
  customFieldValues: Array<typeof t.customFieldValues.$inferSelect>;
  libraryItems: t.LibraryItem[];
}

export function serializeAggregate(db: Db, projectId: string): AggregatePayload | undefined {
  const project = db.select().from(t.projects).where(eq(t.projects.id, projectId)).get();
  if (!project) return undefined;

  const calendars = db.select().from(t.calendars).where(eq(t.calendars.projectId, projectId)).all();
  const calendarIds = calendars.map((c) => c.id);

  const tasks = db.select().from(t.tasks).where(eq(t.tasks.projectId, projectId)).all();
  const taskIds = tasks.map((task) => task.id);

  const resources = db.select().from(t.resources).where(eq(t.resources.projectId, projectId)).all();
  const resourceIds = resources.map((r) => r.id);

  const baselines = db.select().from(t.baselines).where(eq(t.baselines.projectId, projectId)).all();
  const baselineIds = baselines.map((b) => b.id);

  const customFields = db
    .select()
    .from(t.customFields)
    .where(eq(t.customFields.projectId, projectId))
    .all();
  const fieldIds = customFields.map((f) => f.id);

  return {
    version: 1,
    project,
    calendars,
    calendarExceptions:
      calendarIds.length > 0
        ? db.select().from(t.calendarExceptions).where(inArray(t.calendarExceptions.calendarId, calendarIds)).all()
        : [],
    tasks,
    taskLinks: db.select().from(t.taskLinks).where(eq(t.taskLinks.projectId, projectId)).all(),
    resources,
    assignments: db
      .select()
      .from(t.assignments)
      .where(eq(t.assignments.projectId, projectId))
      .all(),
    baselines,
    baselineValues:
      baselineIds.length > 0
        ? db.select().from(t.baselineValues).where(inArray(t.baselineValues.baselineId, baselineIds)).all()
        : [],
    customFields,
    customFieldValues:
      fieldIds.length > 0
        ? db.select().from(t.customFieldValues).where(inArray(t.customFieldValues.fieldId, fieldIds)).all()
        : [],
    libraryItems: db
      .select()
      .from(t.libraryItems)
      .where(eq(t.libraryItems.projectId, projectId))
      .all(),
  };
}

/**
 * Reinsere um agregado preservando os ids originais.
 * Só deve ser chamado depois que os dados atuais foram removidos.
 */
export function insertAggregate(db: Db, payload: AggregatePayload): void {
  db.transaction((tx) => insertAggregateRows(tx, payload));
}

/** Variante sem transação própria — usada quando já estamos dentro de uma. */
export function insertAggregateRows(tx: Db, payload: AggregatePayload): void {
  {
    tx.insert(t.projects)
      .values({ ...payload.project, calendarId: null })
      .run();

    for (const calendar of payload.calendars) {
      tx.insert(t.calendars).values(calendar).run();
    }
    for (const exception of payload.calendarExceptions) {
      tx.insert(t.calendarExceptions).values(exception).run();
    }

    if (payload.project.calendarId) {
      tx.update(t.projects)
        .set({ calendarId: payload.project.calendarId })
        .where(eq(t.projects.id, payload.project.id))
        .run();
    }

    for (const task of payload.tasks) {
      tx.insert(t.tasks).values({ ...task, parentId: null }).run();
    }
    for (const task of payload.tasks) {
      if (!task.parentId) continue;
      tx.update(t.tasks)
        .set({ parentId: task.parentId })
        .where(eq(t.tasks.id, task.id))
        .run();
    }

    for (const link of payload.taskLinks) tx.insert(t.taskLinks).values(link).run();
    for (const resource of payload.resources) tx.insert(t.resources).values(resource).run();
    for (const assignment of payload.assignments) tx.insert(t.assignments).values(assignment).run();
    for (const baseline of payload.baselines) tx.insert(t.baselines).values(baseline).run();
    for (const value of payload.baselineValues) tx.insert(t.baselineValues).values(value).run();
    for (const field of payload.customFields) tx.insert(t.customFields).values(field).run();
    for (const value of payload.customFieldValues)
      tx.insert(t.customFieldValues).values(value).run();
    for (const item of payload.libraryItems) tx.insert(t.libraryItems).values(item).run();
  }
}

/* -------------------------------------------------------------------------- */
/* Snapshots de recuperação (specs/persistence)                                */
/* -------------------------------------------------------------------------- */

export const AUTO_SNAPSHOT_PREFIX = "auto:";
/** Mantém os últimos N snapshots automáticos por projeto. */
export const SNAPSHOT_KEEP = 5;

export interface SnapshotInfo {
  id: string;
  createdAt: number;
}

/** Grava um snapshot automático e descarta os antigos, mantendo os 5 mais recentes. */
export function createSnapshot(db: Db, projectId: string): SnapshotInfo | undefined {
  const payload = serializeAggregate(db, projectId);
  if (!payload) return undefined;

  // createdAt estritamente crescente: garante ordenação determinística
  // mesmo quando dois snapshots caem no mesmo milissegundo.
  const last = listSnapshots(db, projectId)[0];
  const createdAt = Math.max(Date.now(), (last?.createdAt ?? 0) + 1);
  const id = `${AUTO_SNAPSHOT_PREFIX}${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}`;

  db.transaction((tx) => {
    tx.insert(t.snapshots)
      .values({ id, projectId, payload: JSON.stringify(payload), createdAt })
      .run();

    const stale = tx
      .select({ id: t.snapshots.id })
      .from(t.snapshots)
      .where(
        sql`${t.snapshots.projectId} = ${projectId} AND ${t.snapshots.id} LIKE ${AUTO_SNAPSHOT_PREFIX + "%"}`,
      )
      .orderBy(sql`${t.snapshots.createdAt} DESC`)
      .all()
      .slice(SNAPSHOT_KEEP)
      .map((row) => row.id);

    for (const oldId of stale) {
      tx.delete(t.snapshots).where(eq(t.snapshots.id, oldId)).run();
    }
  });

  return { id, createdAt };
}

/** Lista os snapshots automáticos (mais recente primeiro), sem o payload. */
export function listSnapshots(db: Db, projectId: string): SnapshotInfo[] {
  return db
    .select({ id: t.snapshots.id, createdAt: t.snapshots.createdAt })
    .from(t.snapshots)
    .where(
      sql`${t.snapshots.projectId} = ${projectId} AND ${t.snapshots.id} LIKE ${AUTO_SNAPSHOT_PREFIX + "%"}`,
    )
    .orderBy(sql`${t.snapshots.createdAt} DESC`)
    .all();
}

/** Remove todos os dados do projeto preservando os snapshots. */
function clearProject(tx: Db, projectId: string): void {
  const projectIds = sql`${projectId}`;
  tx.delete(t.assignments).where(sql`${t.assignments.projectId} = ${projectIds}`).run();
  tx.delete(t.baselineValues)
    .where(
      sql`${t.baselineValues.baselineId} IN (SELECT id FROM baselines WHERE project_id = ${projectId})`,
    )
    .run();
  tx.delete(t.baselines).where(sql`${t.baselines.projectId} = ${projectIds}`).run();
  tx.delete(t.customFieldValues)
    .where(
      sql`${t.customFieldValues.fieldId} IN (SELECT id FROM custom_fields WHERE project_id = ${projectId})`,
    )
    .run();
  tx.delete(t.customFields).where(sql`${t.customFields.projectId} = ${projectIds}`).run();
  tx.delete(t.taskLinks).where(sql`${t.taskLinks.projectId} = ${projectIds}`).run();
  tx.delete(t.tasks).where(sql`${t.tasks.projectId} = ${projectIds}`).run();
  tx.delete(t.resources).where(sql`${t.resources.projectId} = ${projectIds}`).run();
  tx.delete(t.calendarExceptions)
    .where(
      sql`${t.calendarExceptions.calendarId} IN (SELECT id FROM calendars WHERE project_id = ${projectId})`,
    )
    .run();
  tx.delete(t.calendars).where(sql`${t.calendars.projectId} = ${projectIds}`).run();
  tx.delete(t.libraryItems).where(sql`${t.libraryItems.projectId} = ${projectIds}`).run();
  tx.delete(t.projects).where(sql`${t.projects.id} = ${projectIds}`).run();
}

/** Substitui os dados atuais do projeto pelo conteúdo do snapshot. */
export function recoverFromSnapshot(
  db: Db,
  projectId: string,
  snapshotId: string,
): boolean {
  const row = db.select().from(t.snapshots).where(eq(t.snapshots.id, snapshotId)).get();
  if (!row || row.projectId !== projectId) return false;

  const payload = JSON.parse(row.payload) as AggregatePayload;

  db.transaction((tx) => {
    clearProject(tx, projectId);
    insertAggregateRows(tx, payload);
  });

  return true;
}

/** Erro de integridade dos dados de um projeto (impede a abertura normal). */
export class AggregateInvalidError extends Error {
  constructor(
    readonly entity: string,
    message: string,
  ) {
    super(message);
    this.name = "AggregateInvalidError";
  }
}

function parseJson(value: string | null, entity: string): void {
  if (value === null || value === undefined || value === "") return;
  try {
    JSON.parse(value);
  } catch {
    throw new AggregateInvalidError(entity, `JSON inválido em ${entity}`);
  }
}

/**
 * Valida os campos estruturados do projeto. Se algum estiver corrompido,
 * lança `AggregateInvalidError` — é o sinal de que a abertura normal falhou.
 */
export function validateAggregate(db: Db, projectId: string): void {
  for (const task of db.select().from(t.tasks).where(eq(t.tasks.projectId, projectId)).all()) {
    parseJson(task.recurrence, `tasks.recurrence (${task.id})`);
    parseJson(task.segments, `tasks.segments (${task.id})`);
  }
  for (const field of db
    .select()
    .from(t.customFields)
    .where(eq(t.customFields.projectId, projectId))
    .all()) {
    parseJson(field.config, `custom_fields.config (${field.id})`);
    parseJson(field.indicatorRules, `custom_fields.indicator_rules (${field.id})`);
  }
  for (const item of db
    .select()
    .from(t.libraryItems)
    .where(eq(t.libraryItems.projectId, projectId))
    .all()) {
    parseJson(item.config, `library_items.config (${item.id})`);
  }
}

export type OpenResult =
  | { ok: true }
  | { ok: false; reason: string; snapshots: SnapshotInfo[] };

/**
 * Abre o projeto validando a integridade. Quando os dados estão corrompidos,
 * devolve a lista de snapshots disponíveis para recuperação.
 */
export function openProjectSafe(db: Db, projectId: string): OpenResult {
  try {
    validateAggregate(db, projectId);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Dados íntegros",
      snapshots: listSnapshots(db, projectId),
    };
  }
}

/** Intervalo mínimo entre snapshots automáticos durante o uso. */
export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/** Cria um snapshot se o último for mais antigo que o intervalo informado. */
export function maybeSnapshot(
  db: Db,
  projectId: string,
  intervalMs: number = SNAPSHOT_INTERVAL_MS,
): SnapshotInfo | undefined {
  const last = listSnapshots(db, projectId)[0];
  if (last && Date.now() - last.createdAt < intervalMs) return undefined;
  return createSnapshot(db, projectId);
}
