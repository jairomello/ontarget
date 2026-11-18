import { describe, expect, it } from "bun:test";
import { FORMULA_MAX_LENGTH, evaluateFormula } from "../src/customfields/formula";

/**
 * Interpretador de fórmulas sem `eval` (specs/custom-fields — "Fórmulas em
 * campos"): avaliação correta e recusa de expressão inválida/proibida.
 */

const HOUR = 3_600_000;
const DAY8 = 8 * HOUR;

function evaluate(expression: string, scope: Record<string, string | number | boolean | null> = {}) {
  return evaluateFormula(expression, scope);
}

describe("avaliação correta", () => {
  it("aritmética com precedência e parênteses", () => {
    expect(evaluate("2 + 3 * 4")).toEqual({ ok: true, value: 14 });
    expect(evaluate("(2 + 3) * 4")).toEqual({ ok: true, value: 20 });
    expect(evaluate("10 - 2 - 3")).toEqual({ ok: true, value: 5 });
    expect(evaluate("7 / 2")).toEqual({ ok: true, value: 3.5 });
    expect(evaluate("-5 + 8")).toEqual({ ok: true, value: 3 });
  });

  it("comparações e lógica", () => {
    expect(evaluate("3 > 2")).toEqual({ ok: true, value: true });
    expect(evaluate("2 >= 2 AND 1 < 2")).toEqual({ ok: true, value: true });
    expect(evaluate("1 > 2 OR 3 = 3")).toEqual({ ok: true, value: true });
    expect(evaluate("NOT (1 = 2)")).toEqual({ ok: true, value: true });
    expect(evaluate('"b" > "a"')).toEqual({ ok: true, value: true });
    expect(evaluate('"abc" <> "xyz"')).toEqual({ ok: true, value: true });
  });

  it("referências de campo e durações literais", () => {
    // 6 dias (48 h) maior que 5 dias (40 h)
    expect(evaluate("[Duração] > 5d", { "Duração": 6 * DAY8 })).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluate("[Duração] > 5d", { "Duração": 3 * DAY8 })).toEqual({
      ok: true,
      value: false,
    });
    expect(evaluate("[Trabalho] + 40h", { "Trabalho": 2 * HOUR })).toEqual({
      ok: true,
      value: 42 * HOUR,
    });
  });

  it("cenário da spec: fórmula condicional IIF", () => {
    const expression = 'IIF([Duração] > 5d, "Longo", "Curto")';

    expect(evaluate(expression, { "Duração": 6 * DAY8 })).toEqual({
      ok: true,
      value: "Longo",
    });
    expect(evaluate(expression, { "Duração": 1 * DAY8 })).toEqual({
      ok: true,
      value: "Curto",
    });
  });

  it("funções predefinidas", () => {
    expect(evaluate("ABS(-42)")).toEqual({ ok: true, value: 42 });
    expect(evaluate("MIN(3, 1, 2)")).toEqual({ ok: true, value: 1 });
    expect(evaluate("MAX(3, 1, 2)")).toEqual({ ok: true, value: 3 });
    expect(evaluate("ROUND(3.14159, 2)")).toEqual({ ok: true, value: 3.14 });
    expect(evaluate("ROUND(2.5)")).toEqual({ ok: true, value: 3 });
    expect(evaluate('CONCAT("Sigla: ", [Nome])', { Nome: "AS" })).toEqual({
      ok: true,
      value: "Sigla: AS",
    });
    expect(evaluate('CONCAT("a", 1, true)')).toEqual({ ok: true, value: "a1true" });
  });

  it("referência inexistente usa null quando presente no scope com null", () => {
    expect(evaluate("[Prioridade]", { Prioridade: null })).toEqual({ ok: true, value: null });
  });
});

describe("recusas — nada é executado", () => {
  it("função inexistente ou externa é rejeitada", () => {
    const unknown = evaluate("foo(1)");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toContain("Função desconhecida");

    // qualquer tentativa de código externo cai na sintaxe/função desconhecida
    const injected = evaluate('constructor.constructor("return 1")()');
    expect(injected.ok).toBe(false);
    const alert = evaluate('ALERT(1)');
    expect(alert.ok).toBe(false);
    const fetch = evaluate('eval("1+1")');
    expect(fetch.ok).toBe(false);
  });

  it("sintaxe inválida é rejeitada com motivo", () => {
    const cases = ["1 +", "((2)", "2 + * 3", '"texto não fechado', "AND 1", "[campo sem fechar"];
    for (const expression of cases) {
      const result = evaluate(expression);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("divisão por zero é recusada", () => {
    const result = evaluate("10 / 0");
    expect(result).toEqual({ ok: false, reason: "Divisão por zero" });
  });

  it("campo desconhecido é recusado com o nome do campo", () => {
    const result = evaluate("[Campo Inexistente] + 1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("[Campo Inexistente]");
  });

  it("expressão vazia é recusada", () => {
    expect(evaluate("   ").ok).toBe(false);
  });

  it("limites de tamanho e profundidade (D9)", () => {
    const long = `${"1 + ".repeat(FORMULA_MAX_LENGTH)}1`;
    expect(evaluate(long).ok).toBe(false);
    if (!evaluate(long).ok) {
      // motivo de tamanho, não de sintaxe
      expect((evaluate(long) as { reason: string }).reason).toContain("muito longa");
    }

    // aninhamento além do limite de profundidade
    let deep = "1";
    for (let index = 0; index < 60; index += 1) deep = `(${deep} + 1)`;
    expect(evaluate(deep).ok).toBe(false);
  });
});
