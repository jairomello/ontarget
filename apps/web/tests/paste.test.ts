import { describe, expect, it } from "bun:test";
import { COLUMNS } from "../src/features/tasksheet/columns";
import { parseTsv, planPaste } from "../src/features/tasksheet/paste";
import { makeTask } from "./helpers/task";

const EDITABLE = COLUMNS.filter(
  (column) => column.type && column.apply && column.key !== "wbs",
);
const LABELS = EDITABLE.map((column) => column.label);

function plan(lines: string[][], anchorIndex = 0) {
  const anchor = makeTask("anchor", "Âncora", { sortOrder: anchorIndex });
  return planPaste({
    projectId: "p1",
    lines,
    anchor,
    anchorIndex,
    columns: EDITABLE,
    labels: LABELS,
  });
}

describe("parseTsv", () => {
  it("divide linhas e células, ignorando a linha final vazia", () => {
    expect(parseTsv("a\tb\nc\td\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("aceita quebras de linha Windows e aspas do Excel", () => {
    expect(parseTsv('Nome\tInício\r\n"Tarefa com\ttab"\t10/11/2026\r\n')).toEqual([
      ["Nome", "Início"],
      ["Tarefa com\ttab", "10/11/2026"],
    ]);
  });

  it("descarta linhas em branco do final", () => {
    expect(parseTsv("   \n  ")).toEqual([]);
    expect(parseTsv("a\n\n")).toEqual([["a"]]);
  });
});

describe("planPaste (4.3)", () => {
  it("uma linha atualiza a tarefa âncora", () => {
    const result = plan([["Renomeada", "10/11/2026", "13/11/2026", "3d", "50%"]]);

    expect(result.creates).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.id).toBe("anchor");
    expect(result.updates[0]?.patch.name).toBe("Renomeada");
    expect(result.updates[0]?.patch.start).toBe(Date.UTC(2026, 10, 10));
    expect(result.updates[0]?.patch.duration).toBe(3 * 8 * 60 * 60 * 1000);
    expect(result.updates[0]?.patch.percentComplete).toBe(50);
  });

  it("dez linhas criam dez tarefas novas após a âncora", () => {
    const lines = Array.from({ length: 10 }, (_, index) => [`Tarefa ${index + 1}`]);
    const result = plan(lines, 4);

    expect(result.creates).toHaveLength(10);
    expect(result.updates).toHaveLength(0);
    expect(result.creates.map((task) => task.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Tarefa ${index + 1}`),
    );
    // posição: logo após a âncora (índice 4), em ordem
    expect(result.creates.map((task) => task.sortOrder)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("reconhece e descarta o cabeçalho colado do Excel", () => {
    const lines = [
      ["Nome da tarefa", "Início", "Término", "Duração", "%"],
      ["Com cabeçalho", "", "", "2d", ""],
      ["Segunda", "", "", "", ""],
    ];
    const result = plan(lines);

    expect(result.creates).toHaveLength(2);
    expect(result.creates[0]?.name).toBe("Com cabeçalho");
    expect(result.creates[0]?.duration).toBe(2 * 8 * 60 * 60 * 1000);
    expect(result.creates[1]?.name).toBe("Segunda");
  });

  it("ignora células inválidas sem descartar a linha", () => {
    const result = plan([["Tarefa boa", "data-invalida", "", "7d"]]);

    expect(result.updates[0]?.patch.name).toBe("Tarefa boa");
    expect(result.updates[0]?.patch.start).toBeUndefined();
    expect(result.updates[0]?.patch.duration).toBe(7 * 8 * 60 * 60 * 1000);
  });

  it("linha em branco não gera tarefa", () => {
    const result = plan([[""], ["   "], ["Única"]]);
    expect(result.creates).toHaveLength(1);
    expect(result.creates[0]?.name).toBe("Única");
  });

  it("sem conteúdo retorna plano vazio", () => {
    expect(plan([[]])).toEqual({ updates: [], creates: [] });
  });
});
