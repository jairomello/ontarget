import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router";
import { ApiError, api, formatDateTime } from "../../lib/api";
import { useSchedule } from "../../schedule/useSchedule";
import { useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import { TaskForm } from "../details/TaskForm";
import { GanttView } from "../gantt/GanttView";
import { TaskSheet } from "../tasksheet/TaskSheet";
import { Timeline } from "../timeline/Timeline";
import { useProjectSync } from "./useProjectSync";
import styles from "./WorkspacePage.module.css";

interface SnapshotInfo {
  id: string;
  createdAt: number;
}

interface LoadError {
  code: string;
  message: string;
  snapshots: SnapshotInfo[];
}

/** Limites do divisor Grade ↔ Gantt (px) — o mínimo acompanha o CSS. */
const MIN_SHEET_WIDTH = 340;
const MIN_GANTT_WIDTH = 320;
const SPLITTER_STEP = 12;
const SPLITTER_STEP_LARGE = 48;

/**
 * Área de trabalho do projeto: carrega o aggregate e divide a tela entre
 * Task Sheet e Gantt (specs/task-sheet e specs/gantt-view).
 * Quando os dados estão corrompidos, oferece a recuperação por snapshot
 * (specs/persistence).
 */
export function WorkspacePage() {
  const { projectId } = useParams();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<LoadError | null>(null);
  const detailsOpen = useUiStore((state) => state.panels.details);
  const timelineOpen = useUiStore((state) => state.panels.timeline);
  useProjectSync(projectId);
  useSchedule(projectId);
  const activeView = useUiStore((state) => state.activeView);
  const sheetWidth = useUiStore((state) => state.sheetWidth);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [splitting, setSplitting] = useState(false);

  /** Limita a largura ao espaço que sobra para o Gantt. */
  const clampSheetWidth = useCallback((width: number): number => {
    const workspace = workspaceRef.current;
    const available = workspace?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY;
    const max = Math.max(MIN_SHEET_WIDTH, available - MIN_GANTT_WIDTH);
    return Math.round(Math.min(max, Math.max(MIN_SHEET_WIDTH, width)));
  }, []);

  const beginSplitterDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!sheetRef.current || !workspaceRef.current) return;
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = sheetRef.current.getBoundingClientRect().width;
      const set = useUiStore.getState().setSheetWidth;
      setSplitting(true);
      set(clampSheetWidth(startWidth), false);

      const onMove = (move: PointerEvent) => {
        set(clampSheetWidth(startWidth + (move.clientX - startX)), false);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setSplitting(false);
        // grava o layout uma única vez, ao soltar
        useUiStore.getState().setSheetWidth(useUiStore.getState().sheetWidth, true);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clampSheetWidth],
  );

  const nudgeSplitter = useCallback(
    (delta: number) => {
      const current = sheetRef.current?.getBoundingClientRect().width ?? sheetWidth;
      useUiStore.getState().setSheetWidth(clampSheetWidth(current + delta), true);
    },
    [clampSheetWidth, sheetWidth],
  );

  const onSplitterKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? SPLITTER_STEP_LARGE : SPLITTER_STEP;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeSplitter(-step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nudgeSplitter(step);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const workspace = workspaceRef.current;
        if (!workspace) return;
        const width = workspace.getBoundingClientRect().width;
        useUiStore
          .getState()
          .setSheetWidth(
            clampSheetWidth(event.key === "Home" ? MIN_SHEET_WIDTH : width - MIN_GANTT_WIDTH),
            true,
          );
      }
    },
    [nudgeSplitter, clampSheetWidth],
  );

  /** Duplo clique devolve a divisão automática (44% / minmax do CSS). */
  const resetSplitter = useCallback(() => {
    useUiStore.getState().setSheetWidth(0, true);
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setStatus("loading");
    setError(null);

    try {
      const detail = await api.getProject(projectId);
      useDomainStore.getState().load(projectId, detail.data, detail.project);
      setStatus("ready");
    } catch (err) {
      if (err instanceof ApiError && err.code === "project_corrupt") {
        const details = err.details as { error?: { snapshots?: SnapshotInfo[] } } | undefined;
        setError({
          code: err.code,
          message: err.message,
          snapshots: details?.error?.snapshots ?? [],
        });
      } else {
        setError({
          code: err instanceof ApiError ? err.code : "unknown_error",
          message: err instanceof Error ? err.message : "Falha ao abrir o projeto",
          snapshots: [],
        });
      }
      setStatus("error");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const recover = useCallback(
    async (snapshotId: string) => {
      if (!projectId) return;
      try {
        await api.recoverProject(projectId, snapshotId);
        await load();
      } catch (err) {
        setError({
          code: "recover_failed",
          message: err instanceof Error ? err.message : "Falha ao recuperar",
          snapshots: [],
        });
      }
    },
    [projectId, load],
  );

  if (status === "loading") {
    return (
      <div className={styles.state} data-testid="workspace-loading">
        Carregando projeto…
      </div>
    );
  }

  if (status === "error" && error) {
    return (
      <div className={styles.state} data-testid="workspace-error">
        <p className={styles.errorTitle}>
          {error.code === "project_corrupt"
            ? "Os dados deste projeto estão corrompidos"
            : "Não foi possível abrir o projeto"}
        </p>
        <p className={styles.errorMessage}>{error.message}</p>

        {error.snapshots.length > 0 && (
          <div className={styles.snapshots}>
            <p className={styles.errorMessage}>Escolha um ponto de recuperação:</p>
            <ul className={styles.snapshotList}>
              {error.snapshots.map((snapshot) => (
                <li key={snapshot.id}>
                  <button
                    type="button"
                    className={styles.recoverButton}
                    data-testid="recover-snapshot"
                    onClick={() => void recover(snapshot.id)}
                  >
                    Recuperar de {formatDateTime(snapshot.createdAt)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={[
        styles.workspace,
        timelineOpen ? styles.withTimeline : "",
        detailsOpen ? styles.withForm : "",
        activeView === "task_sheet" ? styles.sheetOnly : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="workspace"
      data-project-id={projectId}
      data-view={activeView}
      ref={workspaceRef}
      style={
        sheetWidth > 0
          ? ({ "--sheet-width": `${sheetWidth}px` } as CSSProperties)
          : undefined
      }
    >
      {timelineOpen && <Timeline />}

      <section className={styles.sheet} aria-label="Task Sheet" ref={sheetRef}>
        <TaskSheet />
      </section>

      {activeView !== "task_sheet" && (
        <section className={styles.gantt} data-testid="gantt-slot" aria-label="Painel de visualização">
          {activeView === "team" ? (
            <p className={styles.placeholder}>Painel de equipe</p>
          ) : (
            // Gantt e Tracking Gantt: o mesmo gráfico, com a visão de Controle
            // acrescentando as barras fantasma da baseline (specs/tracking)
            <GanttView />
          )}

          {/* divisor arrastável: fica dentro do painel do Gantt para não
              cobrir o redimensionador da última coluna da grade */}
          <div
            className={
              splitting ? `${styles.splitter} ${styles.splitterActive}` : styles.splitter
            }
            data-testid="workspace-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar a grade e o Gantt"
            aria-valuenow={sheetWidth > 0 ? Math.round(sheetWidth) : undefined}
            aria-valuemin={MIN_SHEET_WIDTH}
            aria-valuemax={9999}
            tabIndex={0}
            onPointerDown={beginSplitterDrag}
            onDoubleClick={resetSplitter}
            onKeyDown={onSplitterKeyDown}
          />
        </section>
      )}

      <TaskForm />
    </div>
  );
}
