import { describe, expect, it } from "bun:test";
import {
  DAY_MS,
  HOUR_MS,
  addWorkingTime,
  defaultCalendar,
  durationBetween,
  isWorkingDay,
  isWorkingTime,
  nextWorkingMoment,
  subtractWorkingTime,
  workingDaysBetween,
  workingWindow,
  type Calendar,
} from "../src/calendar/calendar";

/**
 * 05/01/2026 é segunda-feira; 10/01 é sábado e 11/01 é domingo.
 */
const MON = Date.UTC(2026, 0, 5);
const TUE = MON + DAY_MS;
const FRI = MON - 3 * DAY_MS; // sexta anterior
const SAT = Date.UTC(2026, 0, 10);
const SUN = Date.UTC(2026, 0, 11);

const HOUR = (value: number) => value * HOUR_MS;
const cal = defaultCalendar();

describe("dias úteis e janelas de trabalho", () => {
  it("seg a sex são úteis; sábado e domingo não", () => {
    expect(isWorkingDay(cal, MON)).toBe(true);
    expect(isWorkingDay(cal, FRI)).toBe(true);
    expect(isWorkingDay(cal, SAT)).toBe(false);
    expect(isWorkingDay(cal, SUN)).toBe(false);
  });

  it("o turno vai das 09:00 às 18:00, com fim exclusivo", () => {
    expect(isWorkingTime(cal, MON + HOUR(9))).toBe(true);
    expect(isWorkingTime(cal, MON + HOUR(17) + 59 * 60_000)).toBe(true);

    expect(isWorkingTime(cal, MON + HOUR(8) + 59 * 60_000)).toBe(false);
    expect(isWorkingTime(cal, MON + HOUR(18))).toBe(false);
    expect(isWorkingTime(cal, MON + HOUR(12))).toBe(true);
    expect(isWorkingTime(cal, SAT + HOUR(12))).toBe(false);
  });

  it("a janela do dia é calculada a partir do turno", () => {
    expect(workingWindow(cal, MON)).toEqual({ start: MON + HOUR(9), end: MON + HOUR(18) });
    expect(workingWindow(cal, SAT)).toBeNull();
  });
});

describe("exceções de calendário", () => {
  const holiday: Calendar = {
    ...cal,
    exceptions: [{ date: MON, isWorking: false, name: "Feriado" }],
  };

  it("feriado deixa de ser dia útil", () => {
    expect(isWorkingDay(holiday, MON)).toBe(false);
    expect(isWorkingTime(holiday, MON + HOUR(10))).toBe(false);
    expect(workingWindow(holiday, MON)).toBeNull();
  });

  it("sábado marcado como dia útil especial passa a ser útil", () => {
    const withSaturday: Calendar = {
      ...cal,
      exceptions: [{ date: SAT, isWorking: true, name: "Compensação" }],
    };

    expect(isWorkingDay(withSaturday, SAT)).toBe(true);
    expect(workingWindow(withSaturday, SAT)).toEqual({
      start: SAT + HOUR(9),
      end: SAT + HOUR(18),
    });
    expect(isWorkingTime(withSaturday, SAT + HOUR(10))).toBe(true);
  });

  it("turno especial sobrescreve o padrão no dia da exceção", () => {
    const shortDay: Calendar = {
      ...cal,
      exceptions: [{ date: TUE, isWorking: true, startTime: "08:00", endTime: "12:00" }],
    };

    expect(workingWindow(shortDay, TUE)).toEqual({ start: TUE + HOUR(8), end: TUE + HOUR(12) });
    expect(isWorkingTime(shortDay, TUE + HOUR(13))).toBe(false);
  });

  it("adiando sobre feriado, o tempo útil pula o dia", () => {
    const start = MON + HOUR(9);
    const result = addWorkingTime(holiday, start, HOUR(1));
    // a contagem começa no próximo momento útil e avança 1h
    expect(result).toBe(TUE + HOUR(10));
  });
});

describe("addWorkingTime", () => {
  it("soma dentro do mesmo dia", () => {
    expect(addWorkingTime(cal, MON + HOUR(9), HOUR(4))).toBe(MON + HOUR(13));
    expect(addWorkingTime(cal, MON + HOUR(14), HOUR(3))).toBe(MON + HOUR(17));
  });

  it("transborda para o próximo dia útil", () => {
    // segunda tem 9h úteis (09:00–18:00): 10h terminam às 10:00 de terça
    expect(addWorkingTime(cal, MON + HOUR(9), HOUR(10))).toBe(TUE + HOUR(10));
  });

  it("pula o fim de semana", () => {
    // sexta 17:00 + 2h → 18:00 de sexta (1h) + 1h na segunda às 10:00
    expect(addWorkingTime(cal, FRI + HOUR(17), HOUR(2))).toBe(MON + HOUR(10));
  });

  it("começa do próximo momento útil quando chamado em dia não útil", () => {
    expect(addWorkingTime(cal, SAT + HOUR(12), HOUR(1))).toBe(MON + 7 * DAY_MS + HOUR(10));
    expect(nextWorkingMoment(cal, MON + HOUR(7))).toBe(MON + HOUR(9));
  });
});

describe("subtractWorkingTime", () => {
  it("volta dentro do mesmo dia", () => {
    expect(subtractWorkingTime(cal, MON + HOUR(13), HOUR(4))).toBe(MON + HOUR(9));
  });

  it("transborda para o dia útil anterior", () => {
    // antes das 09:00 de terça não há tempo útil: consome o rabo de segunda
    expect(subtractWorkingTime(cal, TUE + HOUR(9), HOUR(4))).toBe(MON + HOUR(14));
    expect(subtractWorkingTime(cal, TUE + HOUR(9), HOUR(10))).toBe(FRI + HOUR(17));
  });

  it("não passa da meia-noite de calendário sem achar dia útil", () => {
    const noWorkingDays: Calendar = {
      ...cal,
      weeklyMask: 0, // nenhum dia útil pela máscara
      exceptions: [{ date: MON, isWorking: false }],
    };
    // sem nenhum dia útil anterior: permanece no valor informado
    expect(subtractWorkingTime(noWorkingDays, TUE + HOUR(9), HOUR(1))).toBe(TUE + HOUR(9));
  });
});

describe("durationBetween e workingDaysBetween", () => {
  it("conta apenas tempo útil", () => {
    expect(durationBetween(cal, MON + HOUR(9), MON + HOUR(17))).toBe(HOUR(8));
    expect(durationBetween(cal, MON + HOUR(9), TUE + HOUR(13))).toBe(HOUR(9) + HOUR(4));
    expect(durationBetween(cal, SAT, SUN)).toBe(0);
  });

  it("conta dias úteis inclusos", () => {
    expect(workingDaysBetween(cal, MON, TUE)).toBe(2);
    expect(workingDaysBetween(cal, MON, SUN)).toBe(5);
    expect(workingDaysBetween(cal, SAT, SUN)).toBe(0);
    expect(workingDaysBetween(cal, TUE, MON)).toBe(0);
  });
});

describe("propriedades (6.1)", () => {
  const durations = [HOUR(1), HOUR(4), HOUR(9), HOUR(10), HOUR(24), HOUR(40)];

  it("idéia: soma e medição são inversas", () => {
    for (const duration of durations) {
      const from = MON + HOUR(9);
      const to = addWorkingTime(cal, from, duration);
      expect(durationBetween(cal, from, to)).toBe(duration);
    }
  });

  it("idéia: o intervalo subtraído mede a mesma duração", () => {
    for (const duration of durations) {
      const from = TUE + HOUR(9);
      const back = subtractWorkingTime(cal, from, duration);
      expect(durationBetween(cal, back, from)).toBe(duration);
    }
  });

  it("adicionar zero retorna o próximo instante útil", () => {
    expect(addWorkingTime(cal, MON + HOUR(7), 0)).toBe(MON + HOUR(9));
    expect(addWorkingTime(cal, SAT, 0)).toBe(MON + 7 * DAY_MS + HOUR(9));
  });
});
