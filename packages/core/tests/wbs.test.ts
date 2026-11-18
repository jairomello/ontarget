import { describe, expect, it } from "bun:test";
import {
  deleteSubtree,
  indent,
  insertChild,
  insertSibling,
  moveWithinLevel,
  outdent,
  renumber,
  type WbsNode,
} from "../src/wbs/tree";

/**
 * Constrói uma árvore a partir da pré-ordem declarada e aplica a numeração.
 * Formato: `{ id, parent? }` — ausência de `parent` significa raiz.
 */
function build(defs: Array<{ id: string; parent?: string }>): WbsNode[] {
  const nodes: WbsNode[] = defs.map((def, index) => ({
    id: def.id,
    parentId: def.parent ?? null,
    sortOrder: index,
    outlineLevel: 0,
    outlineNumber: "",
  }));
  return renumber(nodes);
}

/** Formato compacto para asserções: `id(nível/número)`. */
function shape(nodes: WbsNode[]): string[] {
  return nodes.map((node) => `${node.id}[${node.outlineLevel}/${node.outlineNumber}]`);
}

describe("invariantes de árvore (core/wbs)", () => {
  it("renumber atribui nível e numeração WBS em pré-ordem", () => {
    const nodes = build([
      { id: "p" },
      { id: "a", parent: "p" },
      { id: "a1", parent: "a" },
      { id: "a2", parent: "a" },
      { id: "q" },
      { id: "q1", parent: "q" },
    ]);

    expect(shape(nodes)).toEqual([
      "p[0/1]",
      "a[1/1.1]",
      "a1[2/1.1.1]",
      "a2[2/1.1.2]",
      "q[0/2]",
      "q1[1/2.1]",
    ]);
  });

  it("indenta um bloco preservando a ordem relativa", () => {
    const base = build([
      { id: "p" },
      { id: "ref", parent: "p" },
      { id: "t1", parent: "p" },
      { id: "t2", parent: "p" },
      { id: "t3", parent: "p" },
      { id: "t4", parent: "p" },
      { id: "t5", parent: "p" },
      { id: "q" },
    ]);

    const result = indent(base, ["t1", "t2", "t3", "t4", "t5"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(shape(result.nodes)).toEqual([
      "p[0/1]",
      "ref[1/1.1]",
      "t1[2/1.1.1]",
      "t2[2/1.1.2]",
      "t3[2/1.1.3]",
      "t4[2/1.1.4]",
      "t5[2/1.1.5]",
      "q[0/2]",
    ]);
    expect(result.changed).toHaveLength(5);
  });

  it("bloqueia indentação sem irmão anterior", () => {
    const base = build([{ id: "a" }, { id: "b" }]);
    const result = indent(base, ["a"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("no-previous-sibling");
    // nada muda na estrutura
    expect(shape(base)).toEqual(["a[0/1]", "b[0/2]"]);
  });

  it("bloqueia outdent na raiz", () => {
    const base = build([{ id: "a" }, { id: "a1", parent: "a" }]);
    const result = outdent(base, ["a"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("root-level");
  });

  it("indenta e depois outenta restaurando a estrutura original", () => {
    const base = build([
      { id: "p" },
      { id: "ref", parent: "p" },
      { id: "t1", parent: "p" },
      { id: "t2", parent: "p" },
    ]);

    const indented = indent(base, ["t1", "t2"]);
    expect(indented.ok).toBe(true);
    if (!indented.ok) return;

    const back = outdent(indented.nodes, ["t1", "t2"]);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    expect(shape(back.nodes)).toEqual(shape(base));
  });

  it("nó cujo pai também se move acompanha o pai sem reancorar", () => {
    const base = build([
      { id: "p" },
      { id: "ref", parent: "p" },
      { id: "a", parent: "p" },
      { id: "a1", parent: "a" },
    ]);

    const result = indent(base, ["a"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(shape(result.nodes)).toEqual([
      "p[0/1]",
      "ref[1/1.1]",
      "a[2/1.1.1]",
      "a1[3/1.1.1.1]",
    ]);
    // apenas o nó reancorado conta como alterado
    expect(result.changed).toEqual(["a"]);
  });

  it("moveWithinLevel troca a posição mantendo a subárvore", () => {
    const base = build([
      { id: "p" },
      { id: "a", parent: "p" },
      { id: "a1", parent: "a" },
      { id: "b", parent: "p" },
      { id: "b1", parent: "b" },
    ]);

    const up = moveWithinLevel(base, "b", "up");
    expect(up.ok).toBe(true);
    if (!up.ok) return;

    expect(shape(up.nodes)).toEqual([
      "p[0/1]",
      "b[1/1.1]",
      "b1[2/1.1.1]",
      "a[1/1.2]",
      "a1[2/1.2.1]",
    ]);

    // já no topo: nada muda
    const again = moveWithinLevel(up.nodes, "b", "up");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(shape(again.nodes)).toEqual(shape(up.nodes));
  });

  it("insere irmão acima e abaixo com numeração correta", () => {
    const base = build([{ id: "p" }, { id: "a", parent: "p" }, { id: "b", parent: "p" }]);

    const above = insertSibling(base, "a", "above", "novo");
    expect(above.ok).toBe(true);
    if (!above.ok) return;
    expect(above.outlineNumber).toBe("1.1");
    expect(above.parentId).toBe("p");

    const below = insertSibling(base, "b", "below", "novo");
    expect(below.ok).toBe(true);
    if (!below.ok) return;
    expect(below.outlineNumber).toBe("1.3");
  });

  it("insere filho em um resumo", () => {
    const base = build([{ id: "p" }, { id: "a", parent: "p" }]);
    const result = insertChild(base, "p", "novo");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outlineLevel).toBe(1);
    expect(result.outlineNumber).toBe("1.2");
  });

  it("exclui subárvore ou promove os filhos", () => {
    const base = build([
      { id: "p" },
      { id: "a", parent: "p" },
      { id: "a1", parent: "a" },
      { id: "b", parent: "p" },
    ]);

    const removed = deleteSubtree(base, ["a"], "delete-children");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.removed.sort()).toEqual(["a", "a1"]);
    expect(shape(removed.nodes)).toEqual(["p[0/1]", "b[1/1.1]"]);

    const promoted = deleteSubtree(base, ["a"], "promote-children");
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.removed).toEqual(["a"]);
    expect(shape(promoted.nodes)).toEqual(["p[0/1]", "a1[1/1.1]", "b[1/1.2]"]);
  });

  it("rejeita ids inexistentes", () => {
    const base = build([{ id: "a" }]);
    const result = indent(base, ["fantasma"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not-found");
  });
});
