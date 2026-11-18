/**
 * Indicadores gráficos (specs/custom-fields — "Indicadores gráficos").
 *
 * Regras do campo (`indicatorRules`, JSON): cada regra compara o valor do
 * campo e propõe um ícone; quando duas regras são atendidas, prevalece a de
 * **maior prioridade** (número maior). Sem correspondência → `null`.
 *
 * Função pura — sem I/O, sem DOM.
 */

export type IndicatorOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains";

export interface IndicatorRule {
  /** Ícone exibido (emoji ou símbolo). */
  icon: string;
  /** Maior número = maior prioridade. */
  priority: number;
  operator: IndicatorOperator;
  value: string | number;
}

const OPERATORS: IndicatorOperator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"];

/** Interpreta o JSON das regras, descartando entradas inválidas. */
export function parseIndicatorRules(raw: string | null | undefined): IndicatorRule[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const rules: IndicatorRule[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const rule = entry as Partial<IndicatorRule>;
    if (typeof rule.icon !== "string" || rule.icon === "") continue;
    if (typeof rule.priority !== "number" || !Number.isFinite(rule.priority)) continue;
    if (!rule.operator || !OPERATORS.includes(rule.operator)) continue;
    if (typeof rule.value !== "string" && typeof rule.value !== "number") continue;
    rules.push({
      icon: rule.icon,
      priority: rule.priority,
      operator: rule.operator,
      value: rule.value,
    });
  }
  return rules;
}

function asNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function matches(rule: IndicatorRule, field: string | number | boolean | null): boolean {
  if (field === null || field === undefined) return false;

  if (rule.operator === "contains") {
    return String(field).toLowerCase().includes(String(rule.value).toLowerCase());
  }

  const a = asNumber(typeof field === "boolean" ? (field ? 1 : 0) : field);
  const b = asNumber(rule.value);

  // comparação numérica quando os dois lados são números; senão, texto
  if (a !== null && b !== null) {
    switch (rule.operator) {
      case "eq":
        return a === b;
      case "neq":
        return a !== b;
      case "gt":
        return a > b;
      case "gte":
        return a >= b;
      case "lt":
        return a < b;
      case "lte":
        return a <= b;
      default:
        return false;
    }
  }

  const text = String(field).toLowerCase();
  const other = String(rule.value).toLowerCase();
  switch (rule.operator) {
    case "eq":
      return text === other;
    case "neq":
      return text !== other;
    case "gt":
      return text > other;
    case "gte":
      return text >= other;
    case "lt":
      return text < other;
    case "lte":
      return text <= other;
    default:
      return false;
  }
}

/** Ícone da regra vencedora (maior prioridade) ou `null`. */
export function evaluateIndicator(
  rules: readonly IndicatorRule[],
  field: string | number | boolean | null,
): string | null {
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of ordered) {
    if (matches(rule, field)) return rule.icon;
  }
  return null;
}
