import { describe, expect, it } from "bun:test";
import {
  DAY_MS,
  MAX_PX_PER_DAY,
  MIN_PX_PER_DAY,
  addUnit,
  clampZoom,
  createTimeScale,
  displayUnitFor,
  startOfUnit,
} from "../src/gantt/timeScale";

const WINDOW_START = Date.UTC(2026, 10, 1); // 01/11/2026
const WIDTH = 2000;

function scale(pxPerDay: number, widthPx = WIDTH) {
  return createTimeScale({ pxPerDay, originMs: WINDOW_START, widthPx });
}

describe("limites e unidades de exibição", () => {
  it("restringe o zoom aos limites", () => {
    expect(clampZoom(0.1)).toBe(MIN_PX_PER_DAY);
    expect(clampZoom(99_999)).toBe(MAX_PX_PER_DAY);
    expect(clampZoom(Number.NaN)).toBe(26);
    expect(clampZoom(120)).toBe(120);
  });

  it("deriva a unidade de exibição conforme a tabela de zoom", () => {
    expect(displayUnitFor(500)).toBe("hour");
    expect(displayUnitFor(400)).toBe("hour");
    expect(displayUnitFor(399)).toBe("day");
    expect(displayUnitFor(90)).toBe("day");
    expect(displayUnitFor(89)).toBe("week");
    expect(displayUnitFor(26)).toBe("week");
    expect(displayUnitFor(25)).toBe("month");
    expect(displayUnitFor(8)).toBe("month");
    expect(displayUnitFor(7)).toBe("quarter");
    expect(displayUnitFor(3)).toBe("quarter");
    expect(displayUnitFor(2)).toBe("year");
    expect(displayUnitFor(MIN_PX_PER_DAY)).toBe("year");
  });
});

describe("conversão data ↔ pixel", () => {
  it("x e dateAt são inversos", () => {
    const s = scale(40);
    const date = Date.UTC(2026, 10, 15, 9, 30);
    expect(s.dateAt(s.x(date))).toBeCloseTo(date, 6);
  });

  it("a origem ocupa x = 0", () => {
    const s = scale(40);
    expect(s.x(WINDOW_START)).toBe(0);
  });

  it("um dia mede exatamente pxPerDay pixels", () => {
    const s = scale(42);
    expect(s.x(WINDOW_START + DAY_MS) - s.x(WINDOW_START)).toBeCloseTo(42, 6);
  });

  it("a janela visível cobre a largura informada", () => {
    const s = scale(40, 800);
    const { from, to } = s.window();
    expect(s.x(to) - s.x(from)).toBeCloseTo(800, 6);
    expect(to - from).toBeCloseTo((800 / 40) * DAY_MS, 3);
  });
});

describe("alinhamento das divisões em todos os níveis de zoom", () => {
  it("nível de hora: divisões em horas cheias e dias à meia-noite", () => {
    const s = scale(500);
    const ticks = s.ticks();

    expect(s.unit).toBe("hour");
    expect(ticks.minor.length).toBeGreaterThan(0);
    for (const tick of ticks.minor) {
      expect(tick.at % (60 * 60 * 1000)).toBe(0);
    }
    for (const tick of ticks.major) {
      expect(new Date(tick.at).getUTCHours()).toBe(0);
      expect(tick.at % DAY_MS).toBe(0);
    }
  });

  it("nível de dia: dias à meia-noite e semanas na segunda-feira", () => {
    const s = scale(150);
    const ticks = s.ticks();

    expect(s.unit).toBe("day");
    for (const tick of ticks.minor) expect(tick.at % DAY_MS).toBe(0);
    for (const tick of ticks.major) expect(new Date(tick.at).getUTCDay()).toBe(1);
  });

  it("nível de semana: semanas na segunda e cabeçalho ano › mês › semana", () => {
    const s = scale(40);
    const ticks = s.ticks();

    expect(s.unit).toBe("week");
    for (const tick of ticks.minor) expect(tick.at % DAY_MS).toBe(0);
    for (const tick of ticks.major) expect(new Date(tick.at).getUTCDay()).toBe(1);
    expect(ticks.header.map((entry) => entry.band)).toEqual(["year", "month", "week"]);
  });

  it("nível de mês: meses no dia 1 e trimestres em jan/abr/jul/out", () => {
    const s = scale(12);
    const ticks = s.ticks();

    expect(s.unit).toBe("month");
    for (const tick of ticks.minor) expect(new Date(tick.at).getUTCDate()).toBe(1);
    for (const tick of ticks.major) {
      const month = new Date(tick.at).getUTCMonth();
      expect([0, 3, 6, 9]).toContain(month);
      expect(new Date(tick.at).getUTCDate()).toBe(1);
    }
    expect(ticks.header.map((entry) => entry.band)).toEqual(["year", "month"]);
  });

  it("nível de trimestre: trimestres e anos alinhados", () => {
    const s = scale(5);
    const ticks = s.ticks();

    expect(s.unit).toBe("quarter");
    for (const tick of ticks.minor) {
      const date = new Date(tick.at);
      expect([0, 3, 6, 9]).toContain(date.getUTCMonth());
      expect(date.getUTCDate()).toBe(1);
    }
    for (const tick of ticks.major) {
      expect(new Date(tick.at).getUTCMonth()).toBe(0);
      expect(new Date(tick.at).getUTCDate()).toBe(1);
    }
  });

  it("nível de ano: anos em 1º de janeiro", () => {
    const s = scale(2);
    const ticks = s.ticks();

    expect(s.unit).toBe("year");
    for (const tick of ticks.minor) {
      const date = new Date(tick.at);
      expect(date.getUTCMonth()).toBe(0);
      expect(date.getUTCDate()).toBe(1);
    }
    expect(ticks.header.map((entry) => entry.band)).toEqual(["year", "semester"]);
  });

  it("as divisões ficam dentro da janela visível", () => {
    for (const px of [500, 150, 40, 12, 5, 2]) {
      const s = scale(px);
      const { from, to } = s.window();
      const ticks = s.ticks();

      for (const tick of [...ticks.minor, ...ticks.major]) {
        // a primeira divisão pode anteceder a janela (início da unidade)
        const floor = startOfUnit(from, tick.unit);
        expect(tick.at).toBeGreaterThanOrEqual(floor - DAY_MS);
        expect(tick.at).toBeLessThanOrEqual(to + DAY_MS);
      }

      expect(ticks.header.length).toBeGreaterThan(0);
      for (const band of ticks.header) {
        expect(band.ticks.length).toBeGreaterThan(0);
        for (const tick of band.ticks) expect(tick.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("nunca gera quantidade explosiva de divisões", () => {
    const s = createTimeScale({ pxPerDay: 400, originMs: WINDOW_START, widthPx: 200_000 });
    const ticks = s.ticks();
    expect(ticks.minor.length).toBeLessThanOrEqual(1500);
    expect(ticks.major.length).toBeLessThanOrEqual(1500);
  });
});

describe("snap", () => {
  it("aproxima para o início da unidade", () => {
    const s = scale(40); // semana
    const date = Date.UTC(2026, 10, 18, 13, 45);
    const snapped = s.snap(date);

    expect(new Date(snapped).getUTCHours()).toBe(0);
    expect(new Date(snapped).getUTCDay()).toBe(1); // segunda-feira
    expect(snapped).toBeLessThanOrEqual(date);
  });

  it("snap por unidade explícita", () => {
    const date = Date.UTC(2026, 10, 18, 13, 45);
    const s = scale(40);
    expect(s.snap(date, "day")).toBe(Date.UTC(2026, 10, 18));
    expect(s.snap(date, "month")).toBe(Date.UTC(2026, 10, 1));
  });
});

describe("aritmética de calendário", () => {
  it("startOfUnit alinha cada unidade", () => {
    const date = Date.UTC(2026, 10, 18, 13, 45);
    expect(startOfUnit(date, "day")).toBe(Date.UTC(2026, 10, 18));
    expect(startOfUnit(date, "month")).toBe(Date.UTC(2026, 10, 1));
    expect(startOfUnit(date, "quarter")).toBe(Date.UTC(2026, 9, 1));
    expect(startOfUnit(date, "year")).toBe(Date.UTC(2026, 0, 1));
  });

  it("addUnit respeita meses com tamanhos diferentes", () => {
    expect(addUnit(Date.UTC(2026, 0, 31), "month", 1)).toBe(Date.UTC(2026, 1, 28));
    expect(addUnit(Date.UTC(2024, 0, 31), "month", 1)).toBe(Date.UTC(2024, 1, 29));
    expect(addUnit(Date.UTC(2026, 11, 31), "month", 1)).toBe(Date.UTC(2027, 0, 31));
    expect(addUnit(Date.UTC(2026, 5, 15), "quarter", 1)).toBe(Date.UTC(2026, 8, 15));
    expect(addUnit(Date.UTC(2026, 5, 15), "year", -1)).toBe(Date.UTC(2025, 5, 15));
  });
});
