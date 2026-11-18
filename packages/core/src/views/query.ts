/**
 * Consultas de visão (specs/views-and-filters): filtros por campo com
 * combinadores E/OU, ordenação múltipla (com preservação da hierarquia
 * WBS) e agrupamento com contagem e sumário numérico.
 *
 * Tudo é puro: os valores das tarefas chegam em um mapa `field → valor`
 * resolvido pelo chamador (nativos e campos personalizados), e os predicados
 * prontos (em atraso, críticas…) são avaliados fora, combinados por
 * `combineFlags`.
 */

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "isEmpty"
  | "isNotEmpty";

export type FilterCombinator = "and" | "or";

/** Filtros prontos (specs/views-and-filters — "Filtros"). */
export type FilterPreset =
  | "late" // em atraso (prazo estourado)
  | "critical" // no caminho crítico
  | "delayed" // atrasadas vs. data de status
  | "noResource" // sem recurso atribuído
  | "milestone" // marcos
  | "manual"; // tarefas manuais

export interface FilterCondition {
  /** Chave do campo (`name`, `duration`, `cf:<id>`…). */
  field: string;
  operator: FilterOperator;
  /** Valor de comparação como texto; convertido pelo chamador quando numérico. */
  value?: string;
}

export interface FilterSpec {
  combinator: FilterCombinator;
  presets: FilterPreset[];
  conditions: FilterCondition[];
}

export const EMPTY_FILTER: FilterSpec = {
  combinator: "and",
  presets: [],
  conditions: [],
};

/** Valor bruto de um campo numa tarefa (nulo = vazio). */
export type FieldValue = string | number | boolean | null | undefined;

export type FieldValues = Record<string, FieldValue>;

/* ------------------------------------------------------------------ filtros */

/**
 * Combina flags isoladas pelo combinador. Lista vazia → `true` (filtro vazio
 * deixa tudo passar — o estado vazio só ocorre quando há condição e nada
 * satisfaz).
 */
export function combineFlags(
  flags: readonly boolean[],
  combinator: FilterCombinator,
): boolean {
  if (flags.length === 0) return true;
  return combinator === "and" ? flags.every(Boolean) : flags.some(Boolean);
}

function isEmptyValue(value: FieldValue): boolean {
  return value === null || value === undefined || value === "";
}

function asNumber(value: FieldValue): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Avalia uma condição contra os valores da tarefa. */
export function matchesCondition(condition: FilterCondition, values: FieldValues): boolean {
  const actual = values[condition.field];

  switch (condition.operator) {
    case "isEmpty":
      return isEmptyValue(actual);
    case "isNotEmpty":
      return !isEmptyValue(actual);
    default:
      break;
  }

  const expected = condition.value ?? "";

  // comparação textual (contains/igualdade de texto)
  const numericActual = asNumber(actual);
  const numericExpected = asNumber(expected);
  const comparable = numericActual !== null && numericExpected !== null;

  const a = comparable ? numericActual! : String(actual ?? "").toLowerCase();
  const b = comparable ? numericExpected! : expected.toLowerCase();

  switch (condition.operator) {
    case "eq":
      return a === b;
    case "neq":
      return a !== b;
    case "contains":
      return String(a).includes(String(b));
    case "notContains":
      return !String(a).includes(String(b));
    case "gt":
      return comparable && (a as number) > (b as number);
    case "gte":
      return comparable && (a as number) >= (b as number);
    case "lt":
      return comparable && (a as number) < (b as number);
    case "lte":
      return comparable && (a as number) <= (b as number);
    default:
      return false;
  }
}

/** Avalia as condições do filtro (presets ficam por conta do chamador). */
export function matchesFilter(filter: FilterSpec, values: FieldValues): boolean {
  const flags = filter.conditions.map((condition) => matchesCondition(condition, values));
  return combineFlags(flags, filter.combinator);
}

/** Há algo filtrando? (para o estado vazio e o indicador de filtro ativo) */
export function isFilterActive(filter: FilterSpec): boolean {
  return filter.conditions.length > 0 || filter.presets.length > 0;
}

/* -------------------------------------------------------------- ordenação */

export interface SortSpec {
  field: string;
  direction: "asc" | "desc";
}

type SortValues = Readonly<Record<string, FieldValues>>;

function compareValues(left: FieldValue, right: FieldValue): number {
  const leftEmpty = isEmptyValue(left);
  const rightEmpty = isEmptyValue(right);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1; // vazios por último
  if (rightEmpty) return -1;

  const a = asNumber(left);
  const b = asNumber(right);
  if (a !== null && b !== null) return a - b;
  return String(left).localeCompare(String(right), "pt-BR");
}

function compareBySorts(
  idA: string,
  idB: string,
  values: SortValues,
  sorts: readonly SortSpec[],
): number {
  for (const sort of sorts) {
    const result = compareValues(
      values[idA]?.[sort.field] ?? null,
      values[idB]?.[sort.field] ?? null,
    );
    if (result !== 0) return sort.direction === "asc" ? result : -result;
  }
  return 0;
}

/**
 * Ordena o `order` pelos campos indicados. Com `preserveHierarchy`, apenas
 * os irmãos são reordenados e cada resumo permanece com as suas subtarefas
 * (specs/views-and-filters — "Ordenar por um ou mais campos").
 */
export function sortOrder(
  order: readonly string[],
  values: SortValues,
  sorts: readonly SortSpec[],
  preserveHierarchy: boolean,
  parents: Readonly<Record<string, string | null>>,
): string[] {
  if (sorts.length === 0 || order.length === 0) return [...order];

  if (!preserveHierarchy) {
    return [...order].sort((a, b) => compareBySorts(a, b, values, sorts) || order.indexOf(a) - order.indexOf(b));
  }

  // filhos na ordem original, por pai
  const childrenOf = new Map<string | null, string[]>();
  for (const id of order) {
    const parentId = parents[id] ?? null;
    const list = childrenOf.get(parentId);
    if (list) list.push(id);
    else childrenOf.set(parentId, [id]);
  }

  const sorted: string[] = [];
  const walk = (parentId: string | null): void => {
    const children = childrenOf.get(parentId);
    if (!children) return;
    const ordered = [...children].sort(
      (a, b) => compareBySorts(a, b, values, sorts) || children.indexOf(a) - children.indexOf(b),
    );
    for (const id of ordered) {
      sorted.push(id);
      walk(id); // resumo fica com as suas subtarefas
    }
  };
  walk(null);
  return sorted;
}

/* ------------------------------------------------------------- agrupamento */

export interface GroupSummary {
  /** Quantidade de tarefas no grupo (incluindo subgrupos). */
  count: number;
  /** Soma do trabalho (ms). */
  work: number;
  /** Soma da duração (ms). */
  duration: number;
  /** Soma do custo (BRL). */
  cost: number;
}

export interface TaskGroup {
  /** Campo deste nível. */
  field: string;
  /** Valor bruto stringificado (chave). */
  key: string;
  /** Rótulo exibido no cabeçalho. */
  label: string;
  /** Profundidade do cabeçalho (0 = raiz). */
  depth: number;
  /** Tarefas diretas (sem subgrupo); folhas dos grupos aninhados. */
  rowIds: string[];
  /** Agregado do grupo inteiro (recursivo). */
  summary: GroupSummary;
  children: TaskGroup[];
}

function emptySummary(): GroupSummary {
  return { count: 0, work: 0, duration: 0, cost: 0 };
}

function summarizeIds(ids: readonly string[], values: SortValues): GroupSummary {
  const summary = emptySummary();
  for (const id of ids) {
    const row = values[id];
    if (!row) continue;
    summary.count += 1;
    summary.work += typeof row.work === "number" ? row.work : 0;
    summary.duration += typeof row.duration === "number" ? row.duration : 0;
    summary.cost += typeof row.cost === "number" ? row.cost : 0;
  }
  return summary;
}

function labelOf(field: string, key: string): string {
  if (key === "") return "(sem valor)";
  return key;
}

function groupLevel(
  ids: readonly string[],
  fields: readonly string[],
  depth: number,
  values: SortValues,
): TaskGroup[] {
  const field = fields[depth]!;
  const buckets = new Map<string, string[]>();

  for (const id of ids) {
    const raw = values[id]?.[field];
    const key = raw === null || raw === undefined ? "" : String(raw);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(id);
    else buckets.set(key, [id]);
  }

  const groups: TaskGroup[] = [];
  for (const [key, memberIds] of buckets) {
    const children =
      depth + 1 < fields.length ? groupLevel(memberIds, fields, depth + 1, values) : [];

    groups.push({
      field,
      key,
      label: labelOf(field, key),
      depth,
      rowIds: children.length === 0 ? memberIds : [],
      summary:
        children.length === 0
          ? summarizeIds(memberIds, values)
          : mergeSummaries(children),
      children,
    });
  }

  groups.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return groups;
}

function mergeSummaries(children: readonly TaskGroup[]): GroupSummary {
  const summary = emptySummary();
  for (const child of children) {
    summary.count += child.summary.count;
    summary.work += child.summary.work;
    summary.duration += child.summary.duration;
    summary.cost += child.summary.cost;
  }
  return summary;
}

/**
 * Agrupa os ids (na ordem de exibição) por um ou mais campos, gerando
 * cabeçalhos com contagem e sumário numérico dos campos agregáveis
 * (specs/views-and-filters — "Agrupamento").
 */
export function groupTasks(
  ids: readonly string[],
  fields: readonly string[],
  values: SortValues,
): TaskGroup[] {
  if (fields.length === 0) return [];
  return groupLevel(ids, fields, 0, values);
}

/** Achata os grupos em linhas (cabeçalho + tarefas), na ordem de exibição. */
export function flattenGroups(groups: readonly TaskGroup[]): Array<
  { kind: "header"; group: TaskGroup } | { kind: "task"; id: string; depth: number }
> {
  const out: Array<
    { kind: "header"; group: TaskGroup } | { kind: "task"; id: string; depth: number }
  > = [];

  const walk = (group: TaskGroup): void => {
    out.push({ kind: "header", group });
    for (const child of group.children) walk(child);
    for (const id of group.rowIds) out.push({ kind: "task", id, depth: group.depth + 1 });
  };

  for (const group of groups) walk(group);
  return out;
}
