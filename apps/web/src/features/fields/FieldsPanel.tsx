import {
  parseIndicatorRules,
  type IndicatorOperator,
  type IndicatorRule,
} from "@ontarget/core";
import { newId } from "@ontarget/shared";
import { useRef, useState } from "react";
import { validateFormulaForCreate } from "../shared/fields";
import { selectWbsMask, useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import type { CustomField } from "../../store/types";
import styles from "./FieldsPanel.module.css";

/** Rótulos dos oito tipos (specs/custom-fields — "Criação de campos"). */
const TYPES: Array<{ value: string; label: string }> = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "duration", label: "Duração" },
  { value: "cost", label: "Custo" },
  { value: "flag", label: "Sinalizador" },
  { value: "list", label: "Lista de valores" },
  { value: "formula", label: "Fórmula" },
];

const typeLabel = (value: string) =>
  TYPES.find((type) => type.value === value)?.label ?? value;

/** Operadores das regras de indicador (specs/custom-fields). */
const OPERATORS: Array<{ value: IndicatorOperator; label: string }> = [
  { value: "eq", label: "é igual a" },
  { value: "neq", label: "é diferente de" },
  { value: "gt", label: "é maior que" },
  { value: "gte", label: "é maior ou igual" },
  { value: "lt", label: "é menor que" },
  { value: "lte", label: "é menor ou igual" },
  { value: "contains", label: "contém" },
];

interface RuleDraft {
  icon: string;
  priority: string;
  operator: IndicatorOperator;
  value: string;
}

const EMPTY_DRAFT: RuleDraft = { icon: "⚠", priority: "1", operator: "gt", value: "" };

/**
 * Campos personalizados (specs/custom-fields): criação dos oito tipos com
 * validação de fórmula, renomeação e exclusão com aviso de uso.
 */
export function FieldsPanel() {
  const open = useUiStore((state) => state.panels.fields);
  const setPanel = useUiStore((state) => state.setPanel);
  const customFields = useDomainStore((state) => state.customFields);
  const customFieldValues = useDomainStore((state) => state.customFieldValues);
  const projectId = useDomainStore((state) => state.projectId);
  const wbsMask = useDomainStore(selectWbsMask);

  const [name, setName] = useState("");
  const [dataType, setDataType] = useState("text");
  const [listValues, setListValues] = useState("");
  const [formula, setFormula] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** Rascunho da nova regra de indicador, por campo. */
  const [ruleDraft, setRuleDraft] = useState<Record<string, RuleDraft>>({});
  const maskRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const close = () => setPanel("fields", false);

  const saveMask = () => {
    useDomainStore.getState().setWbsMask(maskRef.current?.value ?? "");
    setError(null);
  };

  const draftOf = (fieldId: string): RuleDraft => ruleDraft[fieldId] ?? EMPTY_DRAFT;

  const setDraft = (fieldId: string, patch: Partial<RuleDraft>) =>
    setRuleDraft((current) => ({ ...current, [fieldId]: { ...draftOf(fieldId), ...patch } }));

  const addRule = (field: CustomField) => {
    const draft = draftOf(field.id);
    if (!draft.icon.trim()) {
      setError("Informe o ícone da regra.");
      return;
    }
    const rule: IndicatorRule = {
      icon: draft.icon.trim(),
      priority: Number(draft.priority) || 0,
      operator: draft.operator,
      value: draft.value,
    };
    const rules = [...parseIndicatorRules(field.indicatorRules), rule];
    useDomainStore
      .getState()
      .updateCustomField(field.id, { indicatorRules: JSON.stringify(rules) });
    setRuleDraft((current) => ({
      ...current,
      [field.id]: { ...draft, priority: String(rule.priority + 1), value: "" },
    }));
    setError(null);
  };

  const removeRule = (field: CustomField, index: number) => {
    const rules = parseIndicatorRules(field.indicatorRules).filter(
      (_rule, position) => position !== index,
    );
    useDomainStore
      .getState()
      .updateCustomField(field.id, {
        indicatorRules: rules.length > 0 ? JSON.stringify(rules) : null,
      });
  };

  const create = () => {
    if (!projectId) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Informe o nome do campo.");
      return;
    }
    if (Object.values(customFields).some((field) => field.name === trimmed)) {
      setError("Já existe um campo com esse nome.");
      return;
    }

    let config: string | null = null;
    if (dataType === "list") {
      const values = listValues
        .split(/[,;]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length === 0) {
        setError("Informe os valores da lista (separados por vírgula).");
        return;
      }
      config = JSON.stringify({ values });
    }

    if (dataType === "formula") {
      const validation = validateFormulaForCreate(formula);
      if (!validation.ok) {
        setError(validation.reason ?? "Fórmula inválida.");
        return;
      }
    }

    const field: CustomField = {
      id: newId(),
      projectId,
      entityType: "task",
      name: trimmed,
      dataType,
      formula: dataType === "formula" ? formula.trim() : null,
      config,
      showIndicator: false,
      indicatorRules: null,
      sortOrder: Object.keys(customFields).length,
    };

    useDomainStore.getState().addCustomField(field);
    setName("");
    setListValues("");
    setFormula("");
    setError(null);
  };

  const remove = (field: CustomField) => {
    const result = useDomainStore.getState().removeCustomField(field.id, {
      confirm: confirmId === field.id,
    });
    if (result.ok) {
      setError(null);
      setConfirmId(null);
    } else {
      setError(result.reason ?? "Não foi possível excluir.");
      if (result.inUse) setConfirmId(field.id); // segundo clique confirma
    }
  };

  const list = Object.values(customFields)
    .filter((field) => field.entityType === "task")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div
      className={styles.backdrop}
      data-testid="fields-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Campos personalizados"
        data-testid="fields-panel"
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
          <h2 className={styles.title}>Campos personalizados</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="fields-close"
            onClick={close}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.addRow} data-testid="wbs-mask-row">
            <span className={styles.badge}>Máscara WBS</span>
            <input
              type="text"
              className={styles.field}
              data-testid="wbs-mask"
              placeholder="A.00.00.00"
              defaultValue={wbsMask ?? ""}
              key={wbsMask ?? "empty"}
              ref={maskRef}
            />
            <button
              type="button"
              className={styles.addButton}
              data-testid="wbs-mask-save"
              onClick={saveMask}
            >
              Salvar máscara
            </button>
            <span className={styles.meta}>
              Um segmento por nível; vazio usa o número WBS padrão.
            </span>
          </section>

          <section className={styles.addRow}>
            <input
              type="text"
              className={styles.field}
              data-testid="field-name"
              placeholder="Nome do campo"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <select
              className={styles.selectField}
              data-testid="field-type"
              value={dataType}
              onChange={(event) => setDataType(event.target.value)}
            >
              {TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>

            {dataType === "list" && (
              <input
                type="text"
                className={styles.field}
                data-testid="field-list-values"
                placeholder="Baixa, Média, Alta"
                value={listValues}
                onChange={(event) => setListValues(event.target.value)}
              />
            )}

            {dataType === "formula" && (
              <input
                type="text"
                className={styles.formulaField}
                data-testid="field-formula"
                placeholder={'IIF([Duração] > 5d, "Longo", "Curto")'}
                value={formula}
                onChange={(event) => setFormula(event.target.value)}
              />
            )}

            <button
              type="button"
              className={styles.addButton}
              data-testid="field-add"
              onClick={create}
            >
              Criar campo
            </button>
          </section>

          {error && (
            <p className={styles.error} data-testid="field-error">
              {error}
            </p>
          )}

          {list.length === 0 ? (
            <p className={styles.empty} data-testid="fields-empty">
              Nenhum campo personalizado.
            </p>
          ) : (
            <ul className={styles.list}>
              {list.map((field) => {
                const usages = Object.keys(customFieldValues[field.id] ?? {}).length;
                const rules = parseIndicatorRules(field.indicatorRules);
                const draft = draftOf(field.id);
                return (
                  <li
                    key={field.id}
                    className={field.showIndicator ? `${styles.row} ${styles.rowBlock}` : styles.row}
                    data-testid="field-row"
                  >
                    <div className={styles.rowMain}>
                    <input
                      type="text"
                      className={styles.field}
                      data-testid="field-row-name"
                      defaultValue={field.name}
                      key={`${field.id}-${field.name}`}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (next && next !== field.name) {
                          useDomainStore.getState().updateCustomField(field.id, { name: next });
                        }
                      }}
                    />
                    <span className={styles.badge}>{typeLabel(field.dataType)}</span>

                    {field.dataType === "formula" && (
                      <input
                        type="text"
                        className={styles.formulaField}
                        data-testid="field-row-formula"
                        defaultValue={field.formula ?? ""}
                        key={`${field.id}-${field.formula ?? ""}`}
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          const validation = validateFormulaForCreate(next);
                          if (!validation.ok) {
                            setError(validation.reason ?? "Fórmula inválida.");
                            event.target.value = field.formula ?? "";
                            return;
                          }
                          useDomainStore.getState().updateCustomField(field.id, { formula: next });
                          setError(null);
                        }}
                      />
                    )}

                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        data-testid="field-indicator"
                        checked={field.showIndicator ?? false}
                        onChange={(event) =>
                          useDomainStore
                            .getState()
                            .updateCustomField(field.id, { showIndicator: event.target.checked })
                        }
                      />
                      <span>Indicador</span>
                    </label>

                    <span className={styles.meta}>{usages} uso(s)</span>

                    <button
                      type="button"
                      className={styles.removeButton}
                      data-testid={confirmId === field.id ? "field-confirm" : "field-remove"}
                      onClick={() => remove(field)}
                    >
                      {confirmId === field.id ? "Confirmar exclusão" : "Excluir"}
                    </button>
                    </div>

                    {field.showIndicator && (
                      <div className={styles.rules}>
                        {rules.map((rule, index) => (
                          <div
                            key={`${rule.icon}-${rule.priority}-${index}`}
                            className={styles.ruleRow}
                            data-testid="rule-row"
                          >
                            <span className={styles.ruleIcon}>{rule.icon}</span>
                            <span className={styles.meta}>
                              prioridade {rule.priority} ·{" "}
                              {OPERATORS.find((op) => op.value === rule.operator)?.label ??
                                rule.operator}{" "}
                              {String(rule.value)}
                            </span>
                            <button
                              type="button"
                              className={styles.removeButton}
                              data-testid="rule-remove"
                              onClick={() => removeRule(field, index)}
                            >
                              Remover
                            </button>
                          </div>
                        ))}

                        <div className={styles.ruleRow}>
                          <input
                            type="text"
                            className={styles.ruleIconInput}
                            data-testid="rule-icon"
                            aria-label="Ícone"
                            placeholder="⚠"
                            value={draft.icon}
                            onChange={(event) => setDraft(field.id, { icon: event.target.value })}
                          />
                          <input
                            type="number"
                            className={styles.rulePriority}
                            data-testid="rule-priority"
                            aria-label="Prioridade"
                            value={draft.priority}
                            onChange={(event) =>
                              setDraft(field.id, { priority: event.target.value })
                            }
                          />
                          <select
                            className={styles.selectField}
                            data-testid="rule-operator"
                            aria-label="Operador"
                            value={draft.operator}
                            onChange={(event) =>
                              setDraft(field.id, {
                                operator: event.target.value as IndicatorOperator,
                              })
                            }
                          >
                            {OPERATORS.map((operator) => (
                              <option key={operator.value} value={operator.value}>
                                {operator.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            className={styles.ruleValue}
                            data-testid="rule-value"
                            aria-label="Valor"
                            placeholder="valor"
                            value={draft.value}
                            onChange={(event) => setDraft(field.id, { value: event.target.value })}
                          />
                          <button
                            type="button"
                            className={styles.addButton}
                            data-testid="rule-add"
                            onClick={() => addRule(field)}
                          >
                            Adicionar regra
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
