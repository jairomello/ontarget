import { describe, expect, it } from "bun:test";
import {
  barGeometry,
  linkGeometry,
  roundedPath,
  type BarGeometryInput,
  type LinkBar,
} from "../src/gantt/geometry";
import { DAY_MS } from "../src/gantt/timeScale";

const ORIGIN = Date.UTC(2026, 10, 1);
const PX = 40;
const scale = { x: (ms: number) => ((ms - ORIGIN) / DAY_MS) * PX };

function task(overrides: Partial<BarGeometryInput> = {}): BarGeometryInput {
  return {
    id: "t1",
    start: ORIGIN,
    // conv. inclusive: 3 dias (0..2), fim no último dia trabalhado
    finish: ORIGIN + 2 * DAY_MS,
    duration: 3 * DAY_MS,
    isSummary: false,
    isMilestone: false,
    isInactive: false,
    isPlaceholder: false,
    percentComplete: 0,
    ...overrides,
  };
}

function bar(startDays: number, finishDays: number, rowY: number): LinkBar {
  return {
    start: ORIGIN + startDays * DAY_MS,
    finish: ORIGIN + finishDays * DAY_MS,
    rowY,
    rowHeight: 28,
  };
}

describe("barGeometry (5.2)", () => {
  const row = { y: 100, height: 28 };

  it("retângulo de tarefa comum", () => {
    const rect = barGeometry(task(), scale, row)!;

    expect(rect.kind).toBe("task");
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(120); // 3 dias × 40 px
    expect(rect.height).toBe(18);
    expect(rect.y).toBe(105); // centralizado na linha
    expect(rect.progress).toBe(0);
  });

  it("preenchimento de progresso proporcional ao percentual", () => {
    const rect = barGeometry(task({ percentComplete: 50 }), scale, row)!;
    expect(rect.progress).toBe(60);

    const full = barGeometry(task({ percentComplete: 100 }), scale, row)!;
    expect(full.progress).toBe(full.width);
  });

  it("resumo é mais baixo e centrado", () => {
    const rect = barGeometry(task({ isSummary: true }), scale, row)!;
    expect(rect.kind).toBe("summary");
    expect(rect.height).toBe(16);
    expect(rect.y).toBe(106);
  });

  it("marco vira losango na data de início", () => {
    const rect = barGeometry(
      task({ isMilestone: true, start: ORIGIN + 5 * DAY_MS, finish: ORIGIN + 5 * DAY_MS, duration: 0 }),
      scale,
      row,
    )!;

    expect(rect.kind).toBe("milestone");
    expect(rect.width).toBe(rect.height);
    expect(rect.x + rect.width / 2).toBe(200); // centro em x(5 dias)
  });

  it("inativa e placeholder são reconhecíveis e sem progresso", () => {
    expect(barGeometry(task({ isInactive: true }), scale, row)!.kind).toBe("inactive");
    const placeholder = barGeometry(task({ isPlaceholder: true }), scale, row)!;
    expect(placeholder.kind).toBe("placeholder");
    expect(placeholder.progress).toBe(0);
  });

  it("sem datas não há barra", () => {
    expect(barGeometry(task({ start: null, finish: null }), scale, row)).toBeNull();
  });

  it("tarefa sem duração visível mantém largura mínima", () => {
    const rect = barGeometry(task({ finish: ORIGIN, duration: 0 }), scale, row)!;
    expect(rect.width).toBeGreaterThanOrEqual(1);
  });
});

describe("linkGeometry (5.2)", () => {
  // conv. inclusive: borda direita da barra = dia seguinte ao último
  const predecessor = bar(0, 2, 100); // caixa {0,105,120,18} — direita (120,114)
  const successor = bar(4, 5, 150); // caixa {160,155,80,18} — esquerda (160,164)

  /** Caixas calculadas por `barGeometry` (fonte única com as barras do Gantt). */
  const sourceBox = { x: 0, y: 105, w: 120, h: 18 };
  const targetBox = { x: 160, y: 155, w: 80, h: 18 };

  function anchorsOf(box: { x: number; y: number; w: number; h: number }) {
    return [
      { x: box.x, y: box.y + box.h / 2 },
      { x: box.x + box.w, y: box.y + box.h / 2 },
      { x: box.x + box.w / 2, y: box.y },
      { x: box.x + box.w / 2, y: box.y + box.h },
    ];
  }
  const anchors = [...anchorsOf(sourceBox), ...anchorsOf(targetBox)];

  function pointsFor(type: "fs" | "ss" | "ff" | "sf") {
    return linkGeometry({ type, lagMs: 0, predecessor, successor }, scale)!;
  }

  function assertOrthogonal(points: Array<{ x: number; y: number }>) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      const horizontal = Math.abs(previous.y - current.y) < 0.01;
      const vertical = Math.abs(previous.x - current.x) < 0.01;
      expect(horizontal || vertical).toBe(true);
    }
  }

  function isAnchor(point: { x: number; y: number }) {
    return anchors.some(
      (anchor) => Math.abs(anchor.x - point.x) < 0.01 && Math.abs(anchor.y - point.y) < 0.01,
    );
  }

  /** Trecho do caminho que entraria num retângulo (colisão por segmento). */
  function hitsBox(points: Array<{ x: number; y: number }>, box: { x: number; y: number; w: number; h: number }) {
    for (let index = 1; index < points.length; index += 1) {
      const p = points[index - 1]!;
      const q = points[index]!;
      const crosses =
        Math.min(p.x, q.x) < box.x + box.w &&
        Math.max(p.x, q.x) > box.x &&
        Math.min(p.y, q.y) < box.y + box.h &&
        Math.max(p.y, q.y) > box.y;
      if (crosses) return true;
    }
    return false;
  }

  it("nasce e morre exatamente em um ponto de conexão das barras", () => {
    for (const type of ["fs", "ss", "ff", "sf"] as const) {
      const link = pointsFor(type);
      expect(isAnchor(link.points[0]!)).toBe(true);
      expect(isAnchor(link.points.at(-1)!)).toBe(true);
      expect(anchors).toContainEqual({ x: link.arrow.x, y: link.arrow.y });
    }
  });

  it("FS sai pela direita da origem e entra num ponto do destino", () => {
    const link = pointsFor("fs");

    expect(link.points[0]).toEqual({ x: 120, y: 114 });
    expect(link.from).toBe("right");
    expect(["left", "top", "bottom"]).toContain(link.to);
    assertOrthogonal(link.points);
  });

  it("caminho com no máximo duas curvas — e o caso típico FS rende uma", () => {
    for (const type of ["fs", "ss", "ff", "sf"] as const) {
      expect(pointsFor(type).curves).toBeLessThanOrEqual(2);
    }

    const link = pointsFor("fs");
    expect(link.curves).toBe(1);
    expect(link.points).toHaveLength(3); // sai, dá uma curva e entra
    expect(Math.round(link.arrow.angle)).toBe(90); // chega pelo topo, apontando para baixo
  });

  it("linhas na mesma altura geram reta sem curvas", () => {
    const sameRow: LinkBar = {
      start: ORIGIN + 4 * DAY_MS,
      finish: ORIGIN + 6 * DAY_MS,
      rowY: 100,
      rowHeight: 28,
    };
    const link = linkGeometry({ type: "fs", lagMs: 0, predecessor, successor: sameRow }, scale)!;

    expect(link.curves).toBe(0);
    expect(link.points.length).toBeGreaterThanOrEqual(2);
    assertOrthogonal(link.points);
    // todos os pontos na mesma altura: linha reta
    for (const point of link.points) expect(point.y).toBe(114);
    expect(link.d.startsWith("M")).toBe(true);
  });

  it("sobreposição não atravessa as próprias barras", () => {
    // o destino começa antes do fim da origem (sobreposição)
    const overlappingBox = { x: 40, y: 155, w: 120, h: 18 };
    const overlapping = bar(1, 3, 150);
    const link = linkGeometry({ type: "fs", lagMs: 0, predecessor, successor: overlapping }, scale)!;

    const points = [...anchorsOf(sourceBox), ...anchorsOf(overlappingBox)];
    const isOverlapAnchor = (point: { x: number; y: number }) =>
      points.some(
        (anchor) => Math.abs(anchor.x - point.x) < 0.01 && Math.abs(anchor.y - point.y) < 0.01,
      );

    expect(isOverlapAnchor(link.points[0]!)).toBe(true);
    expect(isOverlapAnchor(link.points.at(-1)!)).toBe(true);
    expect(hitsBox(link.points, sourceBox)).toBe(false);
    expect(hitsBox(link.points, overlappingBox)).toBe(false);
    expect(link.curves).toBeLessThanOrEqual(2);
  });

  it("desvia de um obstáculo colocado no caminho", () => {
    const clear = pointsFor("fs");
    expect(hitsBox(clear.points, { x: 150, y: 100, w: 60, h: 30 })).toBe(true);

    const blocked = linkGeometry(
      {
        type: "fs",
        lagMs: 0,
        predecessor,
        successor,
        obstacles: [{ id: "other", x: 150, y: 100, w: 60, h: 30 }],
      },
      scale,
    )!;

    expect(hitsBox(blocked.points, { x: 150, y: 100, w: 60, h: 30 })).toBe(false);
    expect(isAnchor(blocked.points[0]!)).toBe(true);
    expect(isAnchor(blocked.points.at(-1)!)).toBe(true);
    assertOrthogonal(blocked.points);
  });

  it("a seta aponta para o ponto final", () => {
    const link = pointsFor("fs");
    expect(link.arrow.x).toBe(link.points.at(-1)!.x);
    expect(link.arrow.y).toBe(link.points.at(-1)!.y);
  });

  it("latência vira rótulo; ausência de latência não rotula", () => {
    const withLag = linkGeometry(
      { type: "fs", lagMs: 2 * DAY_MS, predecessor, successor },
      scale,
    )!;
    expect(withLag.lagLabel).toBe("+2d");

    const lead = linkGeometry(
      { type: "fs", lagMs: -DAY_MS, predecessor, successor },
      scale,
    )!;
    expect(lead.lagLabel).toBe("−1d");

    expect(pointsFor("fs").lagLabel).toBeNull();
  });

  it("sem datas em alguma das pontas não há caminho", () => {
    expect(
      linkGeometry(
        { type: "fs", lagMs: 0, predecessor: { ...predecessor, start: null, finish: null }, successor },
        scale,
      ),
    ).toBeNull();
  });

  it("vértices redundantes são removidos do caminho", () => {
    const overlapping = bar(1, 3, 150);
    const link = linkGeometry({ type: "fs", lagMs: 0, predecessor, successor: overlapping }, scale)!;

    for (let index = 1; index < link.points.length - 1; index += 1) {
      const previous = link.points[index - 1]!;
      const current = link.points[index]!;
      const next = link.points[index + 1]!;
      const straightX = previous.x === current.x && current.x === next.x;
      const straightY = previous.y === current.y && current.y === next.y;
      expect(straightX || straightY).toBe(false);
    }
  });

  it("rótulo de latência ancora no último segmento", () => {
    const link = linkGeometry({ type: "fs", lagMs: 2 * DAY_MS, predecessor, successor }, scale)!;

    expect(link.labelAt.x).toBe(200); // calha vertical do caminho
    expect(link.labelAt.y).toBeGreaterThan(114);
    expect(link.labelAt.y).toBeLessThan(155);
  });
});

describe("roundedPath (5.2)", () => {
  it("preserva os extremos", () => {
    const d = roundedPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 50 },
      { x: 60, y: 50 },
    ]);

    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("L 60 50")).toBe(true);
    expect(d).toContain("Q"); // canto arredondado
  });

  it("linha reta de dois pontos não ganha curva", () => {
    const d = roundedPath([
      { x: 5, y: 5 },
      { x: 5, y: 40 },
    ]);
    expect(d).toBe("M 5 5 L 5 40");
  });
});
