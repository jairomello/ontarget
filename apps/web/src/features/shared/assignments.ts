import { newId } from "@ontarget/shared";
import { useDomainStore } from "../../store/domainStore";
import type { Assignment, Resource } from "../../store/types";

/**
 * Atribuições pela coluna de recursos da Task Sheet e pelo formulário de
 * detalhes (specs/resources — "Atribuição de tarefas a recursos").
 *
 * Coluna: selecionar uma pessoa a atribui com 100% de unidades; escolher "—"
 * remove todas. Formulário: atribuição pontual, unidades em porcentagem e
 * remoção individual — sempre sem apagar a tarefa.
 */

export interface AssignResult {
  errors: string[];
}

/** Nomes das pessoas atribuídas à tarefa (texto exibido na coluna). */
export function assignmentNamesText(taskId: string): string {
  const state = useDomainStore.getState();
  return Object.values(state.assignments)
    .filter((assignment) => assignment.taskId === taskId)
    .map((assignment) => state.resources[assignment.resourceId]?.name ?? "")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

function newAssignment(
  projectId: string,
  taskId: string,
  resourceId: string,
  units: number,
): Assignment {
  return {
    id: newId(),
    projectId,
    taskId,
    resourceId,
    units,
    work: null,
    cost: null,
    actualWork: null,
    actualCost: null,
    start: null,
    finish: null,
    proposed: false,
    notes: null,
  };
}

/**
 * Aplica o conjunto escolhido na coluna (modo substituição): vazio remove
 * todas as atribuições; um nome adiciona a pessoa a 100%. Tudo-ou-nada:
 * nome desconhecido não altera nada (specs/task-dependencies — validação).
 */
export function applyResourceList(taskId: string, raw: string): AssignResult {
  const domain = useDomainStore.getState();
  const task = domain.tasks[taskId];
  if (!task) return { errors: ["Tarefa não encontrada."] };

  const byName = new Map(Object.values(domain.resources).map((r) => [r.name, r]));
  const tokens = raw
    .split(/[,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const desired: Resource[] = [];
  const errors: string[] = [];
  for (const token of tokens) {
    const resource = byName.get(token);
    if (!resource) {
      errors.push(`Recurso não encontrado: ${token}`);
      continue;
    }
    if (!desired.some((entry) => entry.id === resource.id)) desired.push(resource);
  }
  if (errors.length > 0) return { errors };

  const current = Object.values(domain.assignments).filter(
    (assignment) => assignment.taskId === taskId,
  );
  const desiredIds = new Set(desired.map((resource) => resource.id));

  // saíram do campo → removem
  for (const assignment of current) {
    if (!desiredIds.has(assignment.resourceId)) domain.removeAssignment(assignment.id);
  }

  // entraram → criam com 100% de unidades
  for (const resource of desired) {
    if (current.some((assignment) => assignment.resourceId === resource.id)) continue;
    const result = domain.addAssignment(
      newAssignment(task.projectId, taskId, resource.id, 1),
    );
    if (!result.ok) errors.push(result.message ?? "Atribuição recusada.");
  }

  return { errors };
}

/** Atribui a pessoa à tarefa com 100% de unidades (formulário). */
export function assignResource(taskId: string, resourceId: string): AssignResult & {
  ok: boolean;
} {
  const domain = useDomainStore.getState();
  const task = domain.tasks[taskId];
  if (!task) return { ok: false, errors: ["Tarefa não encontrada."] };

  const result = domain.addAssignment(newAssignment(task.projectId, taskId, resourceId, 1));
  return { ok: result.ok, errors: result.ok ? [] : [result.message ?? "Atribuição recusada."] };
}

/** Define as unidades em porcentagem (100 → 1.0). */
export function setAssignmentPercent(assignmentId: string, percent: number): void {
  if (!Number.isFinite(percent) || percent < 0) return;
  useDomainStore.getState().updateAssignment(assignmentId, { units: percent / 100 });
}
