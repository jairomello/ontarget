import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PROJECT_TEMPLATES } from "@ontarget/core";
import { api, formatDate, formatDateTime, type ProjectSummary } from "../../lib/api";
import styles from "./PortfolioPage.module.css";

type SortKey = "updated" | "name" | "start";

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Atualização recente",
  name: "Nome (A–Z)",
  start: "Data de início",
};

/** Janela de desfazer da exclusão (specs/portfolio: 10 segundos). */
const UNDO_WINDOW_MS = 10_000;

export function PortfolioPage() {
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [showArchived, setShowArchived] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("vazio");
  const [submitting, setSubmitting] = useState(false);

  const [undoTarget, setUndoTarget] = useState<ProjectSummary | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api.listProjects(showArchived);
      setProjects(body.projects);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar os projetos");
    }
  }, [showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const visible = useMemo(() => {
    if (!projects) return [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            (p.code ?? "").toLowerCase().includes(needle),
        )
      : projects;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "pt-BR");
      if (sort === "start") return (a.start ?? 0) - (b.start ?? 0);
      return b.updated_at - a.updated_at;
    });
    return sorted;
  }, [projects, query, sort]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim() || submitting) return;

    setSubmitting(true);
    try {
      const created = await api.createProject({
        name: newName.trim(),
        templateKey: newTemplate,
      });
      setNewName("");
      setCreateOpen(false);
      // Spec: o projeto criado abre automaticamente na Task Sheet.
      navigate(`/p/${created.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar o projeto");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDuplicate(project: ProjectSummary) {
    try {
      await api.duplicateProject(project.project_id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao duplicar");
    }
  }

  async function handleArchive(project: ProjectSummary) {
    try {
      await api.archiveProject(project.project_id, project.archived === 0);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao arquivar");
    }
  }

  async function handleDelete(project: ProjectSummary) {
    const confirmed = window.confirm(
      `Excluir "${project.name}"?\n\nAs tarefas, recursos e dados do projeto serão removidos. Você terá 10 segundos para desfazer.`,
    );
    if (!confirmed) return;

    try {
      await api.deleteProject(project.project_id);
      setUndoTarget(project);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndoTarget(null), UNDO_WINDOW_MS);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir");
    }
  }

  async function handleUndoDelete() {
    if (!undoTarget) return;
    try {
      await api.restoreProject(undoTarget.project_id);
      setUndoTarget(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível desfazer");
    }
  }

  const isLoading = projects === null;

  return (
    <div className={styles.page} data-testid="portfolio">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <h1 className={styles.title}>Projetos</h1>
          <span className={styles.count} data-testid="portfolio-count">
            {isLoading ? "" : `${visible.length} ${visible.length === 1 ? "projeto" : "projetos"}`}
          </span>
        </div>

        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.search}
            data-testid="portfolio-search"
            placeholder="Buscar projeto…"
            aria-label="Buscar projeto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <select
            className={styles.sortSelect}
            data-testid="portfolio-sort"
            aria-label="Ordenar projetos"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>

          <label className={styles.checkbox}>
            <input
              type="checkbox"
              data-testid="portfolio-show-archived"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Arquivados
          </label>

          <button
            type="button"
            className={styles.primaryButton}
            data-testid="new-project"
            onClick={() => setCreateOpen((open) => !open)}
          >
            Novo projeto
          </button>
        </div>
      </header>

      {error && (
        <div className={styles.error} role="alert" data-testid="portfolio-error">
          {error}
        </div>
      )}

      {createOpen && (
        <form className={styles.createPanel} onSubmit={handleCreate} data-testid="create-form">
          <label className={styles.field}>
            <span>Nome</span>
            <input
              autoFocus
              data-testid="new-project-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex.: Portal Institucional"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Template</span>
            <select
              data-testid="new-project-template"
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value)}
            >
              {PROJECT_TEMPLATES.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.createActions}>
            <button
              type="button"
              className={styles.ghostButton}
              data-testid="new-project-cancel"
              onClick={() => setCreateOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              data-testid="new-project-submit"
              disabled={submitting}
            >
              Criar
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className={styles.muted}>Carregando…</p>}

      {!isLoading && visible.length === 0 && query.trim() !== "" && (
        <section className={styles.empty} data-testid="portfolio-no-match">
          <p className={styles.emptyTitle}>Nenhum projeto corresponde a “{query}”</p>
          <p className={styles.emptyHint}>Ajuste a busca ou limpe o campo para ver todos.</p>
        </section>
      )}

      {!isLoading && visible.length === 0 && query.trim() === "" && (
        <section className={styles.empty} data-testid="portfolio-empty">
          <p className={styles.emptyTitle}>
            {showArchived ? "Nenhum projeto arquivado" : "Nenhum projeto ainda"}
          </p>
          <p className={styles.emptyHint}>
            Crie um projeto vazio, use um template ou importe um arquivo JSON/CSV para começar.
          </p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setCreateOpen(true)}
          >
            Criar primeiro projeto
          </button>
        </section>
      )}

      {!isLoading && visible.length > 0 && (
        <ul className={styles.grid} data-testid="portfolio-grid">
          {visible.map((project) => (
            <li
              key={project.project_id}
              className={styles.card}
              data-testid="portfolio-card"
              data-project-id={project.project_id}
            >
              <span
                className={styles.colorStripe}
                style={{ background: project.color ?? "var(--accent)" }}
                aria-hidden="true"
              />

              <div className={styles.cardBody}>
                <div className={styles.cardTop}>
                  <Link
                    className={styles.cardTitle}
                    to={`/p/${project.project_id}`}
                    data-testid="project-link"
                  >
                    {project.name}
                  </Link>
                  {project.archived === 1 && <span className={styles.badge}>Arquivado</span>}
                </div>

                <p className={styles.period}>
                  {formatDate(project.min_start ?? project.start)} —{" "}
                  {formatDate(project.max_finish ?? project.finish)}
                </p>

                <div className={styles.progressRow}>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-valuenow={Math.round(project.percent_complete)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Conclusão de ${project.name}`}
                  >
                    <div
                      className={styles.progressFill}
                      style={{ width: `${Math.round(project.percent_complete)}%` }}
                    />
                  </div>
                  <span className={styles.percent} data-testid="project-percent">
                    {Math.round(project.percent_complete)}%
                  </span>
                </div>

                <dl className={styles.meta}>
                  <div>
                    <dt>Tarefas</dt>
                    <dd className="num" data-testid="project-task-count">
                      {project.task_count}
                    </dd>
                  </div>
                  <div>
                    <dt>Recursos</dt>
                    <dd className="num">{project.resource_count}</dd>
                  </div>
                  <div>
                    <dt>Atualizado</dt>
                    <dd>{formatDateTime(project.updated_at)}</dd>
                  </div>
                </dl>

                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => void handleDuplicate(project)}
                  >
                    Duplicar
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => void handleArchive(project)}
                  >
                    {project.archived === 1 ? "Restaurar" : "Arquivar"}
                  </button>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() => void handleDelete(project)}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {undoTarget && (
        <div className={styles.undoBar} role="status" data-testid="undo-bar">
          <span>“{undoTarget.name}” foi excluído.</span>
          <button
            type="button"
            className={styles.undoButton}
            data-testid="undo-delete"
            onClick={() => void handleUndoDelete()}
          >
            Desfazer
          </button>
        </div>
      )}
    </div>
  );
}
