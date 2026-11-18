import { useMemo, useRef, useState } from "react";
import { formatDate } from "../../lib/api";
import { useDomainStore } from "../../store/domainStore";
import { getGanttApi } from "../gantt/ganttApi";
import {
  DEFAULT_ITEM_COLOR,
  MIN_WINDOW_DAYS,
  clampWindow,
  dateToPercent,
  drawTimeline,
  itemRect,
  parseTimelineConfig,
  percentToDate,
  projectSpan,
  type TimelineConfig,
  type TimelineDisplay,
} from "./timelineModel";
import styles from "./Timeline.module.css";

const DAY_MS = 86_400_000;

/**
 * Timeline (specs/timeline-view): faixa no topo das visualizações com os
 * itens do projeto, recorte do intervalo sincronizado com o Gantt,
 * personalização por item e exportação PNG/cópia. A configuração é um item
 * da biblioteca do projeto (kind `timeline`).
 */
export function Timeline() {
  const tasks = useDomainStore((state) => state.tasks);
  const taskOrder = useDomainStore((state) => state.taskOrder);
  const saveLibraryItem = useDomainStore((state) => state.saveLibraryItem);
  const updateLibraryItem = useDomainStore((state) => state.updateLibraryItem);
  const removeLibraryItem = useDomainStore((state) => state.removeLibraryItem);
  const timelineRecord = useDomainStore((state) =>
    Object.values(state.libraryItems).find((entry) => entry.kind === "timeline"),
  );

  const config = useMemo(
    () => parseTimelineConfig(timelineRecord?.config),
    [timelineRecord?.config],
  );

  const span = useMemo(() => {
    const active = taskOrder
      .map((id) => tasks[id])
      .filter((task): task is NonNullable<typeof task> => Boolean(task));
    return projectSpan(active, Date.now());
  }, [taskOrder, tasks]);

  const effective = useMemo(
    () =>
      config.from !== null && config.to !== null
        ? clampWindow(config.from, config.to, span)
        : { from: span.min, to: span.max },
    [config.from, config.to, span],
  );

  const [draft, setDraft] = useState<{ from: number; to: number } | null>(null);
  const draftRef = useRef<{ from: number; to: number } | null>(null);
  const dragRef = useRef<{ edge: "start" | "end"; rect: DOMRect } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addValue, setAddValue] = useState("");
  const [notice, setNotice] = useState("");

  const window_ = draft ?? effective;
  const win = window_;

  const persist = (next: TimelineConfig) => {
    const json = JSON.stringify(next);
    if (timelineRecord) updateLibraryItem(timelineRecord.id, { config: json });
    else saveLibraryItem({ kind: "timeline", name: "Timeline", config: json, scope: "project" });
  };

  const setDraftBoth = (next: { from: number; to: number } | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  /* ---------------------------------------------------------- recorte */

  const dateAtClientX = (clientX: number, rect: DOMRect): number => {
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return percentToDate(ratio * 100, span);
  };

  const startDrag = (edge: "start" | "end") => (event: React.PointerEvent<HTMLDivElement>) => {
    if (span.max <= span.min) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { edge, rect };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const date = dateAtClientX(event.clientX, drag.rect);
    const base = draftRef.current ?? effective;
    const minMs = MIN_WINDOW_DAYS * DAY_MS;
    const next =
      drag.edge === "start"
        ? {
            ...base,
            from: Math.min(Math.max(date, span.min), Math.max(base.to - minMs, span.min)),
          }
        : {
            ...base,
            to: Math.max(Math.min(date, span.max), Math.min(base.from + minMs, span.max)),
          };
    setDraftBoth(next);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ponteiro já liberado
    }

    const cropped = draftRef.current;
    setDraftBoth(null);
    if (!cropped) return;

    // lê a configuração mais recente (outras edições podem ter ocorrido)
    const base: TimelineConfig = timelineRecord
      ? parseTimelineConfig(
          useDomainStore.getState().libraryItems[timelineRecord.id]?.config,
        )
      : config;
    persist({ ...base, from: cropped.from, to: cropped.to });
    if (base.sync) getGanttApi()?.fitRange(cropped.from, cropped.to);
  };

  /* ------------------------------------------------------------- itens */

  const orderIndex = useMemo(() => {
    const index = new Map<string, number>();
    taskOrder.forEach((id, position) => index.set(id, position));
    return index;
  }, [taskOrder]);

  const orderedItems = useMemo(
    () =>
      config.items
        .filter((item) => Boolean(tasks[item.taskId]))
        .sort(
          (a, b) => (orderIndex.get(a.taskId) ?? 0) - (orderIndex.get(b.taskId) ?? 0),
        ),
    [config.items, tasks, orderIndex],
  );

  const availableTasks = useMemo(
    () =>
      taskOrder.filter(
        (id) => tasks[id] && !config.items.some((item) => item.taskId === id),
      ),
    [taskOrder, tasks, config.items],
  );

  const addTask = (taskId: string) => {
    if (!taskId || !tasks[taskId]) return;
    if (config.items.some((item) => item.taskId === taskId)) return;
    persist({
      ...config,
      items: [...config.items, { taskId, color: null, label: null, display: "bar" }],
    });
    setAddValue("");
  };

  const dropTask = (taskId: string) => addTask(taskId);

  const patchItem = (taskId: string, patch: Partial<(typeof config.items)[number]>) => {
    persist({
      ...config,
      items: config.items.map((item) =>
        item.taskId === taskId ? { ...item, ...patch } : item,
      ),
    });
  };

  const dropItem = (taskId: string) => {
    persist({ ...config, items: config.items.filter((item) => item.taskId !== taskId) });
    if (selectedId === taskId) setSelectedId(null);
  };

  const selectedItem = selectedId
    ? config.items.find((item) => item.taskId === selectedId) ?? null
    : null;
  const selectedTask = selectedItem ? tasks[selectedItem.taskId] : undefined;

  /* ---------------------------------------------------- marcos mensais */

  const months = useMemo(() => {
    const out: number[] = [];
    const start = new Date(span.min);
    let ms = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    for (let guard = 0; guard < 720; guard += 1) {
      if (ms > span.max) break;
      if (ms >= span.min) out.push(ms);
      const date = new Date(ms);
      ms = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    }
    return out;
  }, [span]);

  const monthLabel = (ms: number) => {
    const date = new Date(ms);
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(
      date.getUTCFullYear(),
    ).slice(2)}`;
  };

  /* -------------------------------------------------------- exportação */

  const cssVar = (name: string, fallback: string) =>
    (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

  const renderCanvas = (): HTMLCanvasElement | null => {
    const strip = stripRef.current;
    if (!strip) return null;
    const rect = strip.getBoundingClientRect();
    const dpr = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(dpr, dpr);

    drawTimeline(ctx, {
      width: rect.width,
      height: rect.height,
      span,
      window: win,
      items: orderedItems.map((item) => {
        const task = tasks[item.taskId]!;
        const rectOf = itemRect(task, span) ?? { left: 0, width: 0 };
        return {
          rect: rectOf,
          color: item.color ?? DEFAULT_ITEM_COLOR,
          label: item.label ?? task.name,
          display: item.display,
        };
      }),
      background: cssVar("--bg-surface-2", "#f8fafc"),
      foreground: cssVar("--fg-default", "#0f172a"),
    });
    return canvas;
  };

  const exportPng = () => {
    const canvas = renderCanvas();
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "timeline.png";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
      },
      "image/png",
    );
  };

  const copyImage = async () => {
    const canvas = renderCanvas();
    if (!canvas) {
      setNotice("Não foi possível gerar a imagem.");
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) {
      setNotice("Não foi possível gerar a imagem.");
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNotice("");
    } catch {
      setNotice("Não foi possível copiar a imagem.");
    }
  };

  /* ------------------------------------------------------------- render */

  const leftPct = dateToPercent(win.from, span);
  const rightPct = dateToPercent(win.to, span);

  return (
    <div
      className={styles.timeline}
      data-testid="timeline"
      data-span-from={Math.round(span.min)}
      data-span-to={Math.round(span.max)}
      data-window-from={Math.round(win.from)}
      data-window-to={Math.round(win.to)}
    >
      <div className={styles.toolbar}>
        <span className={styles.title}>Timeline</span>

        <select
          className={styles.field}
          data-testid="timeline-add-select"
          aria-label="Tarefa para a Timeline"
          value={addValue}
          onChange={(event) => setAddValue(event.target.value)}
        >
          <option value="">Adicionar tarefa…</option>
          {availableTasks.map((id) => (
            <option key={id} value={id}>
              {tasks[id]!.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.addButton}
          data-testid="timeline-add"
          onClick={() => addTask(addValue)}
        >
          Adicionar
        </button>

        <label className={styles.check}>
          <input
            type="checkbox"
            data-testid="timeline-sync"
            checked={config.sync}
            onChange={(event) => persist({ ...config, sync: event.target.checked })}
          />
          <span>Sincronizar com o Gantt</span>
        </label>

        <span className={styles.range} data-testid="timeline-range">
          {formatDate(win.from)} – {formatDate(win.to)}
        </span>

        {notice && (
          <span className={styles.notice} role="alert" data-testid="timeline-notice">
            {notice}
          </span>
        )}

        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.actionButton}
          data-testid="timeline-copy"
          onClick={() => void copyImage()}
        >
          Copiar
        </button>
        <button
          type="button"
          className={styles.actionButton}
          data-testid="timeline-export"
          onClick={exportPng}
        >
          Exportar PNG
        </button>
      </div>

      {selectedItem && selectedTask && (
        <div className={styles.editor} data-testid="timeline-item-editor">
          <span className={styles.editorLabel}>{selectedTask.name}</span>
          <label className={styles.check}>
            <span>Cor</span>
            <input
              type="color"
              data-testid="timeline-item-color"
              value={selectedItem.color ?? DEFAULT_ITEM_COLOR}
              onChange={(event) => patchItem(selectedItem.taskId, { color: event.target.value })}
            />
          </label>
          <input
            className={styles.field}
            type="text"
            data-testid="timeline-item-label"
            aria-label="Rótulo do item"
            placeholder={selectedTask.name}
            value={selectedItem.label ?? ""}
            onChange={(event) =>
              patchItem(selectedItem.taskId, { label: event.target.value || null })
            }
          />
          <select
            className={styles.field}
            data-testid="timeline-item-display"
            aria-label="Tipo de exibição"
            value={selectedItem.display}
            onChange={(event) =>
              patchItem(selectedItem.taskId, {
                display: event.target.value as TimelineDisplay,
              })
            }
          >
            <option value="bar">Barra</option>
            <option value="band">Faixa</option>
            <option value="card">Card</option>
          </select>
          <button
            type="button"
            className={styles.actionButton}
            data-testid="timeline-item-remove"
            onClick={() => dropItem(selectedItem.taskId)}
          >
            Remover da Timeline
          </button>
        </div>
      )}

      <div
        className={styles.strip}
        data-testid="timeline-strip"
        ref={stripRef}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const taskId = event.dataTransfer.getData("text/task-id");
          if (taskId) dropTask(taskId);
        }}
      >
        {months.map((ms) => (
          <span
            key={ms}
            className={styles.monthTick}
            style={{ left: `${dateToPercent(ms, span)}%` }}
          >
            {monthLabel(ms)}
          </span>
        ))}

        {orderedItems.map((item) => {
          const task = tasks[item.taskId]!;
          const rect = itemRect(task, span);
          if (!rect) return null;
          const color = item.color ?? "var(--accent)";
          const label = item.label ?? task.name;
          return (
            <button
              key={item.taskId}
              type="button"
              className={[styles.item, styles[`item_${item.display}`]].join(" ")}
              data-testid="timeline-item"
              data-task-id={item.taskId}
              data-color={item.color ?? ""}
              data-label={item.label ?? ""}
              data-display={item.display}
              style={
                {
                  left: `${rect.left}%`,
                  width: `${Math.max(rect.width, 1.5)}%`,
                  "--item-color": color,
                } as React.CSSProperties
              }
              title={`${task.name} — ${formatDate(task.start)} a ${formatDate(task.finish)}`}
              onClick={() =>
                setSelectedId((current) => (current === item.taskId ? null : item.taskId))
              }
            >
              <span className={styles.itemLabel}>{label}</span>
            </button>
          );
        })}

        {orderedItems.length === 0 && (
          <p className={styles.empty} data-testid="timeline-empty">
            Arraste tarefas da grade para a Timeline ou use “Adicionar”.
          </p>
        )}

        {/* recorte: máscaras fora da janela (não bloqueiam cliques) */}
        <div
          className={styles.mask}
          style={{ left: 0, width: `${Math.max(0, leftPct)}%` }}
          aria-hidden
        />
        <div
          className={styles.mask}
          style={{ left: `${Math.min(100, rightPct)}%`, right: 0 }}
          aria-hidden
        />
        <div
          className={styles.window}
          style={{ left: `${leftPct}%`, width: `${Math.max(0, rightPct - leftPct)}%` }}
          aria-hidden
        >
          <div
            className={`${styles.handle} ${styles.handleStart}`}
            data-testid="timeline-handle-start"
            onPointerDown={startDrag("start")}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <div
            className={`${styles.handle} ${styles.handleEnd}`}
            data-testid="timeline-handle-end"
            onPointerDown={startDrag("end")}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      </div>
    </div>
  );
}
