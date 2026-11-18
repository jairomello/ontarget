/**
 * Detecção de alterações para o recálculo incremental
 * (specs/scheduling — "Recálculo incremental e desempenho").
 *
 * Compara dois snapshots de entrada do agendamento e devolve o conjunto de
 * tarefas alteradas — ou `null` quando a diferença é estrutural e exige um
 * recálculo completo (tarefas/vínculos incluídos ou removidos).
 */
import type { ScheduleLinkInput, ScheduleTaskInput } from "./types";

export interface ScheduleSnapshot {
  tasks: readonly ScheduleTaskInput[];
  links: readonly ScheduleLinkInput[];
}

/** Serialização estável (chaves ordenadas) para comparação estrutural. */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

/**
 * Ids de tarefas cujo resultado de agendamento pode ter mudado.
 *
 * - `null` → mudança estrutural (tarefa ou vínculo entrou/saiu): recálculo
 *   completo;
 * - `[]` → nada relevante mudou: manter o resultado anterior;
 * - não vazio → recálculo incremental restrito ao fecho dessas tarefas.
 */
export function changedScheduleIds(
  prev: ScheduleSnapshot,
  next: ScheduleSnapshot,
): string[] | null {
  if (prev.tasks.length !== next.tasks.length) return null;
  if (prev.links.length !== next.links.length) return null;

  const prevTasks = new Map(prev.tasks.map((task) => [task.id, task]));
  const changed = new Set<string>();

  for (const task of next.tasks) {
    const before = prevTasks.get(task.id);
    if (!before) return null;
    if (stable(before) !== stable(task)) changed.add(task.id);
  }

  const prevLinks = new Map(prev.links.map((link) => [link.id, link]));
  const nextLinks = new Map(next.links.map((link) => [link.id, link]));
  if (prevLinks.size !== nextLinks.size) return null;
  for (const id of nextLinks.keys()) {
    if (!prevLinks.has(id)) return null;
  }

  for (const link of next.links) {
    const before = prevLinks.get(link.id)!;
    if (stable(before) !== stable(link)) {
      changed.add(link.predecessorId);
      changed.add(link.successorId);
    }
  }

  return [...changed];
}
