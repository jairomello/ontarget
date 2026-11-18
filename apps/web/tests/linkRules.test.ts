import { beforeEach, describe, expect, it } from "bun:test";
import { resetDirtyListeners } from "../src/store/dirty";
import { useDomainStore, type DomainState } from "../src/store/domainStore";
import { useHistoryStore } from "../src/store/historyStore";
import { useUiStore } from "../src/store/uiStore";
import type { ProjectData } from "../src/store/types";
import { canLink, isDescendant, reaches } from "../src/features/gantt/linkRules";
import { makeTask } from "./helpers/task";

/**
 * Árvore:
 *   A > A1 > A1a
 *   B
 *   C
 */
function loadGraph(): void {
  const data: ProjectData = {
    tasks: [
      makeTask("A", "A", { sortOrder: 0, outlineNumber: "1" }),
      makeTask("A1", "A1", { parentId: "A", outlineLevel: 1, outlineNumber: "1.1", sortOrder: 1 }),
      makeTask("A1a", "A1a", { parentId: "A1", outlineLevel: 2, outlineNumber: "1.1.1", sortOrder: 2 }),
      makeTask("B", "B", { sortOrder: 3, outlineNumber: "2" }),
      makeTask("C", "C", { sortOrder: 4, outlineNumber: "3" }),
    ],
    taskLinks: [],
    resources: [],
    assignments: [],
  };
  useDomainStore.getState().load("p1", data);
}

const state = () => useDomainStore.getState() as DomainState;

beforeEach(() => {
  resetDirtyListeners();
  useHistoryStore.getState().clear();
  useUiStore.getState().clearSelection();
  loadGraph();
});

describe("canLink (5.4)", () => {
  it("aceita vínculo entre tarefas irmãs", () => {
    expect(canLink(state(), "B", "C")).toEqual({ ok: true });
  });

  it("recusa autovínculo", () => {
    expect(canLink(state(), "B", "B")).toEqual({ ok: false, reason: "self" });
  });

  it("recusa vínculo para descendente", () => {
    expect(canLink(state(), "A", "A1")).toEqual({ ok: false, reason: "descendant" });
    expect(canLink(state(), "A", "A1a")).toEqual({ ok: false, reason: "descendant" });
  });

  it("aceita vínculo de ascendente para fora da subárvore", () => {
    expect(canLink(state(), "A1", "B")).toEqual({ ok: true });
  });

  it("recusa duplicata", () => {
    useDomainStore.getState().addLink({
      id: "l1",
      projectId: "p1",
      predecessorId: "B",
      successorId: "C",
      type: "fs",
      lagMs: 0,
      crossProjectRef: null,
    });

    expect(canLink(state(), "B", "C")).toEqual({ ok: false, reason: "duplicate" });
  });

  it("recusa ciclo indireto", () => {
    useDomainStore.getState().addLink({
      id: "l1",
      projectId: "p1",
      predecessorId: "B",
      successorId: "C",
      type: "fs",
      lagMs: 0,
      crossProjectRef: null,
    });

    // C → B fecharia o ciclo B → C → B
    expect(canLink(state(), "C", "B")).toEqual({ ok: false, reason: "cycle" });
  });

  it("recusa tarefa inexistente", () => {
    expect(canLink(state(), "B", "fantasma")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("utilitários de grafo", () => {
  it("isDescendant percorre a árvore", () => {
    expect(isDescendant(state(), "A1a", "A")).toBe(true);
    expect(isDescendant(state(), "A1a", "B")).toBe(false);
    expect(isDescendant(state(), "A", "A1")).toBe(false);
  });

  it("reaches segue apenas sucessores", () => {
    useDomainStore.getState().addLink({
      id: "l1",
      projectId: "p1",
      predecessorId: "A",
      successorId: "B",
      type: "fs",
      lagMs: 0,
      crossProjectRef: null,
    });

    expect(reaches(state(), "A", "B")).toBe(true);
    expect(reaches(state(), "B", "A")).toBe(false);
  });
});

describe("criação de vínculo pelo domínio", () => {
  it("adiciona e remove vínculo com histórico", () => {
    useDomainStore.getState().addLink({
      id: "l1",
      projectId: "p1",
      predecessorId: "B",
      successorId: "C",
      type: "fs",
      lagMs: 0,
      crossProjectRef: null,
    });

    expect(Object.keys(state().taskLinks)).toHaveLength(1);
    expect(state().taskLinks.l1?.type).toBe("fs");

    useDomainStore.getState().removeLink("l1");
    expect(Object.keys(state().taskLinks)).toHaveLength(0);
    expect(useHistoryStore.getState().past).toHaveLength(2);
  });
});
