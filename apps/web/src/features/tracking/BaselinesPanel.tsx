import { useState } from "react";
import { formatDateTime } from "../../lib/api";
import { useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import styles from "./BaselinesPanel.module.css";

/**
 * Baselines e planos provisórios (specs/tracking — "Linhas de base
 * múltiplas" e "Planos provisórios"): salvar com escopo de projeto ou da
 * seleção atual (até 11 baselines), listar e remover.
 */
export function BaselinesPanel() {
  const open = useUiStore((state) => state.panels.baselines);
  const setPanel = useUiStore((state) => state.setPanel);
  const selectionRows = useUiStore((state) => state.selection.rows);
  const baselines = useDomainStore((state) => state.baselines);
  const baselineValues = useDomainStore((state) => state.baselineValues);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<"baseline" | "interim">("baseline");
  const [scope, setScope] = useState<"project" | "selection">("project");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const close = () => setPanel("baselines", false);

  const save = () => {
    const result = useDomainStore.getState().saveBaseline({
      name,
      kind,
      scope,
      taskIds: selectionRows,
    });
    if (result.ok) {
      setName("");
      setError(null);
    } else {
      setError(result.message ?? "Não foi possível salvar.");
    }
  };

  const list = Object.values(baselines).sort((a, b) => b.savedAt - a.savedAt);

  return (
    <div
      className={styles.backdrop}
      data-testid="baselines-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Linhas de base"
        data-testid="baselines-panel"
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
          <h2 className={styles.title}>Linhas de base</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="baselines-close"
            onClick={close}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.addRow}>
            <input
              type="text"
              className={styles.field}
              data-testid="baseline-name"
              placeholder="Nome (ex.: Baseline 1)"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <select
              className={styles.field}
              data-testid="baseline-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as "baseline" | "interim")}
            >
              <option value="baseline">Linha de base</option>
              <option value="interim">Plano provisório</option>
            </select>
            <select
              className={styles.field}
              data-testid="baseline-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as "project" | "selection")}
            >
              <option value="project">Projeto inteiro</option>
              <option value="selection">
                Seleção atual ({selectionRows.length} tarefa
                {selectionRows.length === 1 ? "" : "s"})
              </option>
            </select>
            <button
              type="button"
              className={styles.addButton}
              data-testid="baseline-save"
              onClick={save}
            >
              Salvar
            </button>
          </section>

          {error && (
            <p className={styles.error} data-testid="baseline-error">
              {error}
            </p>
          )}

          {list.length === 0 ? (
            <p className={styles.empty} data-testid="baselines-empty">
              Nenhuma linha de base salva.
            </p>
          ) : (
            <ul className={styles.list}>
              {list.map((baseline) => (
                <li key={baseline.id} className={styles.row} data-testid="baseline-row">
                  <span className={styles.name}>{baseline.name}</span>
                  <span
                    className={baseline.kind === "interim" ? styles.badgeInterim : styles.badge}
                  >
                    {baseline.kind === "interim" ? "Plano provisório" : "Linha de base"}
                  </span>
                  <span className={styles.meta}>
                    {baseline.scope === "selection" ? "Seleção" : "Projeto"} ·{" "}
                    {Object.keys(baselineValues[baseline.id] ?? {}).length} tarefas ·{" "}
                    {formatDateTime(baseline.savedAt)}
                  </span>
                  <button
                    type="button"
                    className={styles.removeButton}
                    data-testid="baseline-remove"
                    onClick={() => useDomainStore.getState().removeBaseline(baseline.id)}
                  >
                    Excluir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
