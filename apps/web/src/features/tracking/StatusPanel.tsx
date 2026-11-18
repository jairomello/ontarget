import { classifyDelay, defaultCalendar, type Calendar } from "@ontarget/core";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { selectActiveCalendar, toCoreCalendar, useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import styles from "./StatusPanel.module.css";

/** `yyyy-mm-dd` (UTC-naive) a partir de epoch ms. */
function toIso(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** epoch ms (meia-noite UTC-naive) a partir de `yyyy-mm-dd`; `null` se inválido. */
function fromIso(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function today(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Painel de data de status (specs/tracking — "Data de status" e "Atualização
 * em lote"): definir a data (ou seguir a data corrente), executar a
 * atualização do projeto/seleção e listar as tarefas atrasadas com o desvio
 * em dias.
 */
export function StatusPanel() {
  const open = useUiStore((state) => state.panels.statusdate);
  const setPanel = useUiStore((state) => state.setPanel);
  const projectId = useDomainStore((state) => state.projectId);
  const tasks = useDomainStore((state) => state.tasks);
  const taskOrder = useDomainStore((state) => state.taskOrder);
  const selection = useUiStore((state) => state.selection.rows);

  const statusDate = useDomainStore((state) => state.statusDate);
  const statusAuto = useDomainStore((state) => state.statusAuto);
  const setProjectStatus = useDomainStore((state) => state.setProjectStatus);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "atualizando-a automaticamente para a data corrente quando configurado"
  // — roda ao abrir o projeto, com ou sem o painel visível.
  useEffect(() => {
    if (!projectId || !statusAuto) return;
    const day = today();
    if (statusDate === day) return;
    void api.updateProject(projectId, { statusDate: day }).then(() => {
      setProjectStatus({ statusDate: day });
    });
  }, [projectId, statusAuto, statusDate, setProjectStatus]);

  if (!open) return null;

  const close = () => setPanel("statusdate", false);
  const effectiveStatus = statusDate ?? today();

  const calendar: Calendar = (() => {
    const active = selectActiveCalendar(useDomainStore.getState());
    return (active ? toCoreCalendar(useDomainStore.getState(), active.id) : null) ?? defaultCalendar();
  })();

  const delayed = taskOrder
    .map((id) => tasks[id])
    .filter((task): task is NonNullable<typeof task> => task !== undefined && !task.isInactive)
    .map((task) => ({ task, delay: classifyDelay(task, effectiveStatus, calendar) }))
    .filter((entry) => entry.delay.delayed);

  const changeDate = (iso: string) => {
    const parsed = fromIso(iso);
    if (parsed === null || !projectId) return;
    void api.updateProject(projectId, { statusDate: parsed }).then(() => {
      setProjectStatus({ statusDate: parsed });
    });
  };

  const changeAuto = (checked: boolean) => {
    if (!projectId) return;
    void api.updateProject(projectId, { statusAuto: checked }).then(() => {
      setProjectStatus({ statusAuto: checked });
    });
  };

  const runUpdate = (target: "project" | "tasks") => {
    setError(null);
    if (target === "tasks" && selection.length === 0) {
      setError("Selecione as tarefas para atualizar.");
      setResult(null);
      return;
    }
    const count = useDomainStore
      .getState()
      .bulkUpdateProgress(target === "project" ? "all" : selection, effectiveStatus);
    setResult(
      target === "project"
        ? `${count} tarefa${count === 1 ? "" : "s"} atualizada${count === 1 ? "" : "s"} no projeto.`
        : `${count} tarefa${count === 1 ? "" : "s"} da seleção atualizada${count === 1 ? "" : "s"}.`,
    );
  };

  return (
    <div
      className={styles.backdrop}
      data-testid="statusdate-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Data de status"
        data-testid="statusdate-panel"
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
          <h2 className={styles.title}>Data de status</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="statusdate-close"
            onClick={close}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <label className={styles.field}>
              <span>Data de status</span>
              <input
                type="date"
                data-testid="status-date"
                value={statusDate !== null ? toIso(statusDate) : ""}
                onChange={(event) => {
                  if (event.target.value) changeDate(event.target.value);
                }}
              />
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                data-testid="status-auto"
                checked={statusAuto}
                onChange={(event) => changeAuto(event.target.checked)}
              />
              <span>Usar a data corrente automaticamente</span>
            </label>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.addButton}
                data-testid="update-project"
                onClick={() => runUpdate("project")}
              >
                Atualizar projeto
              </button>
              <button
                type="button"
                className={styles.addButton}
                data-testid="update-tasks"
                onClick={() => runUpdate("tasks")}
              >
                Atualizar tarefas ({selection.length})
              </button>
            </div>

            {error && (
              <p className={styles.error} data-testid="update-error">
                {error}
              </p>
            )}
            {result && (
              <p className={styles.result} data-testid="update-result">
                {result}
              </p>
            )}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Atrasadas</h3>
            {delayed.length === 0 ? (
              <p className={styles.empty} data-testid="no-delays">
                Nenhuma tarefa atrasada em relação à data de status.
              </p>
            ) : (
              <ul className={styles.list}>
                {delayed.map(({ task, delay }) => (
                  <li
                    key={task.id}
                    className={styles.delayRow}
                    data-testid="delayed-row"
                    data-task-id={task.id}
                    data-deviation={delay.deviationDays}
                  >
                    <span className={styles.taskName}>{task.name}</span>
                    <span className={styles.deviation}>{delay.deviationDays}d de atraso</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
