import { describe, expect, it } from "bun:test";
import { HOUR_MS } from "../src/calendar/calendar";
import { assignmentCost, assignmentWork } from "../src/resources/assignments";

/**
 * Cálculos por unidade e por taxa (tarefa 7.4; specs/resources — "Cálculo de
 * trabalho e custo").
 */

const HOUR = HOUR_MS;
const DAY5 = 40 * HOUR; // tarefa de 5 dias (8h) — cenário da spec

describe("assignmentWork (duração × unidades)", () => {
  it("100% de unidades mantém a duração", () => {
    expect(assignmentWork(DAY5, 1)).toBe(DAY5);
  });

  it("50% de unidades reduz o trabalho pela metade", () => {
    expect(assignmentWork(DAY5, 0.5)).toBe(DAY5 / 2);
  });

  it("200% de unidades dobra o trabalho", () => {
    expect(assignmentWork(DAY5, 2)).toBe(DAY5 * 2);
  });

  it("entradas sem duração ou unidades zeradas devolvem zero", () => {
    expect(assignmentWork(0, 1)).toBe(0);
    expect(assignmentWork(DAY5, 0)).toBe(0);
    expect(assignmentWork(-5, 1)).toBe(0);
  });
});

describe("assignmentCost (trabalho × taxa)", () => {
  it("converte o trabalho em horas e aplica a taxa", () => {
    expect(assignmentCost(DAY5, 100)).toBe(4000); // 40 h × R$ 100/h
    expect(assignmentCost(4 * HOUR, 120.5)).toBeCloseTo(482, 6);
  });

  it("sem trabalho ou sem taxa devolve zero", () => {
    expect(assignmentCost(0, 100)).toBe(0);
    expect(assignmentCost(DAY5, 0)).toBe(0);
  });

  it("duas pessoas somam trabalho e usam a taxa de cada uma (cenário da spec)", () => {
    // tarefa de 5 dias com 100% e 50% de unidades
    const anaWork = assignmentWork(DAY5, 1);
    const biaWork = assignmentWork(DAY5, 0.5);
    const anaCost = assignmentCost(anaWork, 100);
    const biaCost = assignmentCost(biaWork, 150);

    expect(anaWork).toBe(40 * HOUR);
    expect(biaWork).toBe(20 * HOUR);
    expect(anaCost).toBe(4000);
    expect(biaCost).toBe(3000);
    // roll-up: o trabalho soma as contribuições e o custo usa a taxa de cada
    expect(anaWork + biaWork).toBe(60 * HOUR);
    expect(anaCost + biaCost).toBe(7000);
  });
});
