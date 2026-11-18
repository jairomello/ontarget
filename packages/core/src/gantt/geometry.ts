/**
 * Geometria do Gantt (docs/architecture.md §9.4): retângulos das barras por
 * tipo e caminho ortogonal dos vínculos, com cantos arredondados e desvio
 * mínimo em relação às barras.
 *
 * Puro — recebe uma função `x(data)` da escala e as métricas da linha.
 */

import { DAY_MS } from "./timeScale";

export type BarKind = "task" | "summary" | "milestone" | "inactive" | "placeholder";

export interface BarGeometryInput {
  id: string;
  start: number | null;
  finish: number | null;
  duration: number | null;
  isSummary: boolean;
  isMilestone: boolean;
  isInactive: boolean;
  isPlaceholder: boolean;
  percentComplete: number;
  /** Manual (sem agendamento calculado). */
  schedulingMode?: string;
}

export interface RowMetrics {
  y: number;
  height: number;
}

export interface BarGeometry {
  id: string;
  kind: BarKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Largura do preenchimento de progresso (0..width). */
  progress: number;
}

export interface ScaleX {
  x(dateMs: number): number;
}

/** Alturas por tipo (px), proporcionais à linha. */
export function barHeight(kind: BarKind, rowHeight: number): number {
  switch (kind) {
    case "summary":
      return Math.max(12, Math.min(16, rowHeight - 10));
    case "milestone":
      return Math.max(12, Math.min(14, rowHeight - 10));
    case "placeholder":
      return Math.max(10, Math.min(14, rowHeight - 12));
    default:
      return Math.max(12, Math.min(18, rowHeight - 8));
  }
}

export function barKind(task: BarGeometryInput): BarKind {
  if (task.isInactive) return "inactive";
  if (task.isPlaceholder) return "placeholder";
  if (task.isMilestone) return "milestone";
  if (task.isSummary) return "summary";
  return "task";
}

/**
 * Retângulo da barra. Retorna `null` quando a tarefa não tem datas
 * suficientes para ser desenhada.
 */
export function barGeometry(
  task: BarGeometryInput,
  scale: ScaleX,
  row: RowMetrics,
): BarGeometry | null {
  const anchor = task.start ?? task.finish;
  const end = task.finish ?? task.start;
  if (anchor === null || end === null) return null;

  const kind = barKind(task);
  const height = barHeight(kind, row.height);
  const y = row.y + (row.height - height) / 2;

  if (kind === "milestone") {
    const size = height;
    const center = scale.x(anchor);
    return {
      id: task.id,
      kind,
      x: center - size / 2,
      y,
      width: size,
      height: size,
      progress: size,
    };
  }

  const left = scale.x(Math.min(anchor, end));
  // `finish` inclusive: a barra cobre também o último dia
  const right = scale.x(Math.max(anchor, end) + DAY_MS);
  const width = Math.max(kind === "placeholder" ? 8 : 1, right - left);

  const percent = Math.max(0, Math.min(100, task.percentComplete ?? 0));
  const progress =
    kind === "inactive" || kind === "placeholder" ? 0 : Math.round((width * percent) / 100);

  return { id: task.id, kind, x: left, y, width, height, progress };
}

/* -------------------------------------------------------------------------- */
/* Vínculos                                                                     */
/* -------------------------------------------------------------------------- */

export type LinkType = "fs" | "ss" | "ff" | "sf";

export interface LinkBar {
  /** Identidade da barra — permite excluí-la dos obstáculos do próprio vínculo. */
  id?: string;
  start: number | null;
  /** Inclusive — meia-noite do último dia trabalhado. */
  finish: number | null;
  /** Marcos se ancoram no centro do losango, sem +1 dia. */
  isMilestone?: boolean;
  /** Mesmos semânticos de `BarGeometryInput`: definem a altura da barra. */
  isSummary?: boolean;
  isInactive?: boolean;
  isPlaceholder?: boolean;
  rowY: number;
  rowHeight: number;
}

/** Retângulo de uma barra já posicionada no espaço do Gantt. */
export interface LinkObstacle {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LinkGeometryInput {
  type: LinkType;
  /** Latência em ms (negativa = antecipação). */
  lagMs: number;
  predecessor: LinkBar;
  successor: LinkBar;
  /** Barras visíveis, para o caminho escolhido não atravessá-las. */
  obstacles?: LinkObstacle[];
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Pontos de conexão de uma barra (docs/prototipo-vinculos): a linha nasce e
 * morre exatamente em um deles, como em um programa de desenho vetorial.
 */
export type LinkAnchor = "left" | "right" | "top" | "bottom";

export interface LinkGeometry {
  /** Caminho SVG com cantos arredondados. */
  d: string;
  /** Pontos do caminho (para testes e inspeção). */
  points: Point[];
  /** Ponto final e ângulo da seta. */
  arrow: { x: number; y: number; angle: number };
  /** Ponto médio do último segmento — onde o rótulo de latência é ancorado. */
  labelAt: Point;
  /** Rótulo de latência, quando houver. */
  lagLabel: string | null;
  /** Ponto de conexão de saída (origem) escolhido pelo roteador. */
  from: LinkAnchor;
  /** Ponto de conexão de entrada (destino) escolhido pelo roteador. */
  to: LinkAnchor;
  /** Número de curvas do caminho escolhido (0 = reta). */
  curves: number;
}

const MIN_STUB = 8;
const CORNER_RADIUS = 5;
/** Peso de uma curva no custo do caminho, em px de extensão. */
const CURVE_PENALTY = 40;
/** Atravessar as próprias pontas custa caro, mas é preferível a não ter caminho. */
const OWN_PENALTY = 5_000;
const COLLISION_PENALTY = 100_000;

interface LinkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Anchor extends Point {
  dx: number;
  dy: number;
}

interface Candidate {
  points: Point[];
  curves: number;
  from: LinkAnchor;
  to: LinkAnchor;
  cost: number;
}

/** Retângulo da barra — mesma métrica de `barGeometry`. */
function boxOf(bar: LinkBar, scale: ScaleX): LinkBox | null {
  const rect = barGeometry(
    {
      id: "link",
      start: bar.start,
      finish: bar.finish,
      duration: null,
      isSummary: bar.isSummary ?? false,
      isMilestone: bar.isMilestone ?? false,
      isInactive: bar.isInactive ?? false,
      isPlaceholder: bar.isPlaceholder ?? false,
      percentComplete: 0,
    },
    scale,
    { y: bar.rowY, height: bar.rowHeight },
  );
  if (!rect) return null;
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
}

function anchorsOf(box: LinkBox): Record<LinkAnchor, Anchor> {
  return {
    left: { x: box.x, y: box.y + box.h / 2, dx: -1, dy: 0 },
    right: { x: box.x + box.w, y: box.y + box.h / 2, dx: 1, dy: 0 },
    top: { x: box.x + box.w / 2, y: box.y, dx: 0, dy: -1 },
    bottom: { x: box.x + box.w / 2, y: box.y + box.h, dx: 0, dy: 1 },
  };
}

/** Lados que a semântica do tipo de vínculo permite em cada ponta. */
function allowedAnchors(type: LinkType): { source: LinkAnchor[]; target: LinkAnchor[] } {
  switch (type) {
    case "ss":
      return { source: ["left", "top", "bottom"], target: ["left", "top", "bottom"] };
    case "ff":
      return { source: ["right", "top", "bottom"], target: ["right", "top", "bottom"] };
    case "sf":
      return { source: ["left", "top", "bottom"], target: ["right", "top", "bottom"] };
    default:
      return { source: ["right", "top", "bottom"], target: ["left", "top", "bottom"] };
  }
}

/**
 * Remove pontos repetidos e vértices redundantes (A→B→C alinhados), para que
 * o caminho não acumule degraus minúsculos nem curvas degeneradas.
 */
function simplify(points: Point[]): Point[] {
  const deduped: Point[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) continue;
    deduped.push(point);
  }

  const result: Point[] = [];
  for (let index = 0; index < deduped.length; index += 1) {
    const previous = result[result.length - 1];
    const current = deduped[index]!;
    const next = deduped[index + 1];
    if (previous && next) {
      const straightX =
        Math.abs(previous.x - current.x) < 0.01 && Math.abs(current.x - next.x) < 0.01;
      const straightY =
        Math.abs(previous.y - current.y) < 0.01 && Math.abs(current.y - next.y) < 0.01;
      if (straightX || straightY) continue;
    }
    result.push(current);
  }
  return result.length >= 2 ? result : deduped;
}

/**
 * Converte uma polilinha ortogonal em path com cantos arredondados.
 * Os extremos nunca se movem.
 */
export function roundedPath(points: Point[], radius = CORNER_RADIUS): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;

  let d = `M ${round(points[0]!.x)} ${round(points[0]!.y)}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;

    const inLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outLength = Math.hypot(next.x - current.x, next.y - current.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);

    const before = {
      x: current.x + ((previous.x - current.x) / (inLength || 1)) * r,
      y: current.y + ((previous.y - current.y) / (inLength || 1)) * r,
    };
    const after = {
      x: current.x + ((next.x - current.x) / (outLength || 1)) * r,
      y: current.y + ((next.y - current.y) / (outLength || 1)) * r,
    };

    d += ` L ${round(before.x)} ${round(before.y)}`;
    d += ` Q ${round(current.x)} ${round(current.y)} ${round(after.x)} ${round(after.y)}`;
  }

  const last = points[points.length - 1]!;
  d += ` L ${round(last.x)} ${round(last.y)}`;
  return d;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Todos os caminhos ortogonais entre dois pontos de conexão. A orientação do
 * ponto (horizontal/vertical) define como a linha sai e como ela chega:
 *
 *  - alinhados             → reta (0 curvas)
 *  - horizontal→vertical   → `H-V` (1 curva)
 *  - vertical→horizontal   → `V-H` (1 curva)
 *  - horizontal→horizontal → `H-V-H` (2 curvas), com calhas nos dois lados
 *  - vertical→vertical     → `V-H-V` (2 curvas), com calhas em volta
 *
 * As calhas extras existem para que sempre haja um caminho que não atravesse
 * as próprias barras — aí o custo decide.
 */
function candidatesFor(s: Anchor, d: Anchor): Point[][] {
  const paths: Point[][] = [];
  const fromHorizontal = s.dy === 0;
  const toHorizontal = d.dy === 0;

  if (fromHorizontal && toHorizontal && Math.abs(s.y - d.y) < 0.5) paths.push([s, d]);
  if (!fromHorizontal && !toHorizontal && Math.abs(s.x - d.x) < 0.5) paths.push([s, d]);

  if (fromHorizontal && toHorizontal) {
    const direction = Math.sign(d.x - s.x) || 1;
    for (const rail of [
      s.x + direction * MIN_STUB,
      s.x - direction * MIN_STUB,
      d.x - direction * MIN_STUB,
      d.x + direction * MIN_STUB,
    ]) {
      paths.push([s, { x: rail, y: s.y }, { x: rail, y: d.y }, d]);
    }
  } else if (fromHorizontal && !toHorizontal) {
    paths.push([s, { x: d.x, y: s.y }, d]);
  } else if (!fromHorizontal && toHorizontal) {
    paths.push([s, { x: s.x, y: d.y }, d]);
  } else {
    const direction = Math.sign(d.y - s.y) || 1;
    for (const rail of [
      (s.y + d.y) / 2,
      s.y + direction * MIN_STUB,
      s.y - direction * MIN_STUB,
      d.y - direction * MIN_STUB,
      d.y + direction * MIN_STUB,
    ]) {
      paths.push([s, { x: s.x, y: rail }, { x: d.x, y: rail }, d]);
    }
  }

  return paths;
}

/** Cada vértice interno é uma curva; a reta pura tem zero. */
function countCurves(points: Point[]): number {
  return Math.max(0, points.length - 2);
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  }
  return total;
}

function segmentHitsBox(p: Point, q: Point, box: LinkBox, margin = 2): boolean {
  const x1 = Math.min(p.x, q.x);
  const x2 = Math.max(p.x, q.x);
  const y1 = Math.min(p.y, q.y);
  const y2 = Math.max(p.y, q.y);
  return (
    x1 < box.x + box.w + margin &&
    x2 > box.x - margin &&
    y1 < box.y + box.h + margin &&
    y2 > box.y - margin
  );
}

/** Quantos segmentos do caminho atravessariam uma barra visível. */
function collisions(points: Point[], boxes: LinkBox[], margin = 2): number {
  let hits = 0;
  for (let index = 1; index < points.length; index += 1) {
    for (const box of boxes) {
      if (segmentHitsBox(points[index - 1]!, points[index]!, box, margin)) hits += 1;
    }
  }
  return hits;
}

/**
 * Caminho do vínculo entre duas barras.
 *
 * O roteador testa todos os pares de pontos de conexão permitidos pela
 * semântica do tipo (docs/prototipo-vinculos) e escolhe o caminho de menor
 * custo — `curvas × CURVE_PENALTY + extensão`, com penalidade alta para
 * caminhos que atravessariam barras. Empates são resolvidos pelo menor número
 * de vértices: quanto menos curvas, melhor.
 *
 * Âncoras por tipo (docs/Design.md §6.3), sempre com `top`/`bottom` como
 * alternativa — é o que permite caminhos de uma única curva:
 *  - FS: origem `right` → destino `left`
 *  - SS: origem `left`  → destino `left`
 *  - FF: origem `right` → destino `right`
 *  - SF: origem `left`  → destino `right`
 */
export function linkGeometry(input: LinkGeometryInput, scale: ScaleX): LinkGeometry | null {
  const { type, predecessor, successor } = input;

  const sourceBox = boxOf(predecessor, scale);
  const targetBox = boxOf(successor, scale);
  if (!sourceBox || !targetBox) return null;

  const sourceAnchors = anchorsOf(sourceBox);
  const targetAnchors = anchorsOf(targetBox);
  const sides = allowedAnchors(type);

  const isOwn = (obstacle: LinkObstacle, bar: LinkBar) =>
    bar.id !== undefined && obstacle.id === bar.id;
  const obstacles = (input.obstacles ?? []).filter(
    (obstacle) => !isOwn(obstacle, predecessor) && !isOwn(obstacle, successor),
  );
  const ownBoxes = [sourceBox, targetBox];

  let best: Candidate | null = null;
  for (const from of sides.source) {
    for (const to of sides.target) {
      for (const points of candidatesFor(sourceAnchors[from], targetAnchors[to])) {
        if (points.length < 2) continue;
        const curves = countCurves(points);
        const cost =
          curves * CURVE_PENALTY +
          pathLength(points) +
          // as próprias pontas entram enxugadas em2 px: o ponto de conexão
          // está na borda e sair por ela não é atravessar a barra
          collisions(points, ownBoxes, -2) * OWN_PENALTY +
          collisions(points, obstacles) * COLLISION_PENALTY;

        if (
          !best ||
          cost < best.cost ||
          (cost === best.cost && points.length < best.points.length)
        ) {
          best = { points, curves, from, to, cost };
        }
      }
    }
  }
  if (!best) return null;

  // os extremos entram como `Anchor` (com dx/dy para a lógica); o caminho
  // exposto é só geometria
  const points = simplify(best.points.map((point) => ({ x: point.x, y: point.y })));

  // Seta na extremidade final.
  const last = points[points.length - 1]!;
  const before = points[points.length - 2] ?? last;
  const angle = (Math.atan2(last.y - before.y, last.x - before.x) * 180) / Math.PI;
  const labelAt = { x: (before.x + last.x) / 2, y: (before.y + last.y) / 2 };

  const lagLabel =
    input.lagMs === 0
      ? null
      : `${input.lagMs > 0 ? "+" : "−"}${Math.round(Math.abs(input.lagMs) / DAY_MS)}d`;

  return {
    d: roundedPath(points),
    points,
    arrow: { x: last.x, y: last.y, angle },
    labelAt,
    lagLabel,
    from: best.from,
    to: best.to,
    curves: countCurves(points),
  };
}
