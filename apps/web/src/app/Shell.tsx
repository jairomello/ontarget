import { useState, type ReactNode } from "react";
import { useMatch, useNavigate, Outlet } from "react-router";
import { useHotkeys } from "../commands";
import { ProfileMenu } from "../features/auth/ProfileMenu";
import { CalendarPanel } from "../features/calendars/CalendarPanel";
import { ResourcesPanel } from "../features/resources/ResourcesPanel";
import { TeamPanel } from "../features/team/TeamPanel";
import { BaselinesPanel } from "../features/tracking/BaselinesPanel";
import { StatusPanel } from "../features/tracking/StatusPanel";
import { AlertsPanel } from "../features/tracking/AlertsPanel";
import { FieldsPanel } from "../features/fields/FieldsPanel";
import { FiltersPanel } from "../features/filters/FiltersPanel";
import { ImportDialog } from "../features/import/ImportDialog";
import {
  buildCsvExport,
  buildExportPayload,
  downloadFile,
  type ExportColumn,
  type ExportRow,
} from "../features/export/exporting";
import { cellText } from "../features/tasksheet/TaskSheet";
import { COLUMN_DEFS, isCustomColumnKey } from "../features/tasksheet/columns";
import { useQueryRows } from "../features/shared/query";
import { ViewsPanel } from "../features/views/ViewsPanel";
import { useAlerts } from "../features/shared/alerts";
import {
  formatSignedDays,
  projectFinishDeviation,
  useSelectedBaseline,
} from "../features/shared/tracking";
import { runCommand } from "../commands";
import { useComputedStore } from "../store/computedStore";
import { useDomainStore } from "../store/domainStore";
import { useUiStore, type PanelsState, type ViewKind } from "../store/uiStore";
import { ShortcutsOverlay } from "../ui/ShortcutsOverlay";
import { ZoomControls } from "../ui/ZoomControls";
import { useAppearance } from "../ui/useAppearance";
import styles from "./Shell.module.css";

/** Abas da ribbon da barra de comandos (docs/Design.md §3). */
const RIBBON_TABS: Array<{ id: string; label: string }> = [
  { id: "tarefa", label: "Tarefa" },
  { id: "recurso", label: "Recurso" },
  { id: "projeto", label: "Projeto" },
  { id: "ver", label: "Ver" },
  { id: "formatar", label: "Formatar" },
];

/**
 * Invólucro da aplicação (docs/Design.md §3):
 * barra de aplicação, barra de comandos, conteúdo e barra de status.
 */
export function Shell() {
  const { appearance, setTheme, setDensity } = useAppearance();
  const navigate = useNavigate();
  const projectMatch = useMatch("/p/:projectId");
  const [importOpen, setImportOpen] = useState(false);
  const columnState = useUiStore((state) => state.columnState);
  const customFields = useDomainStore((state) => state.customFields);
  const visibleRows = useQueryRows();

  const labelOfColumn = (key: string): string =>
    COLUMN_DEFS[key]?.label ??
    (isCustomColumnKey(key) ? customFields[key.slice(3)]?.name ?? key : key);

  /** JSON completo no formato do produto (round-trip com a importação). */
  const exportJson = () => {
    const state = useDomainStore.getState();
    if (!state.projectId) return;
    const payload = buildExportPayload({
      tasks: Object.values(state.tasks),
      taskLinks: Object.values(state.taskLinks),
      resources: Object.values(state.resources),
      assignments: Object.values(state.assignments),
      customFields: Object.values(state.customFields),
      customFieldValues: Object.values(state.customFieldValues).flatMap((byEntity) =>
        Object.values(byEntity),
      ),
      baselines: Object.values(state.baselines),
      baselineValues: Object.values(state.baselineValues).flatMap((byTask) =>
        Object.values(byTask),
      ),
    });
    downloadFile("exportacao.json", JSON.stringify(payload, null, 2), "application/json");
  };

  /** CSV do escopo visível: linhas (filtros/grupos/ordem) e colunas exibidas. */
  const exportCsv = () => {
    const state = useDomainStore.getState();
    if (!state.projectId) return;

    const columns: ExportColumn[] = columnState[activeView]
      .filter((column) => column.visible && column.key !== "toggle")
      .map((column) => ({ key: column.key, label: labelOfColumn(column.key) }));

    const exportRows: ExportRow[] = visibleRows.map((row) =>
      row.isGroup
        ? { kind: "group", label: row.groupLabel ?? "" }
        : { kind: "task", id: row.id },
    );

    const valueOf = (key: string, taskId: string): string => {
      const task = state.tasks[taskId];
      if (!task) return "";
      const def = COLUMN_DEFS[key];
      if (def) return cellText(def, task as unknown as Record<string, unknown>);
      if (isCustomColumnKey(key)) {
        return cellText({ key, label: "", width: 140 }, task as unknown as Record<string, unknown>);
      }
      return "";
    };

    downloadFile(
      "exportacao.csv",
      buildCsvExport(columns, exportRows, valueOf),
      "text/csv;charset=utf-8",
    );
  };
  const focus = useUiStore((state) => state.focus);
  const detailsOpen = useUiStore((state) => state.panels.details);
  const timelineOpen = useUiStore((state) => state.panels.timeline);
  const calendarsOpen = useUiStore((state) => state.panels.calendars);
  const resourcesOpen = useUiStore((state) => state.panels.resources);
  const teamOpen = useUiStore((state) => state.panels.team);
  const baselinesOpen = useUiStore((state) => state.panels.baselines);
  const statusdateOpen = useUiStore((state) => state.panels.statusdate);
  const alertsOpen = useUiStore((state) => state.panels.alerts);
  const alerts = useAlerts();
  const schedule = useComputedStore((state) => state.schedule);
  const computation = useComputedStore((state) => state.computation);
  const setPanel = useUiStore((state) => state.setPanel);
  const activeView = useUiStore((state) => state.activeView);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const setTrackingBaseline = useUiStore((state) => state.setTrackingBaseline);
  const baselines = useDomainStore((state) => state.baselines);
  const tasks = useDomainStore((state) => state.tasks);
  const tracking = useSelectedBaseline();
  const saveState = useUiStore((state) => state.saveState);
  const panels = useUiStore((state) => state.panels);
  const selection = useUiStore((state) => state.selection);
  const cellEditing = useUiStore((state) => state.cellEditing);
  const criticalVisible = useUiStore((state) => state.criticalVisible);
  const setCriticalVisible = useUiStore((state) => state.setCriticalVisible);
  const [activeTab, setActiveTab] = useState("tarefa");
  useHotkeys();

  const hasSelection = selection.rows.length > 0 && !cellEditing;
  const togglePanel = (key: keyof PanelsState) => () => setPanel(key, !panels[key]);
  const runGrid = (id: string) => () =>
    runCommand(id, {
      scope: useUiStore.getState().focus,
      editing: useUiStore.getState().cellEditing,
    });

  /* --------------------------------------------------------------- ribbon */

  const ribbonButton = (
    testid: string,
    icon: string,
    label: string,
    onClick: () => void,
    options: { disabled?: boolean; pressed?: boolean } = {},
  ) => (
    <button
      key={testid}
      type="button"
      className={styles.ribbonButton}
      data-testid={testid}
      disabled={options.disabled ?? false}
      aria-pressed={options.pressed}
      title={label}
      onClick={onClick}
    >
      <span className={styles.ribbonIcon} aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );

  const ribbonGroup = (title: string, buttons: ReactNode) => (
    <div className={styles.ribbonGroup} role="group" aria-label={title}>
      <span className={styles.groupTitle}>{title}</span>
      <span className={styles.groupButtons}>{buttons}</span>
    </div>
  );

  /** Conteúdo da aba ativa (docs/Design.md §3 — grupos com ícone + rótulo). */
  const ribbonContent = (projectId?: string) => {
    switch (activeTab) {
      case "tarefa":
        return (
          <>
            {ribbonGroup("Estrutura", [
              ribbonButton("ribbon-move-up", "↑", "Mover p/ cima", runGrid("grid.moveUp"), {
                disabled: !hasSelection,
              }),
              ribbonButton("ribbon-move-down", "↓", "Mover p/ baixo", runGrid("grid.moveDown"), {
                disabled: !hasSelection,
              }),
              ribbonButton("ribbon-outdent", "←", "Outdentar", runGrid("grid.outdent"), {
                disabled: !hasSelection,
              }),
              ribbonButton("ribbon-indent", "→", "Indentar", runGrid("grid.indent"), {
                disabled: !hasSelection,
              }),
            ])}
            {ribbonGroup("Tarefa", [
              ribbonButton("ribbon-insert", "+", "Inserir", runGrid("grid.insertTask")),
              ribbonButton(
                "ribbon-insert-sub",
                "⊕",
                "Inserir subtarefa",
                runGrid("grid.insertSubtask"),
              ),
              ribbonButton("ribbon-delete", "✕", "Apagar", runGrid("grid.deleteTask"), {
                disabled: !hasSelection,
              }),
            ])}
          </>
        );

      case "recurso":
        return ribbonGroup("Pessoas", [
          ribbonButton("ribbon-resources", "◉", "Recursos", togglePanel("resources"), {
            pressed: panels.resources,
          }),
          ribbonButton("ribbon-team", "☰", "Painel de equipe", togglePanel("team"), {
            pressed: panels.team,
          }),
        ]);

      case "projeto":
        return (
          <>
            {ribbonGroup("Controle", [
              ribbonButton("ribbon-baseline", "▱", "Baseline", togglePanel("baselines"), {
                pressed: panels.baselines,
              }),
              ribbonButton(
                "ribbon-statusdate",
                "🕒",
                "Data de status",
                togglePanel("statusdate"),
                { pressed: panels.statusdate },
              ),
            ])}
            {ribbonGroup("Dados", [
              ribbonButton("import-open", "⤓", "Importar", () => setImportOpen(true)),
              ribbonButton("export-json", "{ }", "Exportar JSON", exportJson),
              ribbonButton("export-csv", "▤", "Exportar CSV", exportCsv),
            ])}
            {ribbonGroup("Saída", [
              ribbonButton("print-open", "🖨", "Imprimir", () => {
                if (projectId) navigate(`/p/${projectId}/print`);
              }),
            ])}
          </>
        );

      case "ver":
        return ribbonGroup("Painéis", [
          ribbonButton("ribbon-details", "◧", "Detalhes", togglePanel("details"), {
            pressed: panels.details,
          }),
          ribbonButton("ribbon-timeline", "—", "Timeline", togglePanel("timeline"), {
            pressed: panels.timeline,
          }),
          ribbonButton("ribbon-filters", "⚗", "Filtros", togglePanel("filters"), {
            pressed: panels.filters,
          }),
          ribbonButton("ribbon-views", "☆", "Visões", togglePanel("views"), {
            pressed: panels.views,
          }),
          ribbonButton("ribbon-fields", "⚑", "Campos", togglePanel("fields"), {
            pressed: panels.fields,
          }),
          ribbonButton(
            "ribbon-critical",
            "✱",
            "Caminho crítico",
            () => setCriticalVisible(!criticalVisible),
            { pressed: criticalVisible },
          ),
        ]);

      case "formatar":
        return (
          <>
            {ribbonGroup("Tema", [
              ribbonButton("ribbon-theme-light", "☀", "Claro", () => setTheme("light"), {
                pressed: appearance.theme === "light",
              }),
              ribbonButton(
                "ribbon-theme-auto",
                "◐",
                "Automático",
                () => setTheme("auto"),
                { pressed: appearance.theme === "auto" },
              ),
              ribbonButton("ribbon-theme-dark", "☾", "Escuro", () => setTheme("dark"), {
                pressed: appearance.theme === "dark",
              }),
            ])}
            {ribbonGroup("Densidade", [
              ribbonButton(
                "ribbon-density-compact",
                "≡",
                "Compacta",
                () => setDensity("compact"),
                { pressed: appearance.density === "compact" },
              ),
              ribbonButton(
                "ribbon-density-comfortable",
                "☰",
                "Confortável",
                () => setDensity("comfortable"),
                { pressed: appearance.density === "comfortable" },
              ),
              ribbonButton("ribbon-density-wide", "▤", "Ampla", () => setDensity("wide"), {
                pressed: appearance.density === "wide",
              }),
            ])}
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className={styles.shell} data-app-shell="root" data-testid="app-shell">
      <header className={styles.appBar} data-testid="app-bar">
        <div className={styles.brandGroup}>
          <a className={styles.brand} href="/" data-testid="brand">
            <span className={styles.brandMark} aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.8" opacity="0.5" />
                <circle cx="12" cy="12" r="5.2" stroke="currentColor" strokeWidth="1.8" opacity="0.8" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
              </svg>
            </span>
            <span className={styles.brandName}>ontarget</span>
          </a>
          <span className={styles.brandHint}>planejamento de projetos</span>
        </div>

        <div className={styles.appActions}>
          <button
            type="button"
            className={styles.ghostButton}
            data-testid="undo"
            disabled
            title="Desfazer (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            data-testid="redo"
            disabled
            title="Refazer (Ctrl+Y)"
          >
            ↷
          </button>

          <ProfileMenu />
        </div>
      </header>

      <nav className={styles.commandBar} data-testid="command-bar" aria-label="Comandos">
        <div className={styles.tabRow}>
          {RIBBON_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                activeTab === tab.id ? `${styles.tab} ${styles.tabActive}` : styles.tab
              }
              aria-current={activeTab === tab.id ? "page" : undefined}
              data-testid={`ribbon-tab-${tab.id}`}
              disabled={!projectMatch}
              title={projectMatch ? undefined : "Abra um projeto para usar a barra de comandos"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}

          <span className={styles.commandSpacer} />

        <label className={styles.viewSwitch}>
          <span>Visão</span>
          <select
            data-testid="view-select"
            value={activeView}
            onChange={(event) => setActiveView(event.target.value as ViewKind)}
          >
            <option value="gantt">Gantt</option>
            <option value="tracking">Controle</option>
            <option value="task_sheet">Tarefa</option>
            <option value="team">Equipe</option>
          </select>
        </label>

        {activeView === "tracking" && (
          <>
            <label className={styles.viewSwitch}>
              <span>Baseline</span>
              <select
                data-testid="tracking-baseline"
                value={tracking.baseline?.id ?? ""}
                onChange={(event) => setTrackingBaseline(event.target.value || null)}
              >
                {Object.values(baselines)
                  .sort((a, b) => b.savedAt - a.savedAt)
                  .map((baseline) => (
                    <option key={baseline.id} value={baseline.id}>
                      {baseline.name}
                    </option>
                  ))}
              </select>
            </label>
            <span className={styles.trackingTotal} data-testid="tracking-total">
              Desvio {projectFinishDeviation(tasks, tracking.values) !== null
                ? formatSignedDays(projectFinishDeviation(tasks, tracking.values)!)
                : "—"}
            </span>
          </>
        )}
        </div>

        {projectMatch && (
          <div className={styles.ribbonRow} data-testid="ribbon-content">
            {ribbonContent(projectMatch?.params.projectId)}
          </div>
        )}
      </nav>

      <main className={styles.content} data-testid="content">
        <Outlet />
      </main>

      <footer className={styles.statusBar} data-testid="status-bar">
        <span data-testid="status-focus">Foco: {focus === "grid" ? "Task Sheet" : "Gantt"}</span>
        <button
          type="button"
          className={styles.statusButton}
          data-testid="details-toggle"
          aria-pressed={detailsOpen}
          onClick={() => setPanel("details", !detailsOpen)}
        >
          Detalhes
        </button>
        <button
          type="button"
          className={styles.statusButton}
          data-testid="timeline-toggle"
          aria-pressed={timelineOpen}
          onClick={() => setPanel("timeline", !timelineOpen)}
        >
          Timeline
        </button>
        <button
          type="button"
          className={styles.statusButton}
          data-testid="calendars-toggle"
          aria-pressed={calendarsOpen}
          onClick={() => setPanel("calendars", !calendarsOpen)}
        >
          Calendários
        </button>
        <button
          type="button"
          className={styles.statusButton}
          data-testid="resources-toggle"
          aria-pressed={resourcesOpen}
          onClick={() => setPanel("resources", !resourcesOpen)}
        >
          Recursos
        </button>
        <button
          type="button"
          className={styles.statusButton}
          data-testid="team-toggle"
          aria-pressed={teamOpen}
          onClick={() => setPanel("team", !teamOpen)}
        >
          Equipe
        </button>
        <button
          type="button"
          className={styles.statusButton}
          data-testid="baseline-toggle"
          aria-pressed={baselinesOpen}
          onClick={() => setPanel("baselines", !baselinesOpen)}
        >
          Baseline
        </button>
        <button
          type="button"
          className={styles.statusButton}
          data-testid="statusdate-toggle"
          aria-pressed={statusdateOpen}
          onClick={() => setPanel("statusdate", !statusdateOpen)}
        >
          Data de status
        </button>
        <button
          type="button"
          className={styles.statusButton}
          data-testid="alerts-toggle"
          data-count={alerts.length}
          aria-pressed={alertsOpen}
          onClick={() => setPanel("alerts", !alertsOpen)}
        >
          Alertas{alerts.length > 0 ? ` (${alerts.length})` : ""}
        </button>
        <span className={styles.statusSpacer} />
        <span
          data-testid="status-schedule"
          data-tasks={schedule ? Object.keys(schedule.tasks).length : 0}
          data-critical={schedule ? schedule.criticalPath.length : 0}
          data-incremental={schedule ? String(schedule.meta.incremental) : undefined}
          data-ms={computation ? Math.round(computation.ms) : undefined}
          title="Cálculo do agendamento (Web Worker)"
        >
          {schedule
            ? `Cálculo: ${Object.keys(schedule.tasks).length} tarefas · ${schedule.criticalPath.length} críticas`
            : "Cálculo —"}
        </span>
        <ZoomControls />
        <span
          data-testid="status-save"
          data-state={saveState}
          className={saveState === "error" ? styles.statusError : undefined}
        >
          {saveState === "saving"
            ? "Salvando…"
            : saveState === "saved"
              ? "Salvo"
              : saveState === "error"
                ? "Erro ao salvar"
                : "Sem alterações"}
        </span>
      </footer>

      <ShortcutsOverlay />
      <CalendarPanel />
      <ResourcesPanel />
      <TeamPanel />
      <BaselinesPanel />
      <StatusPanel />
      <AlertsPanel />
      <FieldsPanel />
      <FiltersPanel />
      <ViewsPanel />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
