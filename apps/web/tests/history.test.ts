import { beforeEach, describe, expect, it } from "bun:test";
import { resetDirtyListeners } from "../src/store/dirty";
import { useDomainStore, type DomainState } from "../src/store/domainStore";
import { MAX_HISTORY_STEPS, useHistoryStore } from "../src/store/historyStore";
import type { ProjectData } from "../src/store/types";
import { makeTask } from "./helpers/task";

/** Estrutura visível da árvore, para comparações. */
function structure(state: DomainState): string[] {
  return state.taskOrder.map((id) => {
    const task = state.tasks[id]!;
    return `${task.parentId ?? "-"}:${task.outlineLevel}:${task.outlineNumber}`;
  });
}

/** Árvore de referência: p > [ref, t1..t5] e q. */
function loadFiveBlock(): void {
  const data: ProjectData = {
    tasks: [
      makeTask("p", "Fase 1", { sortOrder: 0 }),
      makeTask("ref", "Referência", { parentId: "p", outlineLevel: 1, outlineNumber: "1.1", sortOrder: 1 }),
      makeTask("t1", "Tarefa 1", { parentId: "p", outlineLevel: 1, outlineNumber: "1.2", sortOrder: 2 }),
      makeTask("t2", "Tarefa 2", { parentId: "p", outlineLevel: 1, outlineNumber: "1.3", sortOrder: 3 }),
      makeTask("t3", "Tarefa 3", { parentId: "p", outlineLevel: 1, outlineNumber: "1.4", sortOrder: 4 }),
      makeTask("t4", "Tarefa 4", { parentId: "p", outlineLevel: 1, outlineNumber: "1.5", sortOrder: 5 }),
      makeTask("t5", "Tarefa 5", { parentId: "p", outlineLevel: 1, outlineNumber: "1.6", sortOrder: 6 }),
      makeTask("q", "Fase 2", { sortOrder: 7, outlineNumber: "2" }),
    ],
    taskLinks: [],
    resources: [],
    assignments: [],
  };
  useDomainStore.getState().load("p1", data);
}

beforeEach(() => {
  resetDirtyListeners();
  useHistoryStore.getState().clear();
});

describe("undo/redo (3.2)", () => {
  it("indentar 5 tarefas é um único passo de desfazer", () => {
    loadFiveBlock();
    const before = structure(useDomainStore.getState());

    const result = useDomainStore.getState().indentTasks(["t1", "t2", "t3", "t4", "t5"]);
    expect(result.ok).toBe(true);

    // as cinco passaram a ser filhas de `ref`
    const indented = useDomainStore.getState();
    for (const id of ["t1", "t2", "t3", "t4", "t5"]) {
      expect(indented.tasks[id]?.parentId).toBe("ref");
    }
    expect(structure(indented)).not.toEqual(before);

    // um único passo no histórico
    expect(useHistoryStore.getState().past).toHaveLength(1);
    expect(useHistoryStore.getState().past[0]?.label).toBe("indentar tarefas");

    // um único Ctrl+Z restaura tudo
    expect(useDomainStore.getState().undo()).toBe(true);
    expect(structure(useDomainStore.getState())).toEqual(before);
    expect(useHistoryStore.getState().past).toHaveLength(0);
    expect(useHistoryStore.getState().future).toHaveLength(1);
  });

  it("refazer reaplica a operação estrutural", () => {
    loadFiveBlock();
    const before = structure(useDomainStore.getState());

    useDomainStore.getState().indentTasks(["t1", "t2", "t3", "t4", "t5"]);
    const afterIndent = structure(useDomainStore.getState());

    useDomainStore.getState().undo();
    expect(structure(useDomainStore.getState())).toEqual(before);

    expect(useDomainStore.getState().redo()).toBe(true);
    expect(structure(useDomainStore.getState())).toEqual(afterIndent);
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it("nova edição descarta o futuro (nada de refazer fantasma)", () => {
    loadFiveBlock();
    useDomainStore.getState().indentTasks(["t1", "t2", "t3", "t4", "t5"]);
    useDomainStore.getState().undo();
    expect(useHistoryStore.getState().future).toHaveLength(1);

    useDomainStore.getState().updateTask("q", { name: "Fase 2 editada" });
    expect(useHistoryStore.getState().future).toHaveLength(0);
  });

  it("mantém pelo menos 100 passos", () => {
    loadFiveBlock();

    for (let index = 0; index < MAX_HISTORY_STEPS + 50; index += 1) {
      useDomainStore.getState().updateTask("q", { name: `Nome ${index}` });
    }

    expect(useHistoryStore.getState().past).toHaveLength(MAX_HISTORY_STEPS);

    let undoCount = 0;
    while (useDomainStore.getState().undo()) undoCount += 1;
    expect(undoCount).toBe(MAX_HISTORY_STEPS);
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });

  it("edição sem efeito não cria passo de histórico", () => {
    loadFiveBlock();
    expect(useHistoryStore.getState().past).toHaveLength(0);

    useDomainStore.getState().addTask(makeTask("nova", "Nova tarefa", { sortOrder: 8 }));
    expect(useHistoryStore.getState().past).toHaveLength(1);

    // atualizar tarefa inexistente: nada muda, nada entra no histórico
    useDomainStore.getState().updateTask("sumiu", { name: "x" });
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it("desfazer e refazer em sequência não perdem consistência", () => {
    loadFiveBlock();
    const original = structure(useDomainStore.getState());

    useDomainStore.getState().indentTasks(["t1", "t2", "t3", "t4", "t5"]);
    useDomainStore.getState().outdentTasks(["t1", "t2", "t3", "t4", "t5"]);
    const afterRoundTrip = structure(useDomainStore.getState());
    expect(afterRoundTrip).toEqual(original);

    useDomainStore.getState().undo(); // desfaz o outdent
    useDomainStore.getState().undo(); // desfaz o indent
    expect(structure(useDomainStore.getState())).toEqual(original);
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });
});
