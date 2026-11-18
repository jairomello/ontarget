import {
  barGeometry,
  clampZoom,
  createTimeScale,
  DAY_MS,
  durationBetween,
  defaultCalendar,
  isWorkingDay,
  linkGeometry,
  isFilterActive,
  startOfUnit,
  workingWindow,
  type Calendar as CoreCalendar,
  type LinkType,
} from "@ontarget/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, type MenuItem } from "../../ui/ContextMenu";
import { notifyScroll, subscribeScroll } from "../shared/scrollSync";
import { getGanttApi, registerGanttApi, type FitMode } from "./ganttApi";
import { canLink, linkId } from "./linkRules";
import { bandsFor, BAND_HEIGHT, headerHeightFor } from "./header";
import { ScheduleChoice } from "./ScheduleChoice";
import { selectActiveCalendar, useDomainStore } from "../../store/domainStore";
import { useComputedStore } from "../../store/computedStore";
import { useOverallocation } from "../shared/overallocation";
import { useQueryRows } from "../shared/query";
import { useSelectedBaseline } from "../shared/tracking";
import { useUiStore } from "../../store/uiStore";
import { ROW_HEIGHTS } from "../../ui/theme";
import styles from "./GanttView.module.css";

const DAY_MS_CONST = DAY_MS;
const MARGIN_DAYS = 3;
const X_CULL_MARGIN = 240;
const CLICK_THRESHOLD = 3;
/** Zoom em que as faixas de turno passam a ser desenhadas (zoom de horas). */
const SHIFT_SHADE_MIN_PX_PER_DAY = 300;

interface Preview {
  taskId: string;
  start: number;
  finish: number;
}

interface ChoiceState {
  taskId: string;
  start: number;
  finish: number;
  x: number;
  y: number;
}

interface MenuState {
  taskId: string;
  x: number;
  y: number;
}

interface LinkingState {
  fromId: string;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  overId: string | null;
  valid: boolean;
}

/**
 * Gantt Chart (specs/gantt-view): barras, vínculos, escala temporal,
 * virtualização em duas dimensões e interações de arrastar-e-soltar.
 */
export function GanttView() {
  const order = useDomainStore((state) => state.taskOrder);
  const tasks = useDomainStore((state) => state.tasks);
  const taskLinks = useDomainStore((state) => state.taskLinks);
  const calendar = useDomainStore(selectActiveCalendar);
  const calendarExceptions = useDomainStore((state) => state.calendarExceptions);
  const criticalPath = useComputedStore((state) => state.schedule?.criticalPath);
  const criticalVisible = useUiStore((state) => state.criticalVisible);
  const criticalSet = useMemo(() => new Set(criticalPath ?? []), [criticalPath]);
  const overallocation = useOverallocation();
  const tracking = useSelectedBaseline();
  const pxPerDay = useUiStore((state) => state.zoom.pxPerDay);
  const density = useUiStore((state) => state.density);
  const activeView = useUiStore((state) => state.activeView);
  const query = useUiStore((state) => state.query);
  const statusDate = useDomainStore((state) => state.statusDate);
  const setSelection = useUiStore((state) => state.setSelection);
  const toggleRow = useUiStore((state) => state.toggleRow);

  const rowHeight = ROW_HEIGHTS[density];
  const headerHeight = headerHeightFor(pxPerDay);
  const bands = bandsFor(pxPerDay);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [viewport, setViewport] = useState({ width: 960, height: 640 });

  const [preview, setPreview] = useState<Preview | null>(null);
  const previewRef = useRef<Preview | null>(null);
  const [choice, setChoice] = useState<ChoiceState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [linking, setLinking] = useState<LinkingState | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Garante um único arraste ativo por vez (remove listeners anteriores). */
  const dragCleanupRef = useRef<(() => void) | null>(null);
  /** Data que deve permanecer sob o ponteiro após o próximo zoom. */
  const pendingZoomRef = useRef<{ date: number; viewportOffsetX: number } | null>(null);
  const zoomAtRef = useRef<(factor: number, clientX: number) => void>(() => {});
  /**
   * Enfileira o reposicionamento pós-zoom. O nonce garante que o efeito
   * execute mesmo quando o `pxPerDay` não muda (recorte da Timeline que
   * resulta no mesmo zoom de antes).
   */
  const [zoomNonce, setZoomNonce] = useState(0);
  const queueZoom = useCallback((date: number, viewportOffsetX: number) => {
    pendingZoomRef.current = { date, viewportOffsetX };
    setZoomNonce((nonce) => nonce + 1);
  }, []);

  // linhas da visão: filtros + ordenação + agrupamento (fonte única com a grade)
  const rows = useQueryRows();

  /* ---------------------------------------------------------------- rolagem */

  useEffect(
    () =>
      subscribeScroll((state, source) => {
        if (source === "gantt") return;
        const node = scrollRef.current;
        if (node && Math.abs(node.scrollTop - state.top) > 1) node.scrollTop = state.top;
      }),
    [],
  );

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;

    setScroll((previous) =>
      previous.top === node.scrollTop && previous.left === node.scrollLeft
        ? previous
        : { top: node.scrollTop, left: node.scrollLeft },
    );
    notifyScroll("gantt", node.scrollTop);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      setViewport({ width: node.clientWidth, height: node.clientHeight });
    });
    observer.observe(node);
    setViewport({ width: node.clientWidth, height: node.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (shakeTimer.current) clearTimeout(shakeTimer.current);
      dragCleanupRef.current?.();
    },
    [],
  );

  const runDragCleanup = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  /* ----------------------------------------------------------------- escala */

  const bounds = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const id of order) {
      const task = tasks[id];
      if (!task || task.isInactive) continue;
      const start = task.start ?? task.manualStart;
      const finish = task.finish ?? task.manualFinish;
      if (start !== null && start !== undefined && start < min) min = start;
      if (finish !== null && finish !== undefined && finish > max) max = finish;
      if (start !== null && start !== undefined && start > max) max = start;
    }

    if (!Number.isFinite(min)) {
      const today = Date.now();
      return { min: today, max: today + 30 * DAY_MS_CONST };
    }
    if (!Number.isFinite(max)) max = min;
    return { min, max };
  }, [order, tasks]);

  const originMs = useMemo(
    () => startOfUnit(bounds.min - MARGIN_DAYS * DAY_MS_CONST, "day"),
    [bounds.min],
  );
  const endMs = bounds.max + MARGIN_DAYS * DAY_MS_CONST;

  const totalWidth = Math.max(viewport.width, ((endMs - originMs) / DAY_MS_CONST) * pxPerDay);
  const totalHeight = rows.length * rowHeight;
  /**
   * Altura do corpo: no mínimo a área visível, para que fundo (fins de
   * semana) e grade acompanhem também a área abaixo da última linha.
   */
  const bodyHeight = Math.max(totalHeight, viewport.height - headerHeight);

  const contentScale = useMemo(
    () => createTimeScale({ pxPerDay, originMs, widthPx: totalWidth }),
    [pxPerDay, originMs, totalWidth],
  );

  const visibleScale = useMemo(
    () =>
      createTimeScale({
        pxPerDay,
        originMs: contentScale.dateAt(scroll.left),
        widthPx: Math.max(1, viewport.width),
      }),
    [pxPerDay, scroll.left, viewport.width, contentScale],
  );

  const ticks = useMemo(() => visibleScale.ticks(), [visibleScale]);
  const visibleWindow = useMemo(() => visibleScale.window(), [visibleScale]);

  /* ---------------------------------------------------------------- zoom */

  // Depois que a escala muda, reposiciona a rolagem para que a data-alvo
  // continue exatamente sob o ponteiro.
  useEffect(() => {
    const pending = pendingZoomRef.current;
    if (!pending) return;
    pendingZoomRef.current = null;

    const node = scrollRef.current;
    if (!node) return;

    const scale = createTimeScale({ pxPerDay, originMs, widthPx: totalWidth });
    node.scrollLeft = Math.max(0, scale.x(pending.date) - pending.viewportOffsetX);
  }, [pxPerDay, originMs, totalWidth, zoomNonce]);

  const zoomAt = useCallback(
    (factor: number, clientX: number) => {
      const node = scrollRef.current;
      const content = contentRef.current;
      if (!node || !content) return;

      const viewportRect = node.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const date = contentScale.dateAt(clientX - contentRect.left);

      queueZoom(date, clientX - viewportRect.left);
      useUiStore.getState().setZoom({
        pxPerDay: clampZoom(pxPerDay * factor),
        preset: null,
        forcedUnit: null,
      });
    },
    [contentScale, pxPerDay, queueZoom],
  );

  const fit = useCallback(
    (mode: FitMode) => {
      const node = scrollRef.current;
      if (!node) return;

      let from = originMs;
      let to = endMs;

      if (mode === "selection") {
        const selected = useUiStore.getState().selection.rows;
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;

        for (const id of selected) {
          const task = useDomainStore.getState().tasks[id];
          if (!task) continue;
          const start = task.start ?? task.manualStart;
          const finish = task.finish ?? task.manualFinish;
          if (start !== null && start !== undefined && start < min) min = start;
          if (finish !== null && finish !== undefined && finish > max) max = finish;
        }

        if (Number.isFinite(min) && max > min) {
          from = min;
          to = max;
        }
      }

      const spanDays = Math.max(1, (to - from) / DAY_MS_CONST);
      const next = clampZoom((node.clientWidth - 48) / spanDays);

      queueZoom(from, 24);
      useUiStore.getState().setZoom({
        pxPerDay: next,
        preset: mode === "project" ? "fit-project" : "fit-selection",
        forcedUnit: null,
      });
    },
    [originMs, endMs, queueZoom],
  );

  /**
   * Exibe exatamente o intervalo [from, to] — usado pelo recorte da
   * Timeline quando a sincronização está ativa (specs/timeline-view).
   */
  const fitRange = useCallback(
    (from: number, to: number) => {
      const node = scrollRef.current;
      if (!node) return;

      const spanDays = Math.max(1, (to - from) / DAY_MS_CONST);
      const next = clampZoom((node.clientWidth - 48) / spanDays);

      queueZoom(from, 24);
      useUiStore.getState().setZoom({ pxPerDay: next, preset: null, forcedUnit: null });
    },
    [queueZoom],
  );

  // expõe para os comandos globais (Ctrl+0, Ctrl+1), os presets e a Timeline
  useEffect(() => registerGanttApi({ fit, fitRange, zoomAt }), [fit, fitRange, zoomAt]);

  useEffect(() => {
    zoomAtRef.current = zoomAt;
  }, [zoomAt]);

  // Ctrl/Cmd + rolagem = zoom centrado no ponteiro (listener não-passivo)
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      zoomAtRef.current(factor, event.clientX);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
  /* ------------------------------------------------------------ virtualizar */

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    scrollMargin: headerHeight,
  });

  /**
   * `virtualItem.start` é medido a partir do topo do conteúdo rolável e já
   * inclui o cabeçalho (`scrollMargin`); como o corpo é posicionado abaixo
   * dele, a posição dentro do corpo é `start - headerHeight` — sem subtrair,
   * cabeçalho e linhas apareciam duplicados uma faixa para baixo.
   *
   * Sem `useMemo`: o objeto do virtualizador é estável e o memo ficaria preso
   * ao array vazio do primeiro render (antes da medição).
   */
  const virtualItems = virtualizer
    .getVirtualItems()
    .map((item) => ({ ...item, start: item.start - headerHeight }));

  /**
   * Grade horizontal: uma linha por linha de tarefa na posição do
   * virtualizer (a mesma base de `barGeometry`), estendida pelo corpo até
   * cobrir também a área abaixo da última linha.
   */
  const gridRowLines = useMemo(() => {
    const lines: number[] = [];
    for (const item of virtualItems) lines.push(item.start + rowHeight);

    const last =
      virtualItems.length > 0 ? virtualItems[virtualItems.length - 1]!.start + rowHeight : 0;
    for (let y = last + rowHeight; y < bodyHeight; y += rowHeight) lines.push(y);

    return lines;
  }, [virtualItems, bodyHeight, rowHeight]);

  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => map.set(row.id, index));
    return map;
  }, [rows]);

  /** Cabeçalhos de grupo na janela virtualizada (linhas sintéticas). */
  const groupHeaders = useMemo(
    () =>
      virtualItems
        .map((item) => ({ item, row: rows[item.index] }))
        .filter((entry): entry is { item: (typeof virtualItems)[number]; row: NonNullable<(typeof entry)["row"]> } =>
          Boolean(entry.row?.isGroup),
        )
        .map((entry) => ({
          key: entry.row.id as string,
          label: (entry.row.groupLabel ?? "") as string,
          depth: (entry.row.groupDepth ?? 0) as number,
          count: (entry.row.groupCount ?? 0) as number,
          top: entry.item.start,
        })),
    [virtualItems, rows],
  );

  /* ------------------------------------------------------------------ barras */

  const bars = useMemo(() => {
    const result: Array<{
      id: string;
      kind: string;
      x: number;
      y: number;
      width: number;
      height: number;
      progress: number;
      name: string;
    }> = [];

    for (const item of virtualItems) {
      const row = rows[item.index];
      if (!row) continue;
      const task = tasks[row.id];
      if (!task) continue;

      const rect = barGeometry(
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
        contentScale,
        { y: item.start, height: rowHeight },
      );

      if (!rect) continue;
      if (rect.x + rect.width < scroll.left - X_CULL_MARGIN) continue;
      if (rect.x > scroll.left + viewport.width + X_CULL_MARGIN) continue;

      result.push({ ...rect, name: task.name });
    }

    return result;
  }, [virtualItems, rows, tasks, contentScale, rowHeight, scroll.left, viewport.width]);

  /* ------------------------------------------------------------------ vínculos */

  const yOf = useCallback(
    (taskId: string): number | null => {
      const index = rowIndexById.get(taskId);
      // mesma base de `barGeometry` e do corpo rolável (o cabeçalho é
      // compensado na subtração de `scrollMargin` feita em `virtualItems`)
      return index === undefined ? null : index * rowHeight;
    },
    [rowIndexById, rowHeight],
  );

  const links = useMemo(() => {
    const result: Array<{
      id: string;
      d: string;
      lagLabel: string | null;
      labelAt: { x: number; y: number };
      from: string;
      to: string;
      curves: number;
    }> = [];
    const visibleIds = new Set(virtualItems.map((item) => rows[item.index]?.id));

    // barras desenhadas viram obstáculos: o caminho escolhido não as atravessa
    const obstacles = bars.map((bar) => ({
      id: bar.id,
      x: bar.x,
      y: bar.y,
      w: bar.width,
      h: bar.height,
    }));

    for (const link of Object.values(taskLinks)) {
      if (!visibleIds.has(link.successorId)) continue;

      const predecessor = tasks[link.predecessorId];
      const successor = tasks[link.successorId];
      const predY = yOf(link.predecessorId);
      const succY = yOf(link.successorId);
      if (!predecessor || !successor || predY === null || succY === null) continue;

      const geometry = linkGeometry(
        {
          type: link.type as LinkType,
          lagMs: link.lagMs,
          predecessor: {
            id: predecessor.id,
            start: predecessor.start,
            finish: predecessor.finish,
            isMilestone: predecessor.isMilestone,
            isSummary: predecessor.isSummary,
            isInactive: predecessor.isInactive,
            isPlaceholder: predecessor.isPlaceholder,
            rowY: predY,
            rowHeight,
          },
          successor: {
            id: successor.id,
            start: successor.start,
            finish: successor.finish,
            isMilestone: successor.isMilestone,
            isSummary: successor.isSummary,
            isInactive: successor.isInactive,
            isPlaceholder: successor.isPlaceholder,
            rowY: succY,
            rowHeight,
          },
          obstacles,
        },
        contentScale,
      );

      if (!geometry) continue;
      if (geometry.arrow.x < scroll.left - X_CULL_MARGIN) continue;
      if (geometry.points[0]!.x > scroll.left + viewport.width + X_CULL_MARGIN) continue;

      result.push({
        id: link.id,
        d: geometry.d,
        lagLabel: geometry.lagLabel,
        labelAt: geometry.labelAt,
        from: geometry.from,
        to: geometry.to,
        curves: geometry.curves,
      });
    }

    return result;
  }, [
    virtualItems,
    rows,
    taskLinks,
    tasks,
    bars,
    yOf,
    rowHeight,
    contentScale,
    scroll.left,
    viewport.width,
  ]);

  /* --------------------------------------------------------- tempo não útil */

  // Calendário ativo do projeto no formato puro do core (com exceções);
  // sem cadastro, cai no padrão seg–sex.
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

  const nonWorking = useMemo(() => {
    const rects: Array<{
      x: number;
      width: number;
      key: string;
      date: number;
      part: "day" | "before-shift" | "after-shift";
    }> = [];
    const { from, to } = visibleWindow;
    let cursor = startOfUnit(from, "day");

    while (cursor <= to) {
      if (!isWorkingDay(activeCalendar, cursor)) {
        // Dia sem tempo útil: feriado, fim de semana ou exceção (specs/calendars).
        rects.push({
          x: contentScale.x(cursor),
          width: Math.max(1, pxPerDay),
          key: String(cursor),
          date: cursor,
          part: "day",
        });
      } else if (pxPerDay >= SHIFT_SHADE_MIN_PX_PER_DAY) {
        // Zoom de horas: sombreia fora do turno (specs/gantt-view).
        const window = workingWindow(activeCalendar, cursor);
        if (window) {
          const dayEnd = cursor + DAY_MS_CONST;
          if (window.start > cursor) {
            rects.push({
              x: contentScale.x(cursor),
              width: Math.max(1, contentScale.x(window.start) - contentScale.x(cursor)),
              key: `${cursor}-before`,
              date: cursor,
              part: "before-shift",
            });
          }
          if (window.end < dayEnd) {
            rects.push({
              x: contentScale.x(window.end),
              width: Math.max(1, contentScale.x(dayEnd) - contentScale.x(window.end)),
              key: `${cursor}-after`,
              date: cursor,
              part: "after-shift",
            });
          }
        }
      }
      cursor += DAY_MS_CONST;
    }

    return rects;
  }, [visibleWindow, contentScale, pxPerDay, activeCalendar]);

  // Linha de progresso (specs/tracking — "Linha de progresso"): em cada linha,
  // a posição horizontal é o desvio entre o progresso atual e o planejado na
  // data de status — à direita = adiantado, à esquerda = atrasado.
  const progressInfo = useMemo(() => {
    if (activeView !== "tracking" || statusDate === null || !tracking.baseline) return null;
    if (bars.length === 0) return null;

    const statusX = contentScale.x(statusDate);
    const points: Array<{
      barId: string;
      x: number;
      y: number;
      deltaPct: number;
      direction: "ahead" | "behind";
      label: string;
    }> = [];

    for (const bar of bars) {
      const value = tracking.values[bar.id];
      const task = tasks[bar.id];
      if (!value || !task || value.start === null || value.finish === null) continue;

      const total = durationBetween(activeCalendar, value.start, value.finish + DAY_MS_CONST);
      const elapsed = durationBetween(
        activeCalendar,
        value.start,
        Math.min(statusDate + DAY_MS_CONST, value.finish + DAY_MS_CONST),
      );
      const plannedPct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 100;
      const actualPct = Math.max(0, Math.min(100, task.percentComplete ?? 0));
      const deltaPct = Math.round((actualPct - plannedPct) * 10) / 10;

      const baselineSpan =
        contentScale.x(value.finish + DAY_MS_CONST) - contentScale.x(value.start);
      const direction = deltaPct >= 0 ? "ahead" : "behind";
      const deltaText = String(deltaPct).replace(".", ",");
      const label = `${deltaPct > 0 ? "+" : ""}${deltaText}% ${
        direction === "ahead" ? "adiantado" : "atrasado"
      }`;

      points.push({
        barId: bar.id,
        x: statusX + (deltaPct / 100) * baselineSpan,
        y: bar.y + bar.height / 2,
        deltaPct,
        direction,
        label,
      });
    }

    return { statusX, points };
  }, [activeView, statusDate, tracking, bars, contentScale, activeCalendar, tasks]);

  // Rótulos das exceções no cabeçalho (specs/gantt-view — "Feriado do projeto").
  const exceptionLabels = useMemo(() => {
    if (!calendar) return [];
    return Object.values(calendarExceptions)
      .filter(
        (exception) =>
          exception.calendarId === calendar.id &&
          exception.date >= visibleWindow.from &&
          exception.date <= visibleWindow.to,
      )
      .sort((a, b) => a.date - b.date);
  }, [calendar, calendarExceptions, visibleWindow]);

  const todayX = contentScale.x(startOfUnit(Date.now(), "day"));

  /* ------------------------------------------------------------ interações */

  const flashShake = useCallback((taskId: string) => {
    setShake(taskId);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShake(null), 500);
  }, []);

  const commitSchedule = useCallback(
    (taskId: string, start: number, finish: number, point: { x: number; y: number }) => {
      const task = useDomainStore.getState().tasks[taskId];
      if (!task) return;

      if (task.schedulingMode === "auto") {
        // nada muda até o usuário escolher
        setChoice({ taskId, start, finish, x: point.x, y: point.y });
        return;
      }

      useDomainStore.getState().updateTask(taskId, {
        start,
        finish,
        manualStart: start,
        manualFinish: finish,
      });
    },
    [],
  );

  const beginDrag = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      taskId: string,
      mode: "move" | "resize",
      edge?: "start" | "finish",
    ) => {
      const task = useDomainStore.getState().tasks[taskId];
      if (!task || task.isSummary) return;

      const start0 = task.start ?? task.manualStart ?? Date.now();
      const finish0 = task.finish ?? task.manualFinish ?? start0 + DAY_MS_CONST;

      event.preventDefault();
      event.stopPropagation();
      runDragCleanup();

      const startX = event.clientX;
      let moved = false;
      let latest: Preview | null = null;

      const onMove = (moveEvent: PointerEvent) => {
        const deltaPx = moveEvent.clientX - startX;
        if (!moved && Math.abs(deltaPx) < CLICK_THRESHOLD) return;
        moved = true;

        const delta = Math.round(deltaPx / pxPerDay) * DAY_MS_CONST;
        let next: Preview;

        if (mode === "move") {
          next = { taskId, start: start0 + delta, finish: finish0 + delta };
        } else if (edge === "start") {
          next = { taskId, start: Math.min(start0 + delta, finish0), finish: finish0 };
        } else {
          next = { taskId, start: start0, finish: Math.max(finish0 + delta, start0) };
        }

        latest = next;
        previewRef.current = next;
        setPreview(next);
      };

      const onUp = (upEvent: PointerEvent) => {
        runDragCleanup();

        const final = previewRef.current;
        previewRef.current = null;
        setPreview(null);

        if (moved && final && final.taskId === taskId) {
          commitSchedule(taskId, final.start, final.finish, {
            x: upEvent.clientX,
            y: upEvent.clientY,
          });
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      dragCleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
    },
    [pxPerDay, commitSchedule, runDragCleanup],
  );

  const beginLink = useCallback((event: React.PointerEvent<HTMLElement>, fromId: string) => {
    const content = contentRef.current;
    if (!content) return;

    event.preventDefault();
    event.stopPropagation();
    runDragCleanup();

    const rect = content.getBoundingClientRect();
    const source = bars.find((bar) => bar.id === fromId);
    const fromX = source ? source.x + source.width : 0;
    const fromY = source ? source.y + source.height / 2 : 0;

    let overId: string | null = null;
    let valid = false;

    const onMove = (moveEvent: PointerEvent) => {
      const x = moveEvent.clientX - rect.left;
      const y = moveEvent.clientY - rect.top;

      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
      const barElement = element?.closest('[data-testid="gantt-bar"]') as HTMLElement | null;
      const target = barElement?.dataset.taskId ?? null;
      const decision = target ? canLink(useDomainStore.getState(), fromId, target) : null;

      overId = target;
      valid = Boolean(decision && decision.ok);
      setLinking({ fromId, fromX, fromY, x, y, overId: target, valid });
    };

    const onUp = () => {
      runDragCleanup();
      setLinking(null);

      if (!overId) return;

      const decision = canLink(useDomainStore.getState(), fromId, overId);
      if (!decision.ok) {
        flashShake(overId);
        return;
      }

      const domain = useDomainStore.getState();
      domain.addLink({
        id: linkId(fromId, overId, "fs"),
        projectId: domain.projectId ?? "",
        predecessorId: fromId,
        successorId: overId,
        type: "fs",
        lagMs: 0,
        crossProjectRef: null,
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [bars, flashShake, runDragCleanup]);

  const openMenu = useCallback((event: React.MouseEvent<HTMLElement>, taskId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection({ rows: [taskId], activeRow: taskId, activeColumn: "name" });
    setMenu({ taskId, x: event.clientX, y: event.clientY });
  }, [setSelection]);

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    const task = useDomainStore.getState().tasks[menu.taskId];
    if (!task) return [];

    return [
      {
        id: "details",
        label: "Abrir detalhes",
        shortcut: "F4",
        onSelect: () => {
          setSelection({ rows: [task.id], activeRow: task.id, activeColumn: "name" });
          useUiStore.getState().setPanel("details", true);
        },
      },
      {
        id: "inactive",
        label: task.isInactive ? "Reativar tarefa" : "Inativar tarefa",
        onSelect: () => useDomainStore.getState().updateTask(task.id, { isInactive: !task.isInactive }),
      },
      {
        id: "delete",
        label: "Excluir tarefa",
        danger: true,
        onSelect: () => useDomainStore.getState().removeTask(task.id),
      },
    ];
  }, [menu, setSelection]);

  const applyChoice = (mode: "manual" | "auto") => {
    if (!choice) return;
    const domain = useDomainStore.getState();

    if (mode === "manual") {
      domain.updateTask(choice.taskId, {
        schedulingMode: "manual",
        start: choice.start,
        finish: choice.finish,
        manualStart: choice.start,
        manualFinish: choice.finish,
      });
    } else {
      domain.updateTask(choice.taskId, {
        constraintType: "snet",
        constraintDate: choice.start,
        start: choice.start,
        finish: choice.finish,
      });
    }

    setChoice(null);
  };

  /* ------------------------------------------------------------------ render */

  return (
    <div
      className={styles.gantt}
      data-testid="gantt"
      data-zoom={Math.round(pxPerDay)}
      data-window-from={Math.round(contentScale.dateAt(scroll.left))}
      data-window-to={Math.round(contentScale.dateAt(scroll.left + viewport.width))}
      ref={scrollRef}
      onScroll={handleScroll}
      tabIndex={0}
      onFocus={() => useUiStore.getState().setFocus("gantt")}
      onPointerDown={() => useUiStore.getState().setFocus("gantt")}
    >
      <div
        ref={contentRef}
        className={styles.content}
        style={{ width: totalWidth, minHeight: headerHeight + bodyHeight }}
      >
        <div
          className={styles.header}
          data-testid="gantt-header"
          style={{ height: headerHeight, width: totalWidth }}
        >
          {bands.map((band, bandIndex) => {
            const bandTicks = ticks.header.find((entry) => entry.band === band)?.ticks ?? [];
            return (
              <div
                key={band}
                className={styles.band}
                style={{ height: BAND_HEIGHT, top: bandIndex * BAND_HEIGHT }}
                data-testid={`gantt-band-${band}`}
              >
                {bandTicks.map((tick) => (
                  <span
                    key={tick.at}
                    className={styles.bandTick}
                    style={{ left: contentScale.x(tick.at), width: tick.width }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            );
          })}

          {/* exceções do calendário rotuladas no cabeçalho */}
          {exceptionLabels.map((exception) => (
            <span
              key={exception.id}
              className={exception.isWorking ? styles.workingLabel : styles.holidayLabel}
              data-testid={`gantt-holiday-${exception.date}`}
              data-date={exception.date}
              title={exception.name ?? undefined}
              style={{
                left: contentScale.x(exception.date),
                width: Math.max(1, pxPerDay),
              }}
            >
              {exception.name ?? (exception.isWorking ? "Dia útil" : "Feriado")}
            </span>
          ))}
        </div>

        <div
          className={styles.body}
          style={{ height: bodyHeight, width: totalWidth, top: headerHeight }}
        >
          {/* camada: tempo não útil */}
          <div className={styles.layer} data-testid="gantt-nonworking">
            {nonWorking.map((rect) => (
              <span
                key={rect.key}
                className={styles.nonWorking}
                data-testid="nonworking-block"
                data-date={rect.date}
                data-part={rect.part}
                style={{ left: rect.x, width: rect.width }}
              />
            ))}
          </div>

          {/* camada: linhas da grade */}
          <svg
            className={styles.svg}
            width={totalWidth}
            height={bodyHeight}
            data-testid="gantt-grid"
            aria-hidden="true"
          >
            {ticks.minor.map((tick) => (
              <line
                key={`minor-${tick.at}`}
                className={styles.gridMinor}
                x1={contentScale.x(tick.at)}
                x2={contentScale.x(tick.at)}
                y1={0}
                y2={bodyHeight}
              />
            ))}
            {ticks.major.map((tick) => (
              <line
                key={`major-${tick.at}`}
                className={styles.gridMajor}
                x1={contentScale.x(tick.at)}
                x2={contentScale.x(tick.at)}
                y1={0}
                y2={bodyHeight}
              />
            ))}
            {gridRowLines.map((y) => (
              <line
                key={`row-${y}`}
                className={styles.gridRow}
                x1={0}
                x2={totalWidth}
                y1={y}
                y2={y}
              />
            ))}
          </svg>

          {/* camada: vínculos */}
          <svg
            className={styles.svg}
            width={totalWidth}
            height={bodyHeight}
            data-testid="gantt-links"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="gantt-link-arrow"
                className={styles.linkArrow}
                viewBox="0 0 8 8"
                refX="8"
                refY="4"
                markerWidth="8"
                markerHeight="8"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M 0 0 L 8 4 L 0 8 Z" />
              </marker>
            </defs>

            {links.map((link) => (
              <g
                key={link.id}
                data-testid="gantt-link"
                data-from={link.from}
                data-to={link.to}
                data-curves={link.curves}
              >
                <path className={styles.linkPath} d={link.d} markerEnd="url(#gantt-link-arrow)" />
                {link.lagLabel && (
                  <text
                    className={styles.linkLabel}
                    x={link.labelAt.x}
                    y={link.labelAt.y - 5}
                    textAnchor="middle"
                  >
                    {link.lagLabel}
                  </text>
                )}
              </g>
            ))}

            {linking && (
              <path
                className={linking.valid ? styles.linkPreview : styles.linkPreviewInvalid}
                data-testid="link-preview"
                d={`M ${linking.fromX} ${linking.fromY} L ${(linking.fromX + linking.x) / 2} ${linking.fromY} L ${(linking.fromX + linking.x) / 2} ${linking.y} L ${linking.x} ${linking.y}`}
              />
            )}
          </svg>

          {/* camada: marcadores */}
          <div className={styles.layer} data-testid="gantt-markers">
            <span className={styles.todayLine} style={{ left: todayX }} data-testid="today-line" />
            {statusDate !== null && (
              <span
                className={styles.statusLine}
                style={{ left: contentScale.x(statusDate) }}
                data-testid="status-line"
              />
            )}
          </div>

          {/* camada: linha de progresso (Tracking Gantt) */}
          {progressInfo && (
            <div className={styles.layer} data-testid="progress-layer">
              <svg
                className={`${styles.layer} ${styles.progressSvg}`}
                data-testid="progress-line"
                aria-hidden="true"
              >
                {progressInfo.points.length > 1 && (
                  <polyline
                    className={styles.progressPath}
                    points={progressInfo.points
                      .map((point) => `${point.x},${point.y}`)
                      .join(" ")}
                  />
                )}
              </svg>
              {progressInfo.points.map((point) => (
                <span
                  key={point.barId}
                  className={
                    point.direction === "ahead" ? styles.markerAhead : styles.markerBehind
                  }
                  data-testid="progress-marker"
                  data-task-id={point.barId}
                  data-delta={point.deltaPct}
                  data-direction={point.direction}
                  style={{ left: point.x - 5, top: point.y - 5 }}
                />
              ))}
              {progressInfo.points
                .filter((point) => point.deltaPct !== 0)
                .map((point) => (
                  <span
                    key={`label-${point.barId}`}
                    className={point.direction === "ahead" ? styles.labelAhead : styles.labelBehind}
                    data-testid="progress-label"
                    data-task-id={point.barId}
                    data-direction={point.direction}
                    style={{
                      left: point.direction === "ahead" ? point.x + 10 : Math.max(0, point.x - 108),
                      top: point.y - 17,
                    }}
                  >
                    {point.label}
                  </span>
                ))}
            </div>
          )}

          {/* camada: barras fantasma da baseline (Tracking Gantt) */}
          {activeView === "tracking" && tracking.baseline && (
            <div className={styles.layer} data-testid="baseline-bars">
              {bars.map((bar) => {
                const value = tracking.values[bar.id];
                if (!value || value.start === null || value.finish === null) return null;
                const x = contentScale.x(value.start);
                const width = Math.max(1, contentScale.x(value.finish + DAY_MS_CONST) - x);
                return (
                  <span
                    key={bar.id}
                    className={styles.baselineBar}
                    data-testid="baseline-bar"
                    data-task-id={bar.id}
                    data-start={value.start}
                    data-finish={value.finish}
                    title="Baseline"
                    style={{ left: x, top: bar.y + bar.height - 6, width, height: 6 }}
                  />
                );
              })}
            </div>
          )}

          {/* camada: barras */}
          <div className={styles.layer} data-testid="gantt-bars">
            {bars.map((bar) => {
              const task = tasks[bar.id];
              const isPreview = preview?.taskId === bar.id;
              const over = overallocation?.byTask.has(bar.id) ?? false;
              const left = isPreview && preview ? contentScale.x(preview.start) : bar.x;
              const width =
                isPreview && preview
                  ? Math.max(
                      1,
                      contentScale.x(preview.finish + DAY_MS_CONST) -
                        contentScale.x(preview.start),
                    )
                  : bar.width;

              const classes = [
                styles.bar,
                styles[bar.kind as keyof typeof styles] ?? styles.task,
                isPreview ? styles.dragging : "",
                linking?.overId === bar.id ? (linking.valid ? styles.linkTarget : styles.linkInvalid) : "",
                shake === bar.id ? styles.shake : "",
                criticalVisible && criticalSet.has(bar.id) ? styles.critical : "",
                over ? styles.overallocated : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div
                  key={bar.id}
                  className={classes}
                  data-testid="gantt-bar"
                  data-task-id={bar.id}
                  data-kind={bar.kind}
                  data-critical={
                    criticalVisible && criticalSet.has(bar.id) ? "true" : undefined
                  }
                  data-overallocated={over ? "true" : undefined}
                  data-shake={shake === bar.id ? "true" : undefined}
                  title={bar.name}
                  style={{ left, top: bar.y, width, height: bar.height }}
                  onPointerDown={(event) =>
                    beginDrag(event, bar.id, "move")
                  }
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setSelection({ rows: [bar.id], activeRow: bar.id, activeColumn: "name" });
                    useUiStore.getState().setPanel("details", true);
                  }}
                  onContextMenu={(event) => openMenu(event, bar.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleRow(bar.id, event.ctrlKey || event.metaKey);
                  }}
                >
                  {bar.progress > 0 && (
                    <span
                      className={styles.progress}
                      style={{ width: bar.progress }}
                      data-testid="gantt-progress"
                    />
                  )}

                  {task && (
                    <>
                      <span
                        className={styles.resizeHandle}
                        data-testid="resize-start"
                        onPointerDown={(event) => beginDrag(event, bar.id, "resize", "start")}
                      />
                      <span
                        className={styles.resizeHandle}
                        data-testid="resize-finish"
                        onPointerDown={(event) => beginDrag(event, bar.id, "resize", "finish")}
                      />
                      <span
                        className={styles.linkHandle}
                        data-testid="link-handle"
                        aria-label="Criar vínculo"
                        onPointerDown={(event) => beginLink(event, bar.id)}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* camada: cabeçalhos de grupo (specs/views-and-filters) */}
          <div className={styles.layer} data-testid="gantt-groups">
            {groupHeaders.map((header) => (
              <div
                key={header.key}
                data-testid="gantt-group"
                data-group-label={header.label}
                data-group-depth={header.depth}
                className={styles.groupBand}
                style={{
                  top: header.top,
                  height: rowHeight,
                  paddingLeft: 8 + header.depth * 16,
                }}
              >
                <span className={styles.groupBandLabel}>{header.label}</span>
                <span className={styles.groupBandCount} data-testid="gantt-group-count">
                  {header.count} tarefa{header.count === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 && isFilterActive(query) && (
        <p className={styles.emptyState} data-testid="gantt-query-empty">
          Nenhum item corresponde aos filtros ativos.
        </p>
      )}

      {choice && (
        <ScheduleChoice
          x={choice.x}
          y={choice.y}
          onManual={() => applyChoice("manual")}
          onAuto={() => applyChoice("auto")}
          onCancel={() => setChoice(null)}
        />
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
