import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index";
import * as t from "../db/schema";
import { applySyncTx, SyncError, type SyncBatch, type SyncResult } from "./sync";

/**
 * Importação transacional (specs/import-export — "Importação transacional"):
 * aplica o plano montado pelo cliente em UMA transação, na ordem certa —
 * substituição remove primeiro (cascata cuida dos dependentes) e mesclagem
 * neutraliza `sort_order` (índice único `project_id+sort_order`) antes de
 * gravar, renumerando a árvore ao final.
 */

export interface ImportPayload {
  mode?: unknown;
  replaceEntities?: unknown;
  upserts?: SyncBatch["upserts"];
}

const REPLACE_ENTITIES = new Set(["tasks", "resources", "custom_fields", "baselines"]);

/** Compara caminhos WBS `1.10` > `1.2` (segmentos numéricos quando possível). */
function compareOutline(a: string, b: string): number {
  const as = a.split(".");
  const bs = b.split(".");
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const left = as[i] ?? "";
    const right = bs[i] ?? "";
    if (left === right) continue;
    const leftNum = Number(left);
    const rightNum = Number(right);
    if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum) && left !== "" && right !== "") {
      return leftNum - rightNum;
    }
    return left.localeCompare(right, "pt-BR");
  }
  return 0;
}

/** Remoção de uma entidade por projeto, com cascate do banco. */
function deleteEntity(tx: Db, projectId: string, entity: string): void {
  switch (entity) {
    case "tasks": {
      // `custom_field_values.entityId` não tem FK: limpa os valores órfãos
      // das tarefas que vão embora antes do cascata.
      const ids = tx
        .select({ id: t.tasks.id })
        .from(t.tasks)
        .where(eq(t.tasks.projectId, projectId))
        .all()
        .map((row) => row.id);
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        tx.delete(t.customFieldValues)
          .where(inArray(t.customFieldValues.entityId, chunk))
          .run();
      }
      // `task_links` também não tem FK para tasks (permite vínculo
      // entre projetos): a substituição remove os vínculos do projeto.
      tx.delete(t.taskLinks).where(eq(t.taskLinks.projectId, projectId)).run();
      tx.delete(t.tasks).where(eq(t.tasks.projectId, projectId)).run();
      return;
    }
    case "resources":
      tx.delete(t.resources).where(eq(t.resources.projectId, projectId)).run();
      return;
    case "custom_fields":
      tx.delete(t.customFields).where(eq(t.customFields.projectId, projectId)).run();
      return;
    case "baselines":
      tx.delete(t.baselines).where(eq(t.baselines.projectId, projectId)).run();
      return;
    default:
      throw new SyncError("unknown_entity", `Entidade de substituição desconhecida: ${entity}`);
  }
}

/** Renumera a árvore do projeto em ordem WBS (pares antes dos filhos). */
function renumberTasks(tx: Db, projectId: string): void {
  const rows = tx
    .select({ id: t.tasks.id, outlineNumber: t.tasks.outlineNumber })
    .from(t.tasks)
    .where(eq(t.tasks.projectId, projectId))
    .all();
  rows.sort((a, b) => compareOutline(a.outlineNumber, b.outlineNumber));
  rows.forEach((row, index) => {
    tx.update(t.tasks).set({ sortOrder: index }).where(eq(t.tasks.id, row.id)).run();
  });
}

export function importProjectData(
  db: Db,
  projectId: string,
  payload: { mode: "replace" | "merge"; replaceEntities: string[]; upserts: NonNullable<SyncBatch["upserts"]> },
): SyncResult {
  const result: SyncResult = { upserted: {}, deleted: {} };

  db.transaction((tx) => {
    if (payload.mode === "replace") {
      for (const entity of payload.replaceEntities) {
        if (!REPLACE_ENTITIES.has(entity)) {
          throw new SyncError("unknown_entity", `Entidade de substituição desconhecida: ${entity}`);
        }
        deleteEntity(tx, projectId, entity);
      }
    }

    // unique (project_id, sort_order): zera temporariamente para as novas
    // linhas poderem usar a ordem do arquivo sem colisão.
    const hasTasks = (payload.upserts.tasks?.length ?? 0) > 0;
    const neutralized = payload.mode === "merge" && hasTasks;
    if (neutralized) {
      tx.update(t.tasks)
        .set({ sortOrder: sql`-rowid` })
        .where(eq(t.tasks.projectId, projectId))
        .run();
    }

    applySyncTx(tx, projectId, { upserts: payload.upserts }, result);

    if (neutralized) {
      // Fase 2: zera tudo (inclusive as linhas novas) e só então renumera —
      // senão a escrita dos índices finais colidiria com valores transitórios.
      tx.update(t.tasks)
        .set({ sortOrder: sql`-rowid` })
        .where(eq(t.tasks.projectId, projectId))
        .run();
      renumberTasks(tx, projectId);
    }
  });

  return result;
}
