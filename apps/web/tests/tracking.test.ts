import { describe, expect, it } from "bun:test";
import {
  deviationText,
  formatSignedCost,
  formatSignedDays,
  projectFinishDeviation,
  resolveSelectedBaseline,
} from "../src/features/shared/tracking";
import type { Baseline, BaselineValue, Task } from "../src/store/types";
import { makeTask } from "./helpers/task";

/**
 * Tracking Gantt (specs/tracking — "Valores de desvio por baseline"):
 * formatadores com sinal, desvio por tarefa e acumulado do projeto.
 */

const DAY = 86_400_000;
const HOUR = 60 * 60 * 1000;

function baseline(id: string, savedAt: number, kind = "baseline"): Baseline {
  return { id, projectId: "p1", name: `B ${id}`, kind, savedAt, scope: "project" };
}

function value(
  baselineId: string,
  taskId: string,
  patch: Partial<BaselineValue> = {},
): BaselineValue {
  return {
    baselineId,
    taskId,
    start: Date.UTC(2026, 0, 5),
    finish: Date.UTC(2026, 0, 5),
    duration: 8 * HOUR,
    work: null,
    cost: 0,
    ...patch,
  };
}

function task(patch: Partial<Task> = {}): Task {
  return {
    ...makeTask("t1", "Tarefa"),
    start: Date.UTC(2026, 0, 5),
    finish: Date.UTC(2026, 0, 5),
    duration: 8 * HOUR,
    cost: 0,
    ...patch,
  } as Task;
}

describe("formatadores de desvio", () => {
  it("dias com sinal e vírgula decimal", () => {
    expect(formatSignedDays(2)).toBe("+2d");
    expect(formatSignedDays(-1)).toBe("-1d");
    expect(formatSignedDays(0)).toBe("0d");
    expect(formatSignedDays(1.5)).toBe("+1,5d");
  });

  it("custo em pt-BR com sinal", () => {
    expect(formatSignedCost(1200)).toBe("+R$ 1.200,00");
    expect(formatSignedCost(-300)).toBe("-R$ 300,00");
    expect(formatSignedCost(0)).toBe("R$ 0,00");
  });
});

describe("deviationValue / deviationText", () => {
  const b = baseline("b1", 1);

  it("dias corridos para início e término", () => {
    const current = task({ start: Date.UTC(2026, 0, 7), finish: Date.UTC(2026, 0, 9) });
    const values = { t1: value("b1", "t1") }; // início e fim na segunda

    expect(deviationText("devStart", current, b, values)).toBe("+2d");
    expect(deviationText("devFinish", current, b, values)).toBe("+4d");
  });

  it("duração em dias de 8 h e custo em reais", () => {
    const current = task({ duration: 3 * 8 * HOUR, cost: 250 });
    const values = { t1: value("b1", "t1", { cost: 100 }) };

    expect(deviationText("devDuration", current, b, values)).toBe("+2d");
    expect(deviationText("devCost", current, b, values)).toBe("+R$ 150,00");
  });

  it("sem linha na baseline selecionada devolve travessão", () => {
    expect(deviationText("devStart", task(), b, {})).toBe("—");
    expect(deviationText("devStart", task(), null, {})).toBe("—");
  });
});

describe("resolveSelectedBaseline", () => {
  it("usa a escolhida pelo usuário ou a mais recente", () => {
    const older = baseline("old", 100);
    const newer = baseline("new", 200);
    const values = { new: { t1: value("new", "t1") } };

    expect(resolveSelectedBaseline({ old: older, new: newer }, values, null).baseline?.id).toBe(
      "new",
    );
    expect(resolveSelectedBaseline({ old: older, new: newer }, values, "old").baseline?.id).toBe(
      "old",
    );
    expect(resolveSelectedBaseline({}, {}, null)).toEqual({ baseline: null, values: {} });
  });
});

describe("projectFinishDeviation (acumulado do projeto)", () => {
  it("maior término atual menos maior término da baseline", () => {
    const tasks: Record<string, Task> = {
      a: task({ id: "a", finish: Date.UTC(2026, 0, 9) }),
      b: task({ id: "b", finish: Date.UTC(2026, 0, 6) }),
    };
    const values = {
      a: value("b1", "a", { finish: Date.UTC(2026, 0, 7) }),
      b: value("b1", "b", { finish: Date.UTC(2026, 0, 5) }),
    };

    // maior atual (09/01) − maior baseline (07/01) = +2 dias
    expect(projectFinishDeviation(tasks, values)).toBe(2);
  });

  it("sem valores devolve null", () => {
    expect(projectFinishDeviation({ a: task({ id: "a" }) }, {})).toBeNull();
  });
});
