import { useAlerts, ALERT_LABELS } from "../shared/alerts";
import { useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import styles from "./AlertsPanel.module.css";

/**
 * Painel de alertas de desempenho (specs/tracking — "Alertas de desempenho"):
 * atrasadas, prazo excedido, restrição conflitante, superalocadas e vínculo
 * inválido — cada alerta navega até a tarefa (seleciona e rola a visão).
 */
export function AlertsPanel() {
  const open = useUiStore((state) => state.panels.alerts);
  const setPanel = useUiStore((state) => state.setPanel);
  const tasks = useDomainStore((state) => state.tasks);
  const alerts = useAlerts();

  if (!open) return null;

  const close = () => setPanel("alerts", false);

  const goTo = (taskId: string) => {
    const ui = useUiStore.getState();
    ui.setSelection({ rows: [taskId], activeRow: taskId, activeColumn: "name" });
    ui.setRevealTaskId(taskId);
    // fecha o modal para que a grade fique visível com a tarefa revelada
    close();
  };

  return (
    <div
      className={styles.backdrop}
      data-testid="alerts-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Alertas"
        data-testid="alerts-panel"
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
          <h2 className={styles.title}>Alertas</h2>
          <span className={styles.count}>{alerts.length}</span>
          <button
            type="button"
            className={styles.close}
            data-testid="alerts-close"
            onClick={close}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          {alerts.length === 0 ? (
            <p className={styles.empty} data-testid="alerts-empty">
              Nenhum alerta. Tudo dentro do planejado.
            </p>
          ) : (
            <ul className={styles.list}>
              {alerts.map((alert, index) => (
                <li key={`${alert.kind}-${alert.taskId}-${index}`}>
                  <button
                    type="button"
                    className={styles.alertRow}
                    data-testid="alert-row"
                    data-kind={alert.kind}
                    data-task-id={alert.taskId}
                    onClick={() => goTo(alert.taskId)}
                  >
                    <span
                      className={`${styles.badge} ${
                        alert.kind === "delayed" || alert.kind === "deadline"
                          ? styles.badgeDanger
                          : alert.kind === "overallocated"
                            ? styles.badgeWarn
                            : styles.badgeInfo
                      }`}
                    >
                      {ALERT_LABELS[alert.kind]}
                    </span>
                    <span className={styles.taskName}>
                      {tasks[alert.taskId]?.name ?? alert.taskId}
                    </span>
                    <span className={styles.message}>{alert.message}</span>
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
