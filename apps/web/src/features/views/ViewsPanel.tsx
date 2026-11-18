import { useState } from "react";
import { useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import type { LibraryItem } from "../../store/types";
import {
  applyViewSnapshot,
  captureViewSnapshot,
  parseSavedFilter,
  parseSnapshot,
  serializeSnapshot,
} from "./viewConfig";
import styles from "./ViewsPanel.module.css";

/**
 * Visões nomeadas e biblioteca global (specs/views-and-filters):
 * criar, renomear, duplicar, atualizar e remover visões que preservam
 * colunas, filtros, agrupamento, ordenação, layout e zoom — além de
 * salvar filtros na biblioteca do projeto ou na global, compartilhada
 * entre projetos.
 */
export function ViewsPanel() {
  const open = useUiStore((state) => state.panels.views);
  const setPanel = useUiStore((state) => state.setPanel);
  const setViewQuery = useUiStore((state) => state.setViewQuery);
  const libraryItems = useDomainStore((state) => state.libraryItems);
  const saveLibraryItem = useDomainStore((state) => state.saveLibraryItem);
  const updateLibraryItem = useDomainStore((state) => state.updateLibraryItem);
  const removeLibraryItem = useDomainStore((state) => state.removeLibraryItem);

  const [viewName, setViewName] = useState("");
  const [viewScope, setViewScope] = useState<"project" | "global">("project");
  const [filterName, setFilterName] = useState("");
  const [filterScope, setFilterScope] = useState<"project" | "global">("project");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState("");

  if (!open) return null;

  const close = () => setPanel("views", false);
  const items = Object.values(libraryItems);
  const views = items.filter((item) => item.kind === "view");
  const filters = items.filter((item) => item.kind === "filter");

  const scopeOf = (item: LibraryItem) => (item.projectId ? "Projeto" : "Global");

  const saveView = () => {
    const id = saveLibraryItem({
      kind: "view",
      name: viewName,
      config: serializeSnapshot(captureViewSnapshot()),
      scope: viewScope,
    });
    if (id) {
      setViewName("");
      setError("");
    } else {
      setError("Informe um nome para a visão.");
    }
  };

  const applyView = (item: LibraryItem) => {
    const snapshot = parseSnapshot(item.config);
    if (!snapshot) {
      setError(`A visão “${item.name}” está em um formato inválido.`);
      return;
    }
    setError("");
    applyViewSnapshot(snapshot);
    close();
  };

  const updateView = (item: LibraryItem) => {
    updateLibraryItem(item.id, { config: serializeSnapshot(captureViewSnapshot()) });
  };

  const duplicate = (item: LibraryItem) => {
    saveLibraryItem({
      kind: item.kind,
      name: `${item.name} (cópia)`,
      config: item.config,
      scope: item.projectId ? "project" : "global",
    });
  };

  const startRename = (item: LibraryItem) => {
    setRenamingId(item.id);
    setRenameValue(item.name);
    setError("");
  };

  const confirmRename = (item: LibraryItem) => {
    updateLibraryItem(item.id, { name: renameValue });
    setRenamingId(null);
  };

  const saveFilter = () => {
    const id = saveLibraryItem({
      kind: "filter",
      name: filterName,
      config: JSON.stringify({ query: useUiStore.getState().query }),
      scope: filterScope,
    });
    if (id) {
      setFilterName("");
      setError("");
    } else {
      setError("Informe um nome para o filtro.");
    }
  };

  const applyFilter = (item: LibraryItem) => {
    const query = parseSavedFilter(item.config);
    if (!query) {
      setError(`O filtro “${item.name}” está em um formato inválido.`);
      return;
    }
    setError("");
    setViewQuery({ query });
    close();
  };

  const rowActions = (item: LibraryItem, onApply: () => void, prefix: string, applyLabel: string) =>
    renamingId === item.id ? (
      <>
        <input
          className={styles.renameInput}
          data-testid={`${prefix}-rename-input`}
          aria-label={`Novo nome de ${item.name}`}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") confirmRename(item);
            if (event.key === "Escape") setRenamingId(null);
          }}
        />
        <button
          type="button"
          className={styles.actionButton}
          data-testid={`${prefix}-rename-confirm`}
          onClick={() => confirmRename(item)}
        >
          Ok
        </button>
        <button
          type="button"
          className={styles.actionButton}
          data-testid={`${prefix}-rename-cancel`}
          onClick={() => setRenamingId(null)}
        >
          Cancelar
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          className={styles.applyButton}
          data-testid={`${prefix}-apply`}
          onClick={onApply}
        >
          {applyLabel}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          data-testid={`${prefix}-rename`}
          onClick={() => startRename(item)}
        >
          Renomear
        </button>
        <button
          type="button"
          className={styles.actionButton}
          data-testid={`${prefix}-duplicate`}
          onClick={() => duplicate(item)}
        >
          Duplicar
        </button>
        <button
          type="button"
          className={styles.actionButton}
          data-testid={`${prefix}-delete`}
          onClick={() => {
            removeLibraryItem(item.id);
            if (renamingId === item.id) setRenamingId(null);
          }}
        >
          Excluir
        </button>
      </>
    );

  return (
    <div
      className={styles.backdrop}
      data-testid="views-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Visões e biblioteca"
        data-testid="views-panel"
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
          <h2 className={styles.title}>Visões e biblioteca</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="views-close"
            onClick={close}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          {error && (
            <p className={styles.error} role="alert" data-testid="views-error">
              {error}
            </p>
          )}

          {/* --- visões nomeadas --------------------------------------------- */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Visões</h3>
            <p className={styles.hint}>
              Cada visão guarda colunas, filtros, agrupamento, ordenação, layout e zoom.
            </p>

            <div className={styles.addRow}>
              <input
                className={styles.nameInput}
                data-testid="view-name"
                aria-label="Nome da visão"
                placeholder="Nome da visão"
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
              />
              <select
                className={styles.field}
                data-testid="view-scope"
                aria-label="Escopo da visão"
                value={viewScope}
                onChange={(event) => setViewScope(event.target.value as "project" | "global")}
              >
                <option value="project">Projeto</option>
                <option value="global">Biblioteca global</option>
              </select>
              <button
                type="button"
                className={styles.saveButton}
                data-testid="view-save"
                onClick={saveView}
              >
                Salvar visão
              </button>
            </div>

            {views.length === 0 && (
              <p className={styles.empty} data-testid="views-empty">
                Nenhuma visão salva.
              </p>
            )}

            {views.map((item) => (
              <div
                key={item.id}
                className={styles.row}
                data-testid="view-row"
                data-name={item.name}
              >
                <span
                  className={styles.badge}
                  data-testid="view-row-scope"
                  data-scope={item.projectId ? "project" : "global"}
                >
                  {scopeOf(item)}
                </span>
                <span className={styles.rowName}>{item.name}</span>
                {renamingId !== item.id && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    data-testid="view-update"
                    onClick={() => updateView(item)}
                  >
                    Atualizar com o estado atual
                  </button>
                )}
                {rowActions(item, () => applyView(item), "view", "Usar")}
              </div>
            ))}
          </section>

          {/* --- biblioteca de filtros ---------------------------------------- */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Filtros da biblioteca</h3>
            <p className={styles.hint}>
              Itens da biblioteca global ficam disponíveis em todos os projetos.
            </p>

            <div className={styles.addRow}>
              <input
                className={styles.nameInput}
                data-testid="filter-lib-name"
                aria-label="Nome do filtro"
                placeholder="Nome do filtro"
                value={filterName}
                onChange={(event) => setFilterName(event.target.value)}
              />
              <select
                className={styles.field}
                data-testid="filter-lib-scope"
                aria-label="Escopo do filtro"
                value={filterScope}
                onChange={(event) => setFilterScope(event.target.value as "project" | "global")}
              >
                <option value="project">Projeto</option>
                <option value="global">Biblioteca global</option>
              </select>
              <button
                type="button"
                className={styles.saveButton}
                data-testid="filter-lib-save"
                onClick={saveFilter}
              >
                Salvar filtro atual
              </button>
            </div>

            {filters.length === 0 && (
              <p className={styles.empty} data-testid="filter-lib-empty">
                Nenhum filtro salvo.
              </p>
            )}

            {filters.map((item) => (
              <div
                key={item.id}
                className={styles.row}
                data-testid="filter-lib-row"
                data-name={item.name}
              >
                <span
                  className={styles.badge}
                  data-testid="filter-lib-row-scope"
                  data-scope={item.projectId ? "project" : "global"}
                >
                  {scopeOf(item)}
                </span>
                <span className={styles.rowName}>{item.name}</span>
                {rowActions(item, () => applyFilter(item), "filter-lib", "Usar")}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
