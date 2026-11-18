import { describe, expect, it } from "bun:test";
import { HOUR_MS, defaultCalendar } from "../src/calendar/calendar";
import { classifyDelay, progressAt } from "../src/tracking/status";

/**
 * Data de status (specs/tracking): classificação de atraso com o desvio em
 * dias úteis e progresso proporcional para a atualização em lote.
 *
 * 05/01/2026 é segunda-feira.
 */

const MON = Date.UTC(2026, 0, 5);
const DAY = 86_400_000;
const HOUR = HOUR_MS;
const cal = defaultCalendar();

describe("classifyDelay (atraso vs. data de status)", () => {
  it("não concluída e fim planejado antes da data: atrasada com o desvio", () => {
    // plano termina quinta (08/01); data de status segunda (12/01)
    const result = classifyDelay(
      { start: MON, finish: MON + 3 * DAY, percentComplete: 0 },
      MON + 7 * DAY,
      cal,
    );

    // dias úteis após o fim: sexta, segunda → 2 dias
    expect(result).toEqual({ delayed: true, deviationDays: 2 });
  });

  it("desvio de um dia útil", () => {
    const result = classifyDelay(
      { start: MON, finish: MON + DAY, percentComplete: 50 },
      MON + 2 * DAY, // quarta, fim planejado terça
      cal,
    );

    expect(result).toEqual({ delayed: true, deviationDays: 1 });
  });

  it("pula o fim de semana no desvio", () => {
    // fim planejado sexta (10/01), data de status segunda (12/01)
    const result = classifyDelay(
      { start: MON, finish: Date.UTC(2026, 0, 9), percentComplete: 0 },
      Date.UTC(2026, 0, 12),
      cal,
    );

    expect(result).toEqual({ delayed: true, deviationDays: 1 });
  });

  it("concluída nunca está atrasada", () => {
    expect(
      classifyDelay({ start: MON, finish: MON, percentComplete: 100 }, MON + 5 * DAY, cal),
    ).toEqual({ delayed: false, deviationDays: 0 });
    expect(
      classifyDelay(
        { start: MON, finish: MON, percentComplete: 0, actualFinish: MON },
        MON + 5 * DAY,
        cal,
      ),
    ).toEqual({ delayed: false, deviationDays: 0 });
  });

  it("fim igual ou posterior à data de status não atrasa", () => {
    expect(
      classifyDelay({ start: MON, finish: MON + 3 * DAY, percentComplete: 0 }, MON + 3 * DAY, cal),
    ).toEqual({ delayed: false, deviationDays: 0 });
    expect(
      classifyDelay({ start: MON, finish: MON + 9 * DAY, percentComplete: 0 }, MON + 3 * DAY, cal),
    ).toEqual({ delayed: false, deviationDays: 0 });
  });

  it("sem datas não classifica", () => {
    expect(classifyDelay({ start: null, finish: null, percentComplete: 0 }, MON, cal)).toEqual({
      delayed: false,
      deviationDays: 0,
    });
  });
});

describe("progressAt (atualização em lote)", () => {
  it("proporcional aos dias transcorridos na data de status", () => {
    // tarefa de 5 dias (seg–sex, 45 h); status na quinta → 4 de 5 dias = 80%
    const result = progressAt(
      { start: MON, finish: MON + 4 * DAY, percentComplete: 0 },
      MON + 3 * DAY,
      cal,
    );

    expect(result).toBe(80);
  });

  it("dia inicial conta no período (1 de 3 = 33,33%)", () => {
    const result = progressAt(
      { start: MON, finish: MON + 2 * DAY, percentComplete: 0 },
      MON,
      cal,
    );

    expect(result).toBeCloseTo(33.33, 2);
  });

  it("data de status além do fim conclui a tarefa (100%)", () => {
    const result = progressAt(
      { start: MON, finish: MON + DAY, percentComplete: 10 },
      MON + 10 * DAY,
      cal,
    );

    expect(result).toBe(100);
  });

  it("tarefa ainda não iniciada ou já concluída não se aplica", () => {
    expect(
      progressAt({ start: MON + 5 * DAY, finish: MON + 9 * DAY, percentComplete: 0 }, MON, cal),
    ).toBeNull();
    expect(progressAt({ start: MON, finish: MON + DAY, percentComplete: 100 }, MON + 3 * DAY, cal)).toBeNull();
  });

  it("marco é binário", () => {
    expect(progressAt({ start: MON, finish: MON, percentComplete: 0 }, MON - DAY, cal)).toBeNull();
    expect(progressAt({ start: MON, finish: MON, percentComplete: 0 }, MON, cal)).toBe(100);
  });
});
