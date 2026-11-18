import { describe, expect, it } from "bun:test";
import {
  UNIT_MS,
  WORKDAY_MS,
  formatDateInput,
  formatDurationMs,
  parseDate,
  parseDuration,
  parseNumber,
  parsePercent,
} from "../src/values/parse";

describe("parseDuration", () => {
  it("interpreta unidades em português e abreviações", () => {
    expect(parseDuration("3d")?.ms).toBe(3 * UNIT_MS.day);
    expect(parseDuration("2 semanas")?.ms).toBe(2 * UNIT_MS.week);
    expect(parseDuration("40h")?.ms).toBe(40 * UNIT_MS.hour);
    expect(parseDuration("30 min")?.ms).toBe(30 * UNIT_MS.minute);
    expect(parseDuration("1 mês")?.ms).toBe(UNIT_MS.month);
  });

  it("aceita vírgula decimal e número puro (dia por padrão)", () => {
    expect(parseDuration("0,5d")?.ms).toBe(0.5 * UNIT_MS.day);
    expect(parseDuration("1,5")?.ms).toBe(1.5 * UNIT_MS.day);
    expect(parseDuration("2")?.ms).toBe(2 * UNIT_MS.day);
  });

  it("rejeita entradas inválidas", () => {
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("3 xyz")).toBeNull();
    expect(parseDuration("d3")).toBeNull();
  });

  it("formata de volta para a forma curta", () => {
    expect(formatDurationMs(3 * WORKDAY_MS)).toBe("3d");
    expect(formatDurationMs(4 * UNIT_MS.hour)).toBe("4h");
    expect(formatDurationMs(0)).toBe("0d");
    expect(formatDurationMs(0.5 * WORKDAY_MS)).toBe("4h");
    expect(formatDurationMs(90 * UNIT_MS.minute)).toBe("90min");
  });
});

describe("parsePercent", () => {
  it("aceita 50, 50% e formato fracionário", () => {
    expect(parsePercent("50")).toBe(50);
    expect(parsePercent("50%")).toBe(50);
    expect(parsePercent("0,5")).toBe(50);
    expect(parsePercent("100")).toBe(100);
  });

  it("rejeita fora da faixa ou inválido", () => {
    expect(parsePercent("101")).toBeNull();
    expect(parsePercent("-5")).toBeNull();
    expect(parsePercent("xyz")).toBeNull();
    expect(parsePercent("")).toBeNull();
  });
});

describe("parseNumber", () => {
  it("aceita separadores pt-BR e en-US", () => {
    expect(parseNumber("1234,56")).toBe(1234.56);
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1234.56")).toBe(1234.56);
    expect(parseNumber("42")).toBe(42);
    expect(parseNumber("")).toBeNull();
  });
});

describe("parseDate", () => {
  const reference = Date.UTC(2026, 10, 13); // 13/11/2026

  it("interpreta datas absolutas em pt-BR", () => {
    expect(parseDate("13/11/2026", reference)).toBe(Date.UTC(2026, 10, 13));
    expect(parseDate("13/11", reference)).toBe(Date.UTC(2026, 10, 13));
    expect(parseDate("01/01/2027", reference)).toBe(Date.UTC(2027, 0, 1));
  });

  it("interpreta datas relativas e palavras", () => {
    expect(parseDate("+2d", reference)).toBe(Date.UTC(2026, 10, 15));
    expect(parseDate("-1 dia", reference)).toBe(Date.UTC(2026, 10, 12));
    expect(parseDate("+1 semana", reference)).toBe(Date.UTC(2026, 10, 20));
    expect(parseDate("hoje", reference)).toBe(Date.UTC(2026, 10, 13));
    expect(parseDate("amanhã", reference)).toBe(Date.UTC(2026, 10, 14));
  });

  it("rejeita datas inexistentes", () => {
    expect(parseDate("31/02/2026", reference)).toBeNull();
    expect(parseDate("13/13/2026", reference)).toBeNull();
    expect(parseDate("qualquer coisa", reference)).toBeNull();
  });

  it("formata de volta para dd/MM/yyyy", () => {
    expect(formatDateInput(Date.UTC(2026, 10, 13))).toBe("13/11/2026");
    expect(formatDateInput(Date.UTC(2027, 0, 5))).toBe("05/01/2027");
  });
});
