import { describe, expect, it } from "bun:test";
import {
  EMPTY_FILTER,
  combineFlags,
  flattenGroups,
  groupTasks,
  isFilterActive,
  matchesCondition,
  matchesFilter,
  sortOrder,
  type FieldValues,
  type FilterSpec,
} from "../src/views/query";

/**
 * Consultas de visão (tarefa 9.3; specs/views-and-filters): combinadores
 * E/OU dos filtros, estado vazio, ordenação múltipla com hierarquia
 * preservada e agrupamento com contagem e sumário.
 */

const HOUR = 3_600_000;

function filter(partial: Partial<FilterSpec>): FilterSpec {
  return { ...EMPTY_FILTER, ...partial };
}

/* --------------------------------------------------------------- filtros */

describe("combinadores E/OU", () => {
  const values: FieldValues = { name: "Implementar API", duration: 8 * HOUR, percent: 100 };

  it("E: só satisfaz quem satisfaz todas as condições", () => {
    const both = filter({
      combinator: "and",
      conditions: [
        { field: "name", operator: "contains", value: "api" },
        { field: "duration", operator: "gt", value: String(4 * HOUR) },
      ],
    });
    const one = filter({
      combinator: "and",
      conditions: [
        { field: "name", operator: "contains", value: "api" },
        { field: "duration", operator: "gt", value: String(40 * HOUR) },
      ],
    });

    expect(matchesFilter(both, values)).toBe(true);
    expect(matchesFilter(one, values)).toBe(false);
  });

  it("OU: basta satisfazer uma condição", () => {
    const any = filter({
      combinator: "or",
      conditions: [
        { field: "name", operator: "contains", value: "api" },
        { field: "duration", operator: "gt", value: String(40 * HOUR) },
      ],
    });
    const none = filter({
      combinator: "or",
      conditions: [
        { field: "name", operator: "contains", value: "docs" },
        { field: "duration", operator: "gt", value: String(40 * HOUR) },
      ],
    });

    expect(matchesFilter(any, values)).toBe(true);
    expect(matchesFilter(none, values)).toBe(false);
  });

  it("filtro vazio deixa tudo passar", () => {
    expect(combineFlags([], "and")).toBe(true);
    expect(combineFlags([], "or")).toBe(true);
    expect(matchesFilter(EMPTY_FILTER, values)).toBe(true);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive(filter({ combinator: "or", conditions: [{ field: "a", operator: "eq", value: "1" }] }))).toBe(true);
  });

  it("estado vazio: nenhuma tarefa satisfaz → nenhum passa", () => {
    const impossible = filter({
      combinator: "and",
      conditions: [{ field: "duration", operator: "gt", value: String(1000 * HOUR) }],
    });
    const tasks: FieldValues[] = [
      { duration: 8 * HOUR },
      { duration: 40 * HOUR },
      { duration: null },
    ];

    const visible = tasks.filter((task) => matchesFilter(impossible, task));
    expect(visible).toEqual([]);
  });

  it("operadores: contains sem diferenciar maiúsculas, vazios e numéricos", () => {
    expect(
      matchesCondition({ field: "name", operator: "contains", value: "api" }, values),
    ).toBe(true);
    expect(
      matchesCondition({ field: "name", operator: "notContains", value: "docs" }, values),
    ).toBe(true);
    expect(matchesCondition({ field: "name", operator: "eq", value: "implementar api" }, values)).toBe(true);
    expect(matchesCondition({ field: "percent", operator: "gte", value: "100" }, values)).toBe(true);
    expect(matchesCondition({ field: "percent", operator: "lt", value: "100" }, values)).toBe(false);
    expect(matchesCondition({ field: "name", operator: "isEmpty" }, values)).toBe(false);
    expect(matchesCondition({ field: "name", operator: "isNotEmpty" }, values)).toBe(true);
    expect(matchesCondition({ field: "notes", operator: "isEmpty" }, { notes: null })).toBe(true);
  });
});

/* ------------------------------------------------------------ ordenação */

describe("sortOrder", () => {
  const order = ["root", "child1", "child2", "other", "sub1"];
  const parents: Record<string, string | null> = {
    root: null,
    child1: "root",
    child2: "root",
    other: null,
    sub1: "other",
  };
  const values: Record<string, FieldValues> = {
    root: { duration: 10 },
    child1: { duration: 8 },
    child2: { duration: 2 },
    other: { duration: 5 },
    sub1: { duration: 1 },
  };

  it("sem ordenação devolve a ordem original", () => {
    expect(sortOrder(order, values, [], true, parents)).toEqual(order);
  });

  it("hierarquia preservada: só os irmãos são reordenados", () => {
    const sorted = sortOrder(
      order,
      values,
      [{ field: "duration", direction: "asc" }],
      true,
      parents,
    );

    // raízes em ordem asc (other=5, root=10); cada resumo é emitido antes
    // das suas subtarefas, e os irmãos entre si ficam reordenados
    expect(sorted).toEqual(["other", "sub1", "root", "child2", "child1"]);
  });

  it("desc inverte a comparação entre irmãos", () => {
    const sorted = sortOrder(
      order,
      values,
      [{ field: "duration", direction: "desc" }],
      true,
      parents,
    );
    // raízes desc: root (10) antes de other (5); filhos de root desc: 8, 2
    expect(sorted[0]).toBe("root");
    expect(sorted[1]).toBe("child1"); // filhos de root desc: 8 antes de 2
    expect(sorted[2]).toBe("child2");
  });

  it("ordenação múltipla: desempata pelo segundo campo", () => {
    const multi: Record<string, FieldValues> = {
      a: { name: "Beta", duration: 5 },
      b: { name: "Alfa", duration: 5 },
      c: { name: "Gama", duration: 1 },
    };
    const sorted = sortOrder(
      ["a", "b", "c"],
      multi,
      [
        { field: "duration", direction: "asc" },
        { field: "name", direction: "asc" },
      ],
      false,
      {},
    );
    expect(sorted).toEqual(["c", "b", "a"]); // 1d; depois 5d alfabético: Alfa, Beta
  });
});

/* ------------------------------------------------------------ agrupamento */

describe("groupTasks", () => {
  const ids = ["t1", "t2", "t3"];
  const values: Record<string, FieldValues> = {
    t1: { res: "Ana", work: 8 * HOUR, duration: 8 * HOUR, cost: 100 },
    t2: { res: "Ana", work: 4 * HOUR, duration: 4 * HOUR, cost: 50 },
    t3: { res: "Bia", work: 8 * HOUR, duration: 8 * HOUR, cost: 0 },
  };

  it("agrupa por recurso com contagem e soma de trabalho", () => {
    const groups = groupTasks(ids, ["res"], values);

    expect(groups.map((group) => group.label)).toEqual(["Ana", "Bia"]);
    expect(groups[0]!.summary).toEqual({
      count: 2,
      work: 12 * HOUR,
      duration: 12 * HOUR,
      cost: 150,
    });
    expect(groups[1]!.summary.count).toBe(1);
    expect(groups[0]!.rowIds).toEqual(["t1", "t2"]);
  });

  it("sem valor vira o grupo '(sem valor)'", () => {
    const groups = groupTasks(["t3"], ["res"], { t3: { res: null } });
    expect(groups[0]!.label).toBe("(sem valor)");
  });

  it("agrupamento por dois campos cria subgrupos com sumário agregado", () => {
    const groups = groupTasks(
      ids,
      ["res", "cost"],
      {
        t1: { res: "Ana", cost: 100, work: 8 * HOUR, duration: 8 * HOUR },
        t2: { res: "Ana", cost: 100, work: 4 * HOUR, duration: 4 * HOUR },
        t3: { res: "Bia", cost: 0, work: 8 * HOUR, duration: 8 * HOUR },
      },
    );

    const ana = groups.find((group) => group.key === "Ana")!;
    expect(ana.children).toHaveLength(1);
    expect(ana.children[0]!.key).toBe("100");
    expect(ana.children[0]!.rowIds).toEqual(["t1", "t2"]);
    expect(ana.rowIds).toEqual([]); // com subgrupos, as tarefas ficam nas folhas
    expect(ana.summary).toEqual({
      count: 2,
      work: 12 * HOUR,
      duration: 12 * HOUR,
      cost: 200,
    });
  });

  it("flattenGroups emite cabeçalho e tarefas na ordem", () => {
    const flat = flattenGroups(groupTasks(ids, ["res"], values));
    expect(flat.map((entry) => (entry.kind === "header" ? `H:${entry.group.label}` : entry.id))).toEqual([
      "H:Ana",
      "t1",
      "t2",
      "H:Bia",
      "t3",
    ]);
  });
});
