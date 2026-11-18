/**
 * Timeline (specs/timeline-view): tipos e funções puras — recorte do
 * intervalo, posicionamento dos itens e desenho da imagem exportável.
 * Datas são epoch ms UTC-naive (docs/architecture.md §8.1).
 */

export type TimelineDisplay = "bar" | "band" | "card";

export const TIMELINE_DISPLAYS: TimelineDisplay[] = ["bar", "band", "card"];

export interface TimelineItem {
  taskId: string;
  /** Cor personalizada; `null` = cor padrão. */
  color: string | null;
  /** Rótulo personalizado; `null` = nome da tarefa. */
  label: string | null;
  display: TimelineDisplay;
}

export interface TimelineConfig {
  items: TimelineItem[];
  /** Recorte do intervalo exibido (`null` = projeto inteiro). */
  from: number | null;
  to: number | null;
  /** Sincronizar o recorte com o Gantt. */
  sync: boolean;
}

export const DEFAULT_TIMELINE_CONFIG: TimelineConfig = {
  items: [],
  from: null,
  to: null,
  sync: true,
};

export const MIN_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/** Cor padrão dos itens (sem personalização). */
export const DEFAULT_ITEM_COLOR = "#6366f1";

export interface Span {
  min: number;
  max: number;
}

export interface SpanTask {
  start: number | null;
  finish: number | null;
  manualStart?: number | null;
  manualFinish?: number | null;
  isInactive?: boolean;
}

/** Intervalo coberto pelas tarefas ativas (mesmas regras do Gantt). */
export function projectSpan(tasks: Iterable<SpanTask>, fallbackNow: number): Span {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const task of tasks) {
    if (task.isInactive) continue;
    const start = task.start ?? task.manualStart ?? null;
    const finish = task.finish ?? task.manualFinish ?? null;
    if (start !== null) {
      if (start < min) min = start;
      if (start > max) max = start;
    }
    if (finish !== null) {
      if (finish < min) min = finish;
      if (finish > max) max = finish;
    }
  }

  if (!Number.isFinite(min)) return { min: fallbackNow, max: fallbackNow + 30 * DAY_MS };
  if (!Number.isFinite(max)) max = min;
  return { min, max };
}

/** Garante `from/to` dentro do intervalo e com a janela mínima. */
export function clampWindow(
  from: number,
  to: number,
  span: Span,
): { from: number; to: number } {
  const minMs = MIN_WINDOW_DAYS * DAY_MS;
  let a = Math.max(span.min, Math.min(from, span.max));
  let b = Math.min(span.max, Math.max(to, span.min));

  if (b - a < minMs) {
    b = Math.min(span.max, a + minMs);
    a = Math.max(span.min, b - minMs);
  }
  return { from: a, to: b };
}

/** Posição (0–100) de uma data dentro do intervalo do projeto. */
export function dateToPercent(date: number, span: Span): number {
  const total = span.max - span.min;
  if (total <= 0) return 0;
  return ((date - span.min) / total) * 100;
}

/** Data correspondente a uma posição (0–100) do intervalo. */
export function percentToDate(percent: number, span: Span): number {
  return span.min + (percent / 100) * (span.max - span.min);
}

/**
 * Retângulo de uma tarefa em % do intervalo. `finish` é inclusivo
 * (último dia trabalhado), por isso soma um dia ao término.
 */
export function itemRect(
  task: SpanTask,
  span: Span,
): { left: number; width: number } | null {
  const start = task.start ?? task.manualStart ?? null;
  const finish = task.finish ?? task.manualFinish ?? null;
  if (start === null && finish === null) return null;

  const from = start ?? finish!;
  const to = finish ?? start!;
  const left = dateToPercent(from, span);
  const right = dateToPercent(to + DAY_MS, span);
  return { left, width: Math.max(right - left, 0) };
}

/** Lê a configuração salva (kind `timeline`), tolerando formato antigo. */
export function parseTimelineConfig(config: string | null | undefined): TimelineConfig {
  const fallback: TimelineConfig = { ...DEFAULT_TIMELINE_CONFIG, items: [] };
  if (!config) return fallback;

  try {
    const parsed = JSON.parse(config) as Partial<TimelineConfig>;
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .filter((entry) => typeof entry?.taskId === "string")
          .map((entry) => ({
            taskId: entry.taskId as string,
            color: typeof entry.color === "string" ? entry.color : null,
            label: typeof entry.label === "string" ? entry.label : null,
            display: TIMELINE_DISPLAYS.includes(entry.display as TimelineDisplay)
              ? (entry.display as TimelineDisplay)
              : ("bar" as TimelineDisplay),
          }))
      : [];

    return {
      items,
      from: typeof parsed.from === "number" ? parsed.from : null,
      to: typeof parsed.to === "number" ? parsed.to : null,
      sync: parsed.sync !== false,
    };
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------ exportação */

export interface DrawItem {
  rect: { left: number; width: number };
  color: string;
  label: string;
  display: TimelineDisplay;
}

export interface DrawOptions {
  width: number;
  height: number;
  span: Span;
  window: { from: number; to: number };
  items: DrawItem[];
  background: string;
  foreground: string;
}

/** Desenha a Timeline num contexto 2D (PNG e cópia para a área de transferência). */
export function drawTimeline(ctx: CanvasRenderingContext2D, options: DrawOptions): void {
  const { width, height, span, window: win, items, background, foreground } = options;
  const pct = (date: number) => (dateToPercent(date, span) / 100) * width;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // marcos mensais
  ctx.font = "10px system-ui, sans-serif";
  ctx.textBaseline = "top";
  const cursor = new Date(span.min);
  const monthStart = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1);
  for (let ms = monthStart; ms <= span.max; ms = Date.UTC(
    new Date(ms).getUTCFullYear(),
    new Date(ms).getUTCMonth() + 1,
    1,
  )) {
    if (ms < span.min) continue;
    const x = Math.round(pct(ms)) + 0.5;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    const date = new Date(ms);
    const label = `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(
      date.getUTCFullYear(),
    ).slice(2)}`;
    ctx.fillStyle = foreground;
    ctx.fillText(label, x + 3, 3);
  }

  // itens
  for (const item of items) {
    const x = (item.rect.left / 100) * width;
    const w = Math.max((item.rect.width / 100) * width, 8);
    const midY = Math.round(height / 2);

    if (item.display === "band") {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = item.color;
      ctx.fillRect(x, 0, w, height);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, 1, w, height - 2);
      ctx.fillStyle = item.color;
      ctx.fillText(item.label, x + 4, height - 14);
    } else if (item.display === "card") {
      const cardHeight = 26;
      const y = midY - cardHeight / 2;
      ctx.fillStyle = background;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, w, cardHeight, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = foreground;
      ctx.fillText(item.label, x + 6, y + 8);
    } else {
      const barHeight = 16;
      const y = midY - barHeight / 2;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.roundRect(x, y, w, barHeight, 4);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(item.label, x + 6, y + 3);
    }
  }

  // recorte: escurece o que está fora da janela
  const left = pct(win.from);
  const right = pct(win.to);
  ctx.fillStyle = "rgba(15, 23, 42, 0.45)";
  ctx.fillRect(0, 0, Math.max(0, left), height);
  ctx.fillRect(Math.min(width, right), 0, width - Math.min(width, right), height);

  ctx.strokeStyle = foreground;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.max(0.5, left), 0.5, Math.max(0, right - left), height - 1);
}
