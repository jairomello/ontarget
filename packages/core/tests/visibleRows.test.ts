import { describe, expect, it } from "bun:test";
import { visibleRows } from "../src/views/visibleRows";

/** Árvore: p > [a > a1, a2], q > [q1] em pré-ordem. */
const order = ["p", "a", "a1", "a2", "q", "q1"];
const parents: Record<string, string | null> = {
  p: null,
  a: "p",
  a1: "a",
  a2: "a",
  q: null,
  q1: "q",
};
const summaries: Record<string, boolean> = {
  p: true,
  a: true,
  a1: false,
  a2: false,
  q: true,
  q1: false,
};

function run(collapsed: Record<string, boolean> = {}) {
  return visibleRows({ order, parents, summaries, collapsed });
}

describe("visibleRows", () => {
  it("devolve todas as linhas com profundidade quando nada está recolhido", () => {
    const rows = run();

    expect(rows.map((row) => `${row.id}:${row.depth}`)).toEqual([
      "p:0",
      "a:1",
      "a1:2",
      "a2:2",
      "q:0",
      "q1:1",
    ]);
    expect(rows.every((row) => row.hidden === 0)).toBe(true);
  });

  it("recolher um nó oculta os descendentes e informa a contagem", () => {
    const rows = run({ a: true });

    expect(rows.map((row) => row.id)).toEqual(["p", "a", "q", "q1"]);
    const a = rows.find((row) => row.id === "a");
    expect(a?.collapsed).toBe(true);
    expect(a?.hidden).toBe(2);
  });

  it("recolher a raiz esconde tudo abaixo", () => {
    const rows = run({ p: true, q: true });
    expect(rows.map((row) => row.id)).toEqual(["p", "q"]);
    expect(rows.find((row) => row.id === "p")?.hidden).toBe(3);
    expect(rows.find((row) => row.id === "q")?.hidden).toBe(1);
  });

  it("nó filho de ancestral recolhido não aparece", () => {
    const rows = run({ p: true });
    expect(rows.map((row) => row.id)).toEqual(["p", "q", "q1"]);
  });

  it("expandir de volta restaura a ordem original", () => {
    const collapsed = run({ a: true });
    expect(collapsed.map((row) => row.id)).toEqual(["p", "a", "q", "q1"]);

    const expanded = run({ a: false });
    expect(expanded.map((row) => row.id)).toEqual(order);
  });

  it("mantém a pré-ordem mesmo com recolhimentos mistos", () => {
    const rows = run({ a: true, q: true });
    expect(rows.map((row) => row.id)).toEqual(["p", "a", "q"]);
  });
});
