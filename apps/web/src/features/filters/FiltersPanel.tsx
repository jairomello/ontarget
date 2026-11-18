import {
  EMPTY_FILTER,
  type FilterCombinator,
  type FilterOperator,
  type FilterPreset,
  type SortSpec,
} from "@ontarget/core";
import { useState } from "react";
import { useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import styles from "./FiltersPanel.module.css";

/** Campos nativos filtráveis/ordenáveis. */
const FIELDS: Array<{ value: string; label: string }> = [
  { value: "name", label: "Nome" },
  { value: "wbs", label: "Código WBS" },
  { value: "start", label: "Início" },
  { value: "finish", label: "Término" },
  { value: "duration", label: "Duração" },
  { value: "percent", label: "% Concluído" },
  { value: "work", label: "Trabalho" },
  { value: "cost", label: "Custo" },
  { value: "res", label: "Recursos" },
];

const OPERATORS: Array<{ value: FilterOperator; label: string }> = [
  { value: "eq", label: "é igual a" },
  { value: "neq", label: "é diferente de" },
  { value: "contains", label: "contém" },
  { value: "notContains", label: "não contém" },
  { value: "gt", label: "é maior que" },
  { value: "gte", label: "é maior ou igual" },
  { value: "lt", label: "é menor que" },
  { value: "lte", label: "é menor ou igual" },
  { value: "isEmpty", label: "está vazio" },
  { value: "isNotEmpty", label: "não está vazio" },
];

const PRESETS: Array<{ value: FilterPreset; label: string }> = [
  { value: "late", label: "Em atraso" },
  { value: "critical", label: "Críticas" },
  { value: "delayed", label: "Atrasadas" },
  { value: "noResource", label: "Sem recurso" },
  { value: "milestone", label: "Marcos" },
  { value: "manual", label: "Manuais" },
];

const VALUELESS: FilterOperator[] = ["isEmpty", "isNotEmpty"];

/**
 * Filtros, ordenação múltipla e agrupamento (specs/views-and-filters):
 * condições combináveis por E/OU, filtros prontos, ordenação por um ou mais
 * campos e agrupamento com cabeçalhos de contagem/sumário na visão.
 */
export function FiltersPanel() {
  const open = useUiStore((state) => state.panels.filters);
  const setPanel = useUiStore((state) => state.setPanel);
  const query = useUiStore((state) => state.query);
  const sorts = useUiStore((state) => state.sorts);
  const groupFields = useUiStore((state) => state.groupFields);
  const setViewQuery = useUiStore((state) => state.setViewQuery);
  const customFields = useDomainStore((state) => state.customFields);

  const [fieldToAdd, setFieldToAdd] = useState("name");
  const [sortToAdd, setSortToAdd] = useState("name");
  const [groupToAdd, setGroupToAdd] = useState("res");

  if (!open) return null;

  const close = () => setPanel("filters", false);

  const options = [
    ...FIELDS,
    ...Object.values(customFields)
      .filter((field) => field.entityType === "task")
      .map((field) => ({ value: `cf:${field.id}`, label: field.name })),
  ];
  const labelOf = (value: string) =>
    options.find((option) => option.value === value)?.label ?? value;

  const setCombinator = (combinator: FilterCombinator) =>
    setViewQuery({ query: { ...query, combinator } });

  const togglePreset = (preset: FilterPreset) => {
    const presets = query.presets.includes(preset)
      ? query.presets.filter((entry) => entry !== preset)
      : [...query.presets, preset];
    setViewQuery({ query: { ...query, presets } });
  };

  const addCondition = () => {
    setViewQuery({
      query: {
        ...query,
        conditions: [
          ...query.conditions,
          { field: fieldToAdd, operator: "contains", value: "" },
        ],
      },
    });
  };

  const updateCondition = (index: number, patch: Partial<(typeof query.conditions)[number]>) =>
    setViewQuery({
      query: {
        ...query,
        conditions: query.conditions.map((condition, position) =>
          position === index ? { ...condition, ...patch } : condition,
        ),
      },
    });

  const removeCondition = (index: number) =>
    setViewQuery({
      query: {
        ...query,
        conditions: query.conditions.filter((_condition, position) => position !== index),
      },
    });

  const addSort = () => {
    const exists = sorts.some((sort) => sort.field === sortToAdd);
    const next: SortSpec[] = exists
      ? sorts.map((sort) =>
          sort.field === sortToAdd
            ? { ...sort, direction: sort.direction === "asc" ? "desc" : "asc" }
            : sort,
        )
      : [...sorts, { field: sortToAdd, direction: "asc" }];
    setViewQuery({ sorts: next });
  };

  const toggleSortDirection = (field: string) =>
    setViewQuery({
      sorts: sorts.map((sort) =>
        sort.field === field
          ? { ...sort, direction: sort.direction === "asc" ? "desc" : "asc" }
          : sort,
      ),
    });

  const removeSort = (field: string) =>
    setViewQuery({ sorts: sorts.filter((sort) => sort.field !== field) });

  const addGroup = () => {
    if (groupFields.includes(groupToAdd)) return;
    setViewQuery({ groupFields: [...groupFields, groupToAdd] });
  };

  const removeGroup = (field: string) =>
    setViewQuery({ groupFields: groupFields.filter((entry) => entry !== field) });

  const clearAll = () =>
    setViewQuery({ query: EMPTY_FILTER, sorts: [], groupFields: [] });

  return (
    <div
      className={styles.backdrop}
      data-testid="filters-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Filtros, ordenação e agrupamento"
        data-testid="filters-panel"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Filtros, ordenação e agrupamento</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="filters-close"
            onClick={close}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          {/* --- filtros ------------------------------------------------------- */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Filtros</h3>

            <fieldset className={styles.combinator}>
              <legend>Combinar condições por</legend>
              {(["and", "or"] as FilterCombinator[]).map((value) => (
                <label key={value} className={styles.check}>
                  <input
                    type="radio"
                    name="combinator"
                    data-testid="filter-combinator"
                    value={value}
                    checked={query.combinator === value}
                    onChange={() => setCombinator(value)}
                  />
                  <span>{value === "and" ? "E (todas)" : "OU (qualquer)"}</span>
                </label>
              ))}
            </fieldset>

            <div className={styles.presets}>
              {PRESETS.map((preset) => (
                <label key={preset.value} className={styles.check}>
                  <input
                    type="checkbox"
                    data-testid="filter-preset"
                    value={preset.value}
                    checked={query.presets.includes(preset.value)}
                    onChange={() => togglePreset(preset.value)}
                  />
                  <span>{preset.label}</span>
                </label>
              ))}
            </div>

            {query.conditions.map((condition, index) => {
              const needsValue = !VALUELESS.includes(condition.operator);
              return (
                <div
                  key={`${condition.field}-${index}`}
                  className={styles.conditionRow}
                  data-testid="condition-row"
                >
                  <select
                    className={styles.field}
                    data-testid="condition-field"
                    aria-label="Campo"
                    value={condition.field}
                    onChange={(event) => updateCondition(index, { field: event.target.value })}
                  >
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className={styles.field}
                    data-testid="condition-operator"
                    aria-label="Operador"
                    value={condition.operator}
                    onChange={(event) =>
                      updateCondition(index, {
                        operator: event.target.value as FilterOperator,
                      })
                    }
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator.value} value={operator.value}>
                        {operator.label}
                      </option>
                    ))}
                  </select>
                  {needsValue && (
                    <input
                      type="text"
                      className={styles.value}
                      data-testid="condition-value"
                      aria-label="Valor"
                      placeholder="valor"
                      value={condition.value ?? ""}
                      onChange={(event) => updateCondition(index, { value: event.target.value })}
                    />
                  )}
                  <button
                    type="button"
                    className={styles.removeButton}
                    data-testid="condition-remove"
                    onClick={() => removeCondition(index)}
                  >
                    Remover
                  </button>
                </div>
              );
            })}

            <div className={styles.addRow}>
              <select
                className={styles.field}
                data-testid="condition-new-field"
                aria-label="Novo campo"
                value={fieldToAdd}
                onChange={(event) => setFieldToAdd(event.target.value)}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.addButton}
                data-testid="condition-add"
                onClick={addCondition}
              >
                Adicionar condição
              </button>
            </div>
          </section>

          {/* --- ordenação ----------------------------------------------------- */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Ordenação</h3>

            {sorts.map((sort, index) => (
              <div
                key={sort.field}
                className={styles.conditionRow}
                data-testid="sort-row"
                data-order={index}
              >
                <span className={styles.badge}>{labelOf(sort.field)}</span>
                <button
                  type="button"
                  className={styles.directionButton}
                  data-testid="sort-direction"
                  onClick={() => toggleSortDirection(sort.field)}
                >
                  {sort.direction === "asc" ? "↑ crescente" : "↓ decrescente"}
                </button>
                <button
                  type="button"
                  className={styles.removeButton}
                  data-testid="sort-remove"
                  onClick={() => removeSort(sort.field)}
                >
                  Remover
                </button>
              </div>
            ))}

            <div className={styles.addRow}>
              <select
                className={styles.field}
                data-testid="sort-new-field"
                aria-label="Campo de ordenação"
                value={sortToAdd}
                onChange={(event) => setSortToAdd(event.target.value)}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.addButton}
                data-testid="sort-add"
                onClick={addSort}
              >
                Adicionar ordenação
              </button>
            </div>
          </section>

          {/* --- agrupamento --------------------------------------------------- */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Agrupamento</h3>

            <div className={styles.chips}>
              {groupFields.map((field) => (
                <span key={field} className={styles.chip} data-testid="group-chip">
                  {labelOf(field)}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    data-testid="group-remove"
                    aria-label={`Remover agrupamento por ${labelOf(field)}`}
                    onClick={() => removeGroup(field)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className={styles.addRow}>
              <select
                className={styles.field}
                data-testid="group-new-field"
                aria-label="Campo de agrupamento"
                value={groupToAdd}
                onChange={(event) => setGroupToAdd(event.target.value)}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.addButton}
                data-testid="group-add"
                onClick={addGroup}
              >
                Agrupar
              </button>
            </div>
          </section>

          <footer className={styles.footer}>
            <button
              type="button"
              className={styles.clearButton}
              data-testid="filter-clear"
              onClick={clearAll}
            >
              Limpar tudo
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
