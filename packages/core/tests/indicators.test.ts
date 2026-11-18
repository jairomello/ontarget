import { describe, expect, it } from "bun:test";
import {
  evaluateIndicator,
  parseIndicatorRules,
  type IndicatorRule,
} from "../src/customfields/indicators";
import { formatWbsCode, validateCustomCode, wbsPath } from "../src/wbs/codes";

/**
 * Indicadores gráficos e códigos de estrutura (tarefa 9.2; specs/custom-fields):
 * prioridade de regra, estado sem correspondência e detecção de duplicidade.
 */

const rule = (patch: Partial<IndicatorRule>): IndicatorRule => ({
  icon: "⚠",
  priority: 1,
  operator: "gt",
  value: 0,
  ...patch,
});

describe("evaluateIndicator (prioridade de regra)", () => {
  it("com duas regras atendidas, prevalece a de maior prioridade", () => {
    const rules: IndicatorRule[] = [
      rule({ icon: "⚠", priority: 1, operator: "gt", value: 5 }),
      rule({ icon: "🚨", priority: 5, operator: "gt", value: 5 }),
    ];

    // independente da ordem no array, a prioridade 5 vence
    expect(evaluateIndicator(rules, 10)).toBe("🚨");
    expect(evaluateIndicator([...rules].reverse(), 10)).toBe("🚨");
  });

  it("só a regra atendida é exibida", () => {
    const rules: IndicatorRule[] = [
      rule({ icon: "⚠", priority: 9, operator: "gt", value: 100 }),
      rule({ icon: "✓", priority: 1, operator: "lt", value: 100 }),
    ];

    expect(evaluateIndicator(rules, 50)).toBe("✓");
  });

  it("sem correspondência devolve null (estado sem indicador)", () => {
    const rules = [rule({ icon: "⚠", priority: 1, operator: "gt", value: 10 })];
    expect(evaluateIndicator(rules, 5)).toBeNull();
    expect(evaluateIndicator(rules, null)).toBeNull();
    expect(evaluateIndicator([], "qualquer")).toBeNull();
  });

  it("operações numéricas, de texto e contains", () => {
    expect(evaluateIndicator([rule({ operator: "eq", value: 3 })], 3)).toBe("⚠");
    expect(evaluateIndicator([rule({ operator: "eq", value: 3 })], 4)).toBeNull();
    expect(evaluateIndicator([rule({ operator: "lte", value: 0 })], -2)).toBe("⚠");
    expect(
      evaluateIndicator([rule({ operator: "eq", value: "alta" })], "Alta"),
    ).toBe("⚠");
    expect(
      evaluateIndicator([rule({ operator: "contains", value: "URG" })], "URGENTE hoje"),
    ).toBe("⚠");
    expect(evaluateIndicator([rule({ operator: "neq", value: "" })], "x")).toBe("⚠");
  });
});

describe("parseIndicatorRules", () => {
  it("descarta entradas inválidas e JSON quebrado", () => {
    const rules = parseIndicatorRules(
      JSON.stringify([
        { icon: "⚠", priority: 2, operator: "gt", value: 1 },
        { icon: "", priority: 1, operator: "gt", value: 1 }, // sem ícone
        { icon: "x", priority: 1, operator: "explode", value: 1 }, // operador inválido
        { icon: "y", priority: "alta", operator: "gt", value: 1 }, // prioridade inválida
        { outro: "formato" }, // entrada em formato errado
      ]),
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ icon: "⚠", priority: 2 });
    expect(parseIndicatorRules("não é json")).toEqual([]);
    expect(parseIndicatorRules(null)).toEqual([]);
    expect(parseIndicatorRules('{"não":"array"}')).toEqual([]);
  });
});

describe("formatWbsCode (máscara)", () => {
  it("máscara da spec: A.00.00.00", () => {
    expect(formatWbsCode("A.00.00.00", [1])).toBe("A");
    expect(formatWbsCode("A.00.00.00", [1, 2])).toBe("A.02");
    expect(formatWbsCode("A.00.00.00", [2, 10, 3])).toBe("B.10.03");
    expect(formatWbsCode("A.00.00.00", [27])).toBe("AA");
  });

  it("numérica, literal e níveis além dos segmentos", () => {
    expect(formatWbsCode("00.00", [3, 5])).toBe("03.05");
    expect(formatWbsCode("FASE.00", [2, 1])).toBe("FASE.01");
    // níveis extras reutilizam o último segmento
    expect(formatWbsCode("A.00", [1, 2, 3])).toBe("A.02.03");
  });

  it("wbsPath converte o número WBS em níveis", () => {
    expect(wbsPath("1.2.3")).toEqual([1, 2, 3]);
    expect(wbsPath("10")).toEqual([10]);
    expect(wbsPath("abc")).toEqual([]);
  });
});

describe("validateCustomCode (duplicidade)", () => {
  const tasks = [
    { id: "t1", wbsCode: "X-100", outlineNumber: "1" },
    { id: "t2", wbsCode: null, outlineNumber: "2" },
    { id: "t3", wbsCode: null, outlineNumber: "3" },
  ];

  it("recusa código já usado por outra tarefa", () => {
    const byCustom = validateCustomCode("X-100", tasks, "t3");
    expect(byCustom.ok).toBe(false);
    if (!byCustom.ok) expect(byCustom.reason).toContain("já usado");

    // também colide com um número WBS gerado
    const byGenerated = validateCustomCode("2", tasks, "t3");
    expect(byGenerated.ok).toBe(false);
  });

  it("permite reusar o próprio código ao editar a mesma tarefa", () => {
    expect(validateCustomCode("X-100", tasks, "t1").ok).toBe(true);
    expect(validateCustomCode("NOVO", tasks, "t1").ok).toBe(true);
  });

  it("recusa código vazio", () => {
    expect(validateCustomCode("   ", tasks, "t1").ok).toBe(false);
  });
});
