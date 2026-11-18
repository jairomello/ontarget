import { describe, expect, it } from "bun:test";
import {
  MIN_WINDOW_DAYS,
  clampWindow,
  dateToPercent,
  itemRect,
  parseTimelineConfig,
  percentToDate,
  projectSpan,
} from "../src/features/timeline/timelineModel";

/**
 * Timeline (specs/timeline-view): intervalo do projeto, recorte com janela
 * mínima, posicionamento dos itens e leitura da configuração salva.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

describe("projectSpan", () => {
  it("cobre o mínimo e o máximo entre as tarefas ativas", () => {
    const span = projectSpan(
      [
        { start: T0 + 10 * DAY, finish: T0 + 15 * DAY },
        { start: T0, finish: T0 + 5 * DAY },
        { start: T0 + 30 * DAY, finish: T0 + 40 * DAY },
      ],
      0,
    );
    expect(span.min).toBe(T0);
    expect(span.max).toBe(T0 + 40 * DAY);
  });

  it("ignora inativas e cai no padrão sem tarefas", () => {
    const span = projectSpan([{ start: T0, finish: T0, isInactive: true }], T0);
    expect(span.min).toBe(T0);
    expect(span.max).toBe(T0 + 30 * DAY);
  });
});

describe("clampWindow", () => {
  const span = { min: T0, max: T0 + 100 * DAY };

  it("prende o recorte ao intervalo do projeto", () => {
    const window = clampWindow(T0 - 50 * DAY, T0 + 500 * DAY, span);
    expect(window.from).toBe(span.min);
    expect(window.to).toBe(span.max);
  });

  it("impede janela menor que a mínima", () => {
    const window = clampWindow(T0, T0 + 1 * DAY, span);
    expect(window.to - window.from).toBe(MIN_WINDOW_DAYS * DAY);
    expect(window.from).toBe(T0);
  });

  it("aceita intervalo menor que a janela mínima", () => {
    const tiny = { min: T0, max: T0 + 2 * DAY };
    expect(clampWindow(T0, T0 + 2 * DAY, tiny)).toEqual({
      from: tiny.min,
      to: tiny.max,
    });
  });
});

describe("posição das datas e itens", () => {
  const span = { min: T0, max: T0 + 10 * DAY };

  it("percentual e data são inversos", () => {
    expect(dateToPercent(T0, span)).toBe(0);
    expect(dateToPercent(T0 + 10 * DAY, span)).toBe(100);
    expect(percentToDate(50, span)).toBe(T0 + 5 * DAY);
    expect(percentToDate(dateToPercent(T0 + 3 * DAY, span), span)).toBe(T0 + 3 * DAY);
  });

  it("o término inclusivo soma um dia ao retângulo", () => {
    const rect = itemRect({ start: T0, finish: T0 + 4 * DAY }, span)!;
    expect(rect.left).toBe(0);
    // 4 dias de duração + 1 dia inclusivo = 5 de 10 → 50%
    expect(rect.width).toBe(50);
  });

  it("tarefa sem datas não vira item", () => {
    expect(itemRect({ start: null, finish: null }, span)).toBeNull();
  });
});

describe("parseTimelineConfig", () => {
  it("lê uma configuração válida", () => {
    const config = parseTimelineConfig(
      JSON.stringify({
        items: [{ taskId: "t1", color: "#ff0000", label: "Fase", display: "band" }],
        from: 1,
        to: 2,
        sync: false,
      }),
    );
    expect(config.items).toEqual([
      { taskId: "t1", color: "#ff0000", label: "Fase", display: "band" },
    ]);
    expect(config.from).toBe(1);
    expect(config.to).toBe(2);
    expect(config.sync).toBe(false);
  });

  it("tolera JSON inválido e normaliza campos desconhecidos", () => {
    expect(parseTimelineConfig("lixo").items).toEqual([]);
    expect(parseTimelineConfig(null).sync).toBe(true);

    const normalized = parseTimelineConfig(
      JSON.stringify({
        items: [{ taskId: "t1", display: "holograma" }, { color: "#000" }],
        sync: true,
      }),
    );
    expect(normalized.items).toEqual([
      { taskId: "t1", color: null, label: null, display: "bar" },
    ]);
  });
});
