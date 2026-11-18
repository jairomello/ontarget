import {
  evaluateFormula,
  evaluateIndicator,
  formatDateInput,
  formatDurationMs,
  formatWbsCode,
  parseIndicatorRules,
  wbsPath,
  type FormulaValue,
} from "@ontarget/core";
import { selectWbsMask, useDomainStore } from "../../store/domainStore";
import type { CustomField, CustomFieldValue, Id, Task } from "../../store/types";
import type { CellType } from "../tasksheet/cells";
import type { ColumnDef } from "../tasksheet/columns";

/**
 * Campos personalizados na grade (specs/custom-fields — "Coluna de campo
 * personalizado" e "Fórmulas em campos"): colunas dinâmicas `cf:<id>`,
 * leitura/escrita dos valores e avaliação das fórmulas (sem `eval`).
 */

export const cfKey = (fieldId: Id): string => `cf:${fieldId}`;
export const cfFieldId = (key: string): string => key.slice(3);

/** Tipo do editor de célula correspondente ao tipo do campo. */
export function cellTypeFor(dataType: string): CellType | undefined {
  switch (dataType) {
    case "text":
      return "text";
    case "number":
      return "number";
    case "date":
      return "date";
    case "duration":
      return "duration";
    case "cost":
      return "cost";
    case "flag":
      return "flag";
    case "list":
      return "list";
    default:
      return undefined; // fórmula é somente leitura
  }
}

/** Opções de uma lista (`config` = `{"values":[…]}`). */
export function listOptions(field: CustomField): string[] {
  if (!field.config) return [];
  try {
    const parsed = JSON.parse(field.config) as { values?: unknown };
    return Array.isArray(parsed.values)
      ? parsed.values.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

/** Valor armazenado (número/texto/data) conforme o tipo do campo. */
function storedValueOf(
  field: CustomField,
  value: CustomFieldValue | undefined,
): number | string | null {
  if (!value) return null;
  switch (field.dataType) {
    case "number":
    case "duration":
    case "cost":
    case "flag":
      return value.valueNum;
    case "date":
      return value.valueDate;
    default:
      return value.valueText;
  }
}

function formatTyped(dataType: string, value: FormulaValue): string {
  if (value === null || value === undefined) return "";
  switch (dataType) {
    case "date":
      return typeof value === "number" ? formatDateInput(value) : String(value);
    case "duration":
      return typeof value === "number" ? formatDurationMs(value) : String(value);
    case "flag":
      return value ? "Sim" : "Não";
    case "cost":
      return `R$ ${Number(value).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    default:
      return String(value);
  }
}

/**
 * Escopo das fórmulas: campos nativos da tarefa + os valores dos demais
 * campos personalizados do tipo tarefa.
 */
export function formulaScope(
  task: Task,
  fields: CustomField[],
  values: Record<Id, Record<Id, CustomFieldValue>>,
): Record<string, FormulaValue> {
  const scope: Record<string, FormulaValue> = {
    Nome: task.name,
    "Duração": task.duration,
    Início: task.start,
    "Término": task.finish,
    Trabalho: task.work,
    Custo: task.cost,
    "% Concluído": task.percentComplete,
    Marco: task.isMilestone,
    Inativa: task.isInactive,
    WBS: task.wbsCode ?? task.outlineNumber,
  };

  for (const field of fields) {
    if (field.entityType !== "task" || field.dataType === "formula") continue;
    scope[field.name] = storedValueOf(field, values[field.id]?.[task.id]);
  }
  return scope;
}

/** Texto exibido na célula para um campo (fórmulas avaliadas na hora). */
export function customCellTextFor(key: string, task: Task): string {
  const state = useDomainStore.getState();
  const field = state.customFields[cfFieldId(key)];
  if (!field) return "";

  const taskFields = Object.values(state.customFields).filter(
    (entry) => entry.entityType === "task",
  );

  if (field.dataType === "formula") {
    const result = evaluateFormula(
      field.formula ?? "",
      formulaScope(task, taskFields, state.customFieldValues),
    );
    // ⚠ marca a fórmula cuja avaliação falhou (ex.: campo renomeado)
    return result.ok ? formatTyped("number", result.value) : "⚠";
  }

  const raw = storedValueOf(field, state.customFieldValues[field.id]?.[task.id]);
  return raw === null ? "" : formatTyped(field.dataType, raw);
}

/** Valor bruto da célula (semente do editor). */
export function customCellValueFor(key: string, task: Task): unknown {
  const state = useDomainStore.getState();
  const field = state.customFields[cfFieldId(key)];
  if (!field || field.dataType === "formula") return null;
  return storedValueOf(field, state.customFieldValues[field.id]?.[task.id]);
}

/**
 * Código exibido na coluna WBS: o personalizado tem precedência; sem ele,
 * o número WBS gerado segue a máscara da biblioteca (specs/custom-fields).
 */
export function wbsCodeText(task: Task): string {
  if (task.wbsCode) return task.wbsCode;
  const mask = selectWbsMask(useDomainStore.getState());
  return mask ? formatWbsCode(mask, wbsPath(task.outlineNumber)) : task.outlineNumber;
}

/**
 * Valor bruto de um campo para uma tarefa — armazenado, ou o resultado da
 * fórmula quando o campo é calculado (base dos indicadores gráficos).
 */
export function fieldRawValueFor(
  fieldId: Id,
  task: Task,
): number | string | boolean | null {
  const state = useDomainStore.getState();
  const field = state.customFields[fieldId];
  if (!field) return null;

  if (field.dataType === "formula") {
    const taskFields = Object.values(state.customFields).filter(
      (entry) => entry.entityType === "task",
    );
    const result = evaluateFormula(
      field.formula ?? "",
      formulaScope(task, taskFields, state.customFieldValues),
    );
    return result.ok ? result.value : null;
  }

  const raw = storedValueOf(field, state.customFieldValues[field.id]?.[task.id]);
  if (field.dataType === "flag") return raw !== null && raw !== 0;
  return raw;
}

/**
 * Ícone exibido na coluna de indicadores (specs/custom-fields —
 * "Indicadores gráficos"): para cada campo com indicador ativo, a regra
 * vencedora (maior prioridade); sem correspondência, nada.
 */
export function indicatorIconsFor(task: Task): string {
  const state = useDomainStore.getState();
  const fields = Object.values(state.customFields)
    .filter((field) => field.entityType === "task" && field.showIndicator)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const icons: string[] = [];
  for (const field of fields) {
    const rules = parseIndicatorRules(field.indicatorRules);
    if (rules.length === 0) continue;
    const icon = evaluateIndicator(rules, fieldRawValueFor(field.id, task));
    if (icon) icons.push(icon);
  }
  return icons.join(" ");
}

function toStoreValue(
  field: CustomField,
  parsed: unknown,
): { text?: string | null; num?: number | null; date?: number | null } | null {
  switch (field.dataType) {
    case "text":
    case "list": {
      const text = String(parsed ?? "");
      return text === "" ? null : { text };
    }
    case "flag":
      return { num: parsed ? 1 : 0 };
    case "date":
      return { date: typeof parsed === "number" ? parsed : null };
    case "number":
    case "duration":
    case "cost":
      return { num: typeof parsed === "number" ? parsed : Number(parsed) };
    default:
      return null;
  }
}

/** Grava o valor já validado pelo editor; devolve recusas (raramente usadas). */
export function applyCustomValue(fieldId: Id, entityId: Id, parsed: unknown): string[] {
  const state = useDomainStore.getState();
  const field = state.customFields[fieldId];
  if (!field) return ["Campo não encontrado."];
  if (field.dataType === "formula") return ["Campo calculado: edite a fórmula."];

  const value = toStoreValue(field, parsed);
  state.setCustomFieldValue(fieldId, entityId, value);
  return [];
}

/**
 * Valida uma fórmula no momento da criação (specs/custom-fields — "Expressão
 * proibida"): sintaxe e funções precisam ser válidas; referências a campos
 * ainda inexistentes são aceitas (ganharam valor depois).
 */
export function validateFormulaForCreate(expression: string): { ok: boolean; reason?: string } {
  const text = expression.trim();
  if (text === "") return { ok: false, reason: "Informe a fórmula." };

  const result = evaluateFormula(text, {});
  if (result.ok) return { ok: true };
  if (result.reason.startsWith("Campo não encontrado")) return { ok: true };
  return { ok: false, reason: result.reason };
}

/** Coluna dinâmica da grade para o campo. */
export function buildFieldColumn(field: CustomField): ColumnDef {
  const type = cellTypeFor(field.dataType);
  return {
    key: cfKey(field.id),
    label: field.name,
    width: 140,
    type,
    options: field.dataType === "list" ? listOptions(field) : undefined,
    commit:
      type !== undefined
        ? (taskId, value) => applyCustomValue(field.id, taskId, value)
        : undefined,
  };
}
