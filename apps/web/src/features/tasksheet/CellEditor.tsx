import { useEffect, useRef, useState } from "react";
import { initialCellText, parseCell, type CellType } from "./cells";
import styles from "./CellEditor.module.css";

export type { CellType };

export interface CellEditorProps {
  type: CellType;
  value: unknown;
  /** Opções para o tipo `list`. */
  options?: readonly string[];
  /** Rótulo acessível da célula. */
  label: string;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
  /** Avisa a grade que há edição em curso (guarda de atalhos). */
  onEditingChange?: (editing: boolean) => void;
  /** Texto inicial quando a edição começou por digitação direta. */
  seed?: string;
}

/**
 * Editor de célula (specs/task-sheet — "Edição 100% inline").
 *
 * Regras:
 *  - `Enter` e `Tab` confirmam; `Esc` cancela;
 *  - valor inválido mantém a célula **aberta**, com o motivo visível;
 *  - a grade é avisada enquanto a edição está ativa (guarda de atalhos).
 */
export function CellEditor({
  type,
  value,
  options = [],
  label,
  onCommit,
  onCancel,
  onEditingChange,
  seed,
}: CellEditorProps) {
  const [text, setText] = useState(() => seed ?? initialCellText(type, value));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  /** Evita que o blur confirme depois de um commit/cancelamento. */
  const closedRef = useRef(false);

  useEffect(() => {
    onEditingChange?.(true);
    const node = inputRef.current ?? selectRef.current;
    node?.focus();
    // Em digitação direta o `seed` é o primeiro caractere digitado: fica no
    // final para os próximos acrescentarem; sem seed (F2/duplo-clique) o
    // valor atual é selecionado para ser substituído.
    if (node instanceof HTMLInputElement && seed === undefined) node.select();
    return () => onEditingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (next = text) => {
    if (closedRef.current) return;

    const result = parseCell(type, next, options);
    if (!result.ok) {
      setError(result.reason ?? "Valor inválido");
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    closedRef.current = true;
    setError(null);
    onCommit(result.value);
  };

  if (type === "list") {
    return (
      <div className={styles.wrap}>
        <select
          ref={selectRef}
          className={styles.select}
          data-testid="cell-editor"
          aria-label={label}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            commit(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closedRef.current = true;
              onCancel();
            }
          }}
        >
          <option value="">—</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {error && (
          <span className={styles.error} role="alert" data-testid="cell-error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <input
        ref={inputRef}
        className={`${styles.input} ${error ? styles.invalid : ""}`}
        data-testid="cell-editor"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            commit();
            return;
          }
          if (event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            commit();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closedRef.current = true;
            onCancel();
          }
        }}
        onBlur={() => commit()}
      />
      {error && (
        <span className={styles.error} role="alert" data-testid="cell-error">
          {error}
        </span>
      )}
    </div>
  );
}
