import {
  barGeometry,
  createTimeScale,
  DAY_MS,
  defaultCalendar,
  isWorkingDay,
  startOfUnit,
  workingWindow,
  type Calendar as CoreCalendar,
} from "@ontarget/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api, formatDate, formatDateTime } from "../../lib/api";
import { formatDuration } from "../../lib/format";
import { useSchedule } from "../../schedule/useSchedule";
import { useComputedStore } from "../../store/computedStore";
import { selectActiveCalendar, useDomainStore } from "../../store/domainStore";
import type { Task } from "../../store/types";
import { useUiStore } from "../../store/uiStore";
import ganttStyles from "../gantt/GanttView.module.css";
import { bandsFor, BAND_HEIGHT, headerHeightFor } from "../gantt/header";
import { assignmentNamesText } from "../shared/assignments";
import { wbsCodeText } from "../shared/fields";
import { predecessorsText } from "../shared/predecessors";
import { useQueryRows } from "../shared/query";
import { useSelectedBaseline } from "../shared/tracking";
import { cellText } from "../tasksheet/TaskSheet";
import { COLUMN_DEFS, COLUMNS, isCustomColumnKey } from "../tasksheet/columns";
import {
  drawTimeline,
  itemRect,
  parseTimelineConfig,
  projectSpan,
} from "../timeline/timelineModel";
import {
  pageMetrics,
  paginateWithLegend,
  PRINT_LEGEND_MM,
  PRINT_MIN_ROW_MM,
  PRINT_ROW_MM,
  type PaperSize,
  type PrintBlock,
  type PrintPage as PrintPagePlan,
  type PrintSection,
} from "./pagination";
import styles from "./PrintPage.module.css";

const MM_PX = 96 / 25.4; // mm → px (96 dpi)
const PX_MM = 25.4 / 96;
const DAY_PX_EPSILON = 1;
/** Zoom mínimo em que as faixas de turno passam a ser sombreadas. */
const SHIFT_SHADE_MIN_PX_PER_DAY = 300;

const TIMELINE_MM = 18;
const DETAILS_MM = 100;

const PAPERS: Record<string, PaperSize> = {
  a4: { w: 210, h: 297 },
  a3: { w: 297, h: 420 },
  letter: { w: 216, h: 279 },
};

type PaperKey = keyof typeof PAPERS;
type Orientation = "portrait" | "landscape";
type ScaleMode = "auto" | "width" | "fixed";

interface PrintConfig {
  paper: PaperKey;
  orientation: Orientation;
  margin: number;
  scale: ScaleMode;
  fixedPercent: number;
  header: { project: boolean; period: boolean; brand: boolean };
  footer: { date: boolean; pages: boolean; author: boolean };
  author: string;
  columns: string[];
  views: { timeline: boolean; sheet: boolean; gantt: boolean; details: boolean };
}

/**
 * Modo de impressão (specs/printing): pré-visualização dedicada com páginas
 * de tamanho real, cabeçalho/rodapé configuráveis, escala, seleção de
 * colunas e visões, legenda e orientação. O PDF sai do diálogo do navegador
 * (`window.print`, docs/architecture.md §11.3).
 */
export function PrintPage() {
  const { projectId } = useParams();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [projectName, setProjectName] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);

  const tasks = useDomainStore((state) => state.tasks);
  const taskOrder = useDomainStore((state) => state.taskOrder);
  const libraryItems = useDomainStore((state) => state.libraryItems);
  const customFields = useDomainStore((state) => state.customFields);
  const calendar = useDomainStore(selectActiveCalendar);
  const calendarExceptions = useDomainStore((state) => state.calendarExceptions);
  const selection = useUiStore((state) => state.selection);
  const screenZoom = useUiStore((state) => state.zoom.pxPerDay);
  const activeView = useUiStore((state) => state.activeView);
  const criticalVisible = useUiStore((state) => state.criticalVisible);
  const criticalPath = useComputedStore((state) => state.schedule?.criticalPath);
  const scheduleReady = useComputedStore((state) => state.schedule !== null);
  const criticalSet = useMemo(() => new Set(criticalPath ?? []), [criticalPath]);
  const tracking = useSelectedBaseline();
  const rows = useQueryRows();

  useSchedule(projectId);

  const [config, setConfig] = useState<PrintConfig>(() => ({
    paper: "a4",
    orientation: "landscape",
    margin: 15,
    scale: "auto",
    fixedPercent: 100,
    header: { project: true, period: true, brand: false },
    footer: { date: true, pages: true, author: false },
    author: "",
    columns: useUiStore
      .getState()
      .columnState[useUiStore.getState().activeView]
      .filter((column) => column.visible && column.key !== "toggle")
      .map((column) => column.key),
    views: {
      timeline: useUiStore.getState().panels.timeline,
      sheet: true,
      gantt: true,
      details: useUiStore.getState().panels.details,
    },
  }));

  const load = useCallback(async () => {
    if (!projectId) return;
    setStatus("loading");
    try {
      const detail = await api.getProject(projectId);
      useDomainStore.getState().load(projectId, detail.data, detail.project);
      setProjectName(detail.project.name);
      setStatus("ready");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Falha ao abrir o projeto");
      setStatus("error");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (value: Partial<PrintConfig>) =>
    setConfig((current) => ({ ...current, ...value }));

  /* ------------------------------------------------------------- métricas */

  const m = useMemo(
    () => pageMetrics(PAPERS[config.paper]!, config.orientation, config.margin),
    [config.paper, config.orientation, config.margin],
  );

  const bounds = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const id of taskOrder) {
      const task = tasks[id];
      if (!task || task.isInactive) continue;
      const start = task.start ?? task.manualStart;
      const finish = task.finish ?? task.manualFinish;
      if (start !== null && start !== undefined && start < min) min = start;
      if (start !== null && start !== undefined && start > max) max = start;
      if (finish !== null && finish !== undefined && finish > max) max = finish;
    }
    if (!Number.isFinite(min)) {
      const today = Date.now();
      return { min: today, max: today + 30 * DAY_MS };
    }
    if (!Number.isFinite(max)) max = min;
    return { min, max };
  }, [taskOrder, tasks]);

  const originMs = useMemo(
    () => startOfUnit(bounds.min - 3 * DAY_MS, "day"),
    [bounds.min],
  );
  const endMs = bounds.max + 3 * DAY_MS;

  const bodyWpx = m.bodyW * MM_PX;
  const totalDays = Math.max(1, (endMs - originMs) / DAY_MS);

  const pxPerDay =
    config.scale === "fixed"
      ? Math.max(1.5, Math.min(4000, screenZoom * (config.fixedPercent / 100)))
      : bodyWpx / totalDays;

  const contentPx = totalDays * pxPerDay;
  const slices =
    config.scale === "fixed" && contentPx > bodyWpx + DAY_PX_EPSILON
      ? Math.ceil(contentPx / bodyWpx)
      : 1;
  /** Fatias alinhas a dias inteiros (divisões de calendário inteiras). */
  const sliceDays = Math.ceil(bodyWpx / pxPerDay);

  const ganttHeaderPx = headerHeightFor(pxPerDay);
  const ganttHeaderMm = ganttHeaderPx / MM_PX;
  const ganttRowCount = rows.length;

  // "Ajustar à página": comprime a altura das linhas para caber tudo em uma
  // página (piso de legibilidade); se nem assim couber, pagina em 6 mm.
  let ganttRowMm = PRINT_ROW_MM;
  if (config.scale === "auto" && ganttRowCount > 0) {
    const avail = m.bodyH - ganttHeaderMm - PRINT_LEGEND_MM;
    const atMin = ganttRowCount * PRINT_MIN_ROW_MM + ganttHeaderMm;
    if (ganttRowCount * PRINT_ROW_MM + ganttHeaderMm > avail && atMin <= avail) {
      ganttRowMm = (avail - ganttHeaderMm) / ganttRowCount;
    }
  }

  /* ------------------------------------------------------------- colunas */

  const columnOptions = useMemo(() => {
    const base = COLUMNS.filter((def) => def.key !== "toggle").map((def) => ({
      key: def.key,
      label: def.label,
      width: def.width,
      numeric: Boolean(def.numeric),
    }));
    const custom = Object.values(customFields)
      .filter((field) => field.entityType === "task")
      .map((field) => ({
        key: `cf:${field.id}`,
        label: field.name,
        width: 140,
        numeric: false,
      }));
    return [...base, ...custom];
  }, [customFields]);

  const columnMeta = useMemo(
    () => new Map(columnOptions.map((option) => [option.key, option])),
    [columnOptions],
  );

  const visibleColumns = useMemo(
    () =>
      config.columns
        .filter((key) => columnMeta.has(key))
        .map((key) => columnMeta.get(key)!),
    [config.columns, columnMeta],
  );

  const printCellText = (key: string, task: Task): string => {
    const def = COLUMN_DEFS[key];
    if (def) return cellText(def, task as unknown as Record<string, unknown>);
    if (isCustomColumnKey(key)) {
      return cellText(
        { key, label: "", width: 140 },
        task as unknown as Record<string, unknown>,
      );
    }
    return "";
  };

  /* --------------------------------------------------------- seções/plan */

  const sections = useMemo(() => {
    const list: PrintSection[] = [];
    if (config.views.timeline) list.push({ kind: "timeline", height: TIMELINE_MM });
    if (config.views.sheet && rows.length > 0) {
      list.push({ kind: "table", rows: rows.length });
    }
    if (config.views.gantt && ganttRowCount > 0) {
      list.push({
        kind: "gantt",
        rows: ganttRowCount,
        rowMm: ganttRowMm,
        headerMm: ganttHeaderMm,
        slices,
        // "Ajustar à página" começa o gráfico em página nova para valer a
        // promessa de caber; largura/fixa fluem após as demais seções.
        freshPage: config.scale === "auto",
      });
    }
    if (config.views.details) list.push({ kind: "details", height: DETAILS_MM });
    return list;
  }, [
    config.views,
    config.scale,
    rows.length,
    ganttRowCount,
    ganttRowMm,
    ganttHeaderMm,
    slices,
  ]);

  const plan: PrintPagePlan[] = useMemo(
    () => paginateWithLegend(sections, m),
    [sections, m],
  );

  /* ----------------------------------------------------------- timeline */

  const timelineConfig = useMemo(() => {
    const record = Object.values(libraryItems).find((item) => item.kind === "timeline");
    return parseTimelineConfig(record?.config);
  }, [libraryItems]);

  const timelineSpan = useMemo(
    () =>
      projectSpan(
        taskOrder
          .map((id) => tasks[id])
          .filter((task): task is Task => Boolean(task)),
        Date.now(),
      ),
    [taskOrder, tasks],
  );

  const timelineWindow = useMemo(
    () =>
      timelineConfig.from !== null && timelineConfig.to !== null
        ? { from: timelineConfig.from, to: timelineConfig.to }
        : { from: timelineSpan.min, to: timelineSpan.max },
    [timelineConfig.from, timelineConfig.to, timelineSpan],
  );

  const timelineItems = useMemo(() => {
    const index = new Map<string, number>();
    taskOrder.forEach((id, position) => index.set(id, position));
    return timelineConfig.items
      .filter((item) => Boolean(tasks[item.taskId]))
      .sort((a, b) => (index.get(a.taskId) ?? 0) - (index.get(b.taskId) ?? 0))
      .map((item) => {
        const task = tasks[item.taskId]!;
        return {
          rect: itemRect(task, timelineSpan) ?? { left: 0, width: 0 },
          color: item.color ?? "#6366f1",
          label: item.label ?? task.name,
          display: item.display,
        };
      });
  }, [timelineConfig.items, taskOrder, tasks, timelineSpan]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasTimelineBlock = plan.some((page) =>
    page.blocks.some((block) => block.kind === "timeline"),
  );
  useEffect(() => {
    if (!hasTimelineBlock) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = m.bodyW * MM_PX;
    const height = TIMELINE_MM * MM_PX;
    canvas.width = Math.round(width * 2);
    canvas.height = Math.round(height * 2);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(2, 2);
    drawTimeline(ctx, {
      width,
      height,
      span: timelineSpan,
      window: timelineWindow,
      items: timelineItems,
      background: "#f8fafc",
      foreground: "#0f172a",
    });
  }, [hasTimelineBlock, m.bodyW, timelineSpan, timelineWindow, timelineItems]);

  /* ------------------------------------------------------------ calendário */

  const activeCalendar = useMemo<CoreCalendar>(() => {
    if (!calendar) return defaultCalendar();
    return {
      id: calendar.id,
      name: calendar.name,
      weeklyMask: calendar.weeklyMask,
      workingHoursStart: calendar.workingHoursStart,
      workingHoursEnd: calendar.workingHoursEnd,
      exceptions: Object.values(calendarExceptions)
        .filter((exception) => exception.calendarId === calendar.id)
        .map((exception) => ({
          date: exception.date,
          isWorking: exception.isWorking,
          startTime: exception.startTime,
          endTime: exception.endTime,
          name: exception.name,
        })),
    };
  }, [calendar, calendarExceptions]);

  /* --------------------------------------------------------------- render */

  const renderTable = (block: Extract<PrintBlock, { kind: "table" }>) => {
    const nameIndex = visibleColumns.findIndex((column) => column.key === "name");
    const others = visibleColumns.filter((column) => column.key !== "name");
    const othersMm = others.reduce((sum, column) => sum + column.width * PX_MM, 0);
    const availableMm = nameIndex >= 0 ? m.bodyW - 34 : m.bodyW;
    const scale = othersMm > 0 ? Math.min(1, availableMm / othersMm) : 1;
    const widthOf = (width: number) => `${Math.max(8, width * PX_MM * scale)}mm`;

    const cells = (task: Task) =>
      visibleColumns.map((column) => (
        <span
          key={column.key}
          className={[styles.cell, column.numeric ? styles.cellNumeric : ""].join(" ")}
          style={
            column.key === "name"
              ? { flex: "1 1 auto", minWidth: "28mm" }
              : { flex: "0 0 auto", width: widthOf(column.width) }
          }
        >
          {printCellText(column.key, task)}
        </span>
      ));

    const slice = rows.slice(block.from, block.to);

    return (
      <div className={styles.tableBlock} data-testid="print-table">
        <div className={styles.tableHeaderRow} data-testid="print-table-header">
          {visibleColumns.map((column) => (
            <span
              key={column.key}
              className={[styles.headCell, column.numeric ? styles.cellNumeric : ""].join(" ")}
              style={
                column.key === "name"
                  ? { flex: "1 1 auto", minWidth: "28mm" }
                  : { flex: "0 0 auto", width: widthOf(column.width) }
              }
            >
              {column.label}
            </span>
          ))}
        </div>
        {slice.map((row) => {
          if (row.isGroup) {
            return (
              <div key={row.id} className={styles.groupRow} data-testid="print-group-row">
                <span className={styles.groupLabel}>{row.groupLabel}</span>
                <span className={styles.groupMeta}>
                  {row.groupCount} tarefa{row.groupCount === 1 ? "" : "s"} · Σ{" "}
                  {formatDuration(row.groupSummary?.duration ?? null)}
                </span>
              </div>
            );
          }
          const task = tasks[row.id];
          if (!task) return null;
          return (
            <div key={row.id} className={styles.tableRow} data-testid="print-table-row">
              {cells(task)}
            </div>
          );
        })}
      </div>
    );
  };

  const renderGantt = (block: Extract<PrintBlock, { kind: "gantt" }>) => {
    const sliceOrigin = originMs + block.slice * sliceDays * DAY_MS;
    const scale = createTimeScale({ pxPerDay, originMs: sliceOrigin, widthPx: bodyWpx });
    const ticks = scale.ticks();
    const windowFrom = sliceOrigin;
    const windowTo = sliceOrigin + (bodyWpx / pxPerDay) * DAY_MS;
    const bands = bandsFor(pxPerDay);
    const rowHpx = ganttRowMm * MM_PX;
    const bodyHpx = Math.max(rowHpx, (block.to - block.from) * rowHpx);

    // tempo não útil da janela da fatia
    const nonWorking: Array<{ x: number; width: number; key: string }> = [];
    let cursor = startOfUnit(windowFrom, "day");
    let guard = 0;
    while (cursor <= windowTo && guard < 1_500) {
      guard += 1;
      if (!isWorkingDay(activeCalendar, cursor)) {
        nonWorking.push({
          x: scale.x(cursor),
          width: Math.max(1, pxPerDay),
          key: String(cursor),
        });
      } else if (pxPerDay >= SHIFT_SHADE_MIN_PX_PER_DAY) {
        const shift = workingWindow(activeCalendar, cursor);
        const dayEnd = cursor + DAY_MS;
        if (shift && shift.start > cursor) {
          nonWorking.push({
            x: scale.x(cursor),
            width: Math.max(1, scale.x(shift.start) - scale.x(cursor)),
            key: `${cursor}-b`,
          });
        }
        if (shift && shift.end < dayEnd) {
          nonWorking.push({
            x: scale.x(shift.end),
            width: Math.max(1, scale.x(dayEnd) - scale.x(shift.end)),
            key: `${cursor}-a`,
          });
        }
      }
      cursor += DAY_MS;
    }

    const exceptions = calendar
      ? Object.values(calendarExceptions)
          .filter(
            (exception) =>
              exception.calendarId === calendar.id &&
              exception.date >= windowFrom &&
              exception.date <= windowTo,
          )
          .sort((a, b) => a.date - b.date)
      : [];

    const slice = rows.slice(block.from, block.to);

    return (
      <div className={styles.ganttBlock} data-testid="print-gantt" data-slice={block.slice}>
        <div className={styles.ganttHeaderBlock} style={{ height: `${ganttHeaderMm}mm` }}>
          {bands.map((band, bandIndex) => {
            const bandTicks =
              ticks.header.find((entry) => entry.band === band)?.ticks ?? [];
            return (
              <div
                key={band}
                className={styles.band}
                style={{ height: BAND_HEIGHT, top: bandIndex * BAND_HEIGHT }}
              >
                {bandTicks.map((tick) => (
                  <span
                    key={tick.at}
                    className={styles.bandTick}
                    style={{ left: scale.x(tick.at), width: tick.width }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            );
          })}
          {exceptions.map((exception) => (
            <span
              key={exception.id}
              className={exception.isWorking ? styles.workingLabel : styles.holidayLabel}
              style={{ left: scale.x(exception.date), width: Math.max(1, pxPerDay) }}
            >
              {exception.name ?? (exception.isWorking ? "Dia útil" : "Feriado")}
            </span>
          ))}
        </div>

        <div
          className={styles.ganttBodyBlock}
          data-testid="print-gantt-body"
          style={{ height: bodyHpx, width: bodyWpx }}
        >
          {nonWorking.map((rect) => (
            <span
              key={rect.key}
              className={styles.nonWorking}
              style={{ left: rect.x, width: rect.width }}
            />
          ))}

          <svg className={styles.gridSvg} width={bodyWpx} height={bodyHpx} aria-hidden="true">
            {ticks.minor.map((tick) => (
              <line
                key={`minor-${tick.at}`}
                className={styles.gridMinor}
                x1={scale.x(tick.at)}
                x2={scale.x(tick.at)}
                y1={0}
                y2={bodyHpx}
              />
            ))}
            {ticks.major.map((tick) => (
              <line
                key={`major-${tick.at}`}
                className={styles.gridMajor}
                x1={scale.x(tick.at)}
                x2={scale.x(tick.at)}
                y1={0}
                y2={bodyHpx}
              />
            ))}
            {slice.map((_row, index) => (
              <line
                key={`row-${block.from + index}`}
                className={styles.gridRow}
                x1={0}
                x2={bodyWpx}
                y1={(index + 1) * rowHpx}
                y2={(index + 1) * rowHpx}
              />
            ))}
          </svg>

          {slice.map((row, index) => {
            const y = index * rowHpx;
            if (row.isGroup) {
              return (
                <div
                  key={row.id}
                  className={styles.ganttGroupBand}
                  style={{ top: y, height: rowHpx, paddingLeft: 6 + (row.groupDepth ?? 0) * 12 }}
                >
                  {row.groupLabel}
                </div>
              );
            }
            const task = tasks[row.id];
            if (!task) return null;

            const bar = barGeometry(
              {
                id: task.id,
                start: task.start,
                finish: task.finish,
                duration: task.duration,
                isSummary: task.isSummary,
                isMilestone: task.isMilestone,
                isInactive: task.isInactive,
                isPlaceholder: task.isPlaceholder,
                percentComplete: task.percentComplete,
                schedulingMode: task.schedulingMode,
              },
              scale,
              { y, height: rowHpx },
            );
            if (!bar) return null;

            const critical = criticalVisible && criticalSet.has(task.id);
            const classes = [
              ganttStyles.bar,
              ganttStyles[bar.kind as keyof typeof ganttStyles] ?? ganttStyles.task,
              critical ? ganttStyles.critical : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={task.id}
                className={classes}
                data-testid="print-bar"
                data-task-id={task.id}
                data-kind={bar.kind}
                data-critical={critical ? "true" : undefined}
                title={task.name}
                style={{ left: bar.x, top: bar.y, width: bar.width, height: bar.height }}
              >
                {bar.progress > 0 && (
                  <span className={ganttStyles.progress} style={{ width: bar.progress }} />
                )}
              </div>
            );
          })}

          {activeView === "tracking" &&
            tracking.baseline &&
            slice.map((row, index) => {
              if (row.isGroup) return null;
              const value = tracking.values[row.id];
              if (!value || value.start === null || value.finish === null) return null;
              const x = scale.x(value.start);
              const width = Math.max(1, scale.x(value.finish + DAY_MS) - x);
              return (
                <span
                  key={`baseline-${row.id}`}
                  className={ganttStyles.baselineBar}
                  style={{ left: x, top: index * rowHpx + rowHpx - 6, width, height: 6 }}
                />
              );
            })}
        </div>
      </div>
    );
  };

  const renderDetails = () => {
    const task = selection.activeRow ? tasks[selection.activeRow] : null;
    const field = (label: string, value: string) => (
      <div className={styles.detailField} key={label}>
        <span className={styles.detailLabel}>{label}</span>
        <span className={styles.detailValue}>{value}</span>
      </div>
    );

    return (
      <div className={styles.detailsBlock} data-testid="print-details">
        <h2 className={styles.detailsTitle}>
          {task ? task.name : "Nenhuma tarefa selecionada"}
        </h2>
        {task && (
          <div className={styles.detailGrid}>
            {field("WBS", wbsCodeText(task))}
            {field("Início", formatDate(task.start))}
            {field("Término", formatDate(task.finish))}
            {field("Duração", task.duration === null ? "—" : formatDuration(task.duration))}
            {field("% Concluído", `${task.percentComplete ?? 0}%`)}
            {field(
              "Agendamento",
              task.schedulingMode === "manual" ? "Manual" : "Automático",
            )}
            {field("Responsáveis", assignmentNamesText(task.id))}
            {field("Predecessores", predecessorsText(task.id))}
            {field("Notas", task.notes ?? "—")}
          </div>
        )}
      </div>
    );
  };

  const renderLegend = () => (
    <div className={styles.legend} data-testid="print-legend">
      <span className={styles.legendItem}>
        <span
          className={`${ganttStyles.bar} ${ganttStyles.task}`}
          style={{ position: "relative", left: 0, top: 0, width: 22, height: 9 }}
        />
        Tarefa
      </span>
      <span className={styles.legendItem}>
        <span
          className={`${ganttStyles.bar} ${ganttStyles.summary}`}
          style={{ position: "relative", left: 0, top: 0, width: 22, height: 10 }}
        />
        Resumo
      </span>
      <span className={styles.legendItem}>
        <span
          className={`${ganttStyles.bar} ${ganttStyles.milestone}`}
          style={{ position: "relative", left: 0, top: 0, width: 10, height: 10 }}
        />
        Marco
      </span>
      <span className={styles.legendItem}>
        <span className={ganttStyles.baselineBar} style={{ width: 22, height: 6 }} />
        Baseline
      </span>
      <span className={styles.legendItem}>
        <span
          className={`${ganttStyles.bar} ${ganttStyles.task} ${ganttStyles.critical}`}
          style={{ position: "relative", left: 0, top: 0, width: 22, height: 9 }}
        />
        Crítica
      </span>
      <span className={styles.legendItem}>
        <span
          className={`${ganttStyles.bar} ${ganttStyles.inactive}`}
          style={{ position: "relative", left: 0, top: 0, width: 22, height: 9 }}
        />
        Inativa
      </span>
      <span className={styles.legendItem}>
        <span className={styles.legendSwatch} />
        Tempo não útil
      </span>
    </div>
  );

  const renderBlock = (block: PrintBlock) => {
    switch (block.kind) {
      case "table":
        return renderTable(block);
      case "gantt":
        return renderGantt(block);
      case "details":
        return renderDetails();
      case "legend":
        return renderLegend();
      case "timeline":
        return <canvas ref={canvasRef} className={styles.timelineCanvas} data-testid="print-timeline" />;
    }
  };

  /* --------------------------------------------------------------- estados */

  if (status === "loading") {
    return (
      <div className={styles.state} data-testid="print-loading">
        Preparando impressão…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className={styles.state} data-testid="print-error">
        <p>Não foi possível abrir o projeto</p>
        <p>{loadError}</p>
        <Link to={`/p/${projectId ?? ""}`}>Voltar ao projeto</Link>
      </div>
    );
  }

  const projectNameForHeader = projectName;
  const period = `${formatDate(bounds.min)} – ${formatDate(bounds.max)}`;

  /* ------------------------------------------------------------- toolbar */

  const toggleColumn = (key: string) => {
    patch({
      columns: config.columns.includes(key)
        ? config.columns.filter((entry) => entry !== key)
        : [...config.columns, key],
    });
  };

  return (
    <div
      className={styles.printRoot}
      data-theme="light"
      data-testid="print-root"
      data-schedule={scheduleReady ? "ready" : "pending"}
    >
      <style>{`@page { size: ${m.pageW}mm ${m.pageH}mm; margin: 0; }`}</style>

      <div className={styles.toolbar} data-testid="print-toolbar">
        <Link className={styles.back} to={`/p/${projectId ?? ""}`} data-testid="print-back">
          ← Voltar
        </Link>

        <label className={styles.field}>
          <span>Papel</span>
          <select
            data-testid="print-paper"
            value={config.paper}
            onChange={(event) => patch({ paper: event.target.value as PaperKey })}
          >
            <option value="a4">A4</option>
            <option value="a3">A3</option>
            <option value="letter">Carta</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Orientação</span>
          <select
            data-testid="print-orientation"
            value={config.orientation}
            onChange={(event) => patch({ orientation: event.target.value as Orientation })}
          >
            <option value="landscape">Paisagem</option>
            <option value="portrait">Retrato</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Margens</span>
          <select
            data-testid="print-margin"
            value={config.margin}
            onChange={(event) => patch({ margin: Number(event.target.value) })}
          >
            <option value={10}>10 mm</option>
            <option value={15}>15 mm</option>
            <option value={20}>20 mm</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Escala</span>
          <select
            data-testid="print-scale"
            value={config.scale}
            onChange={(event) => patch({ scale: event.target.value as ScaleMode })}
          >
            <option value="auto">Ajustar à página</option>
            <option value="width">Ajustar à largura</option>
            <option value="fixed">Escala fixa</option>
          </select>
        </label>

        {config.scale === "fixed" && (
          <label className={styles.field}>
            <span>Percentual</span>
            <select
              data-testid="print-fixed-percent"
              value={config.fixedPercent}
              onChange={(event) => patch({ fixedPercent: Number(event.target.value) })}
            >
              <option value={100}>100%</option>
              <option value={75}>75%</option>
              <option value={50}>50%</option>
            </select>
          </label>
        )}

        <fieldset className={styles.group}>
          <legend>Cabeçalho</legend>
          <label>
            <input
              type="checkbox"
              data-testid="print-header-project"
              checked={config.header.project}
              onChange={(event) =>
                patch({ header: { ...config.header, project: event.target.checked } })
              }
            />
            Projeto
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="print-header-period"
              checked={config.header.period}
              onChange={(event) =>
                patch({ header: { ...config.header, period: event.target.checked } })
              }
            />
            Período
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="print-header-brand"
              checked={config.header.brand}
              onChange={(event) =>
                patch({ header: { ...config.header, brand: event.target.checked } })
              }
            />
            Marca
          </label>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Rodapé</legend>
          <label>
            <input
              type="checkbox"
              data-testid="print-footer-date"
              checked={config.footer.date}
              onChange={(event) =>
                patch({ footer: { ...config.footer, date: event.target.checked } })
              }
            />
            Data
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="print-footer-pages"
              checked={config.footer.pages}
              onChange={(event) =>
                patch({ footer: { ...config.footer, pages: event.target.checked } })
              }
            />
            Página N de M
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="print-footer-author"
              checked={config.footer.author}
              onChange={(event) =>
                patch({ footer: { ...config.footer, author: event.target.checked } })
              }
            />
            Autor
          </label>
          {config.footer.author && (
            <input
              type="text"
              className={styles.authorInput}
              data-testid="print-author"
              aria-label="Autor"
              value={config.author}
              placeholder="Nome do autor"
              onChange={(event) => patch({ author: event.target.value })}
            />
          )}
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Conteúdo</legend>
          <label>
            <input
              type="checkbox"
              data-testid="print-view-timeline"
              checked={config.views.timeline}
              onChange={(event) =>
                patch({ views: { ...config.views, timeline: event.target.checked } })
              }
            />
            Timeline
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="print-view-sheet"
              checked={config.views.sheet}
              onChange={(event) =>
                patch({ views: { ...config.views, sheet: event.target.checked } })
              }
            />
            Task Sheet
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="print-view-gantt"
              checked={config.views.gantt}
              onChange={(event) =>
                patch({ views: { ...config.views, gantt: event.target.checked } })
              }
            />
            Gantt
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="print-view-details"
              checked={config.views.details}
              onChange={(event) =>
                patch({ views: { ...config.views, details: event.target.checked } })
              }
            />
            Detalhes
          </label>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>
            <button
              type="button"
              className={styles.columnsToggle}
              data-testid="print-columns-toggle"
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen((open) => !open)}
            >
              Colunas ({visibleColumns.length})
            </button>
          </legend>
          {columnsOpen && (
            <div className={styles.columnsList}>
              {columnOptions.map((column) => (
                <label key={column.key}>
                  <input
                    type="checkbox"
                    data-testid={`print-column-${column.key}`}
                    checked={config.columns.includes(column.key)}
                    onChange={() => toggleColumn(column.key)}
                  />
                  {column.label}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <button
          type="button"
          className={styles.printButton}
          data-testid="print-button"
          onClick={() => window.print()}
        >
          Imprimir / Gerar PDF
        </button>
      </div>

      <div className={styles.pages} data-testid="print-pages">
        {plan.map((page, pageIndex) => (
          <div
            key={pageIndex}
            className={styles.page}
            data-testid="print-page"
            data-page={pageIndex + 1}
            style={{
              width: `${m.pageW}mm`,
              height: `${m.pageH}mm`,
              padding: `${m.margin}mm`,
            }}
          >
            <div className={styles.pageInner}>
              <header
                className={styles.printHeader}
                data-testid="print-header"
                style={{ height: `${m.header}mm` }}
              >
                <span className={styles.headerLeft}>
                  {config.header.project ? projectNameForHeader : ""}
                </span>
                <span className={styles.headerCenter}>
                  {config.header.period ? period : ""}
                </span>
                <span className={styles.headerRight}>
                  {config.header.brand ? "ontarget" : ""}
                </span>
              </header>

              <div className={styles.pageBody}>
                {page.blocks.map((block, blockIndex) => (
                  <div key={`${pageIndex}-${blockIndex}`}>{renderBlock(block)}</div>
                ))}
              </div>

              <footer
                className={styles.printFooter}
                data-testid="print-footer"
                style={{ height: `${m.footer}mm` }}
              >
                <span data-testid="print-footer-date">
                  {config.footer.date ? `Impresso em ${formatDateTime(Date.now())}` : ""}
                </span>
                <span className={styles.footerAuthor}>
                  {config.footer.author && config.author.trim() ? config.author : ""}
                </span>
                <span data-testid="print-page-number">
                  {config.footer.pages
                    ? `Página ${pageIndex + 1} de ${plan.length}`
                    : ""}
                </span>
              </footer>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
