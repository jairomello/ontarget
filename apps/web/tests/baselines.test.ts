import { beforeEach, describe, expect, it } from "bun:test";
import { onDirty, resetDirtyListeners, type DirtyEvent } from "../src/store/dirty";
import { useDomainStore } from "../src/store/domainStore";
import { useHistoryStore } from "../src/store/historyStore";
import type { ProjectData, Task } from "../src/store/types";
import { makeTask } from "./helpers/task";

/**
 * Baselines e planos provisórios (specs/tracking — "Linhas de base múltiplas"
 * e "Planos provisórios"): salvamento por escopo (projeto/seleção), limite de
 * 11, remoção e desfazer.
 */

function loadProject(taskIds: string[]): void {
  const tasks = taskIds.map((id, index) => ({
    ...makeTask(id, `Tarefa ${index + 1}`),
    sortOrder: index,
    outlineNumber: String(index + 1),
    start: Date.UTC(2026, 0, 5) + index * 86_400_000,
    finish: Date.UTC(2026, 0, 5) + index * 86_400_000,
  })) as Task[];

  const data: ProjectData = {
    tasks,
    taskLinks: [],
    resources: [],
    assignments: [],
  };
  useDomainStore.getState().load("p1", data);
}

describe("saveBaseline / removeBaseline", () => {
  let events: DirtyEvent[];

  beforeEach(() => {
    loadProject(["t1", "t2", "t3"]);
    resetDirtyListeners();
    events = [];
    onDirty((event) => events.push(event));
  });

  it("salva o projeto inteiro com os valores de todas as tarefas", () => {
    const result = useDomainStore.getState().saveBaseline({
      name: "Baseline 1",
      kind: "baseline",
      scope: "project",
    });

    expect(result).toEqual({ ok: true });
    const state = useDomainStore.getState();
    const [baseline] = Object.values(state.baselines);
    expect(baseline).toMatchObject({ name: "Baseline 1", kind: "baseline", scope: "project" });
    expect(Object.keys(state.baselineValues[baseline!.id] ?? {})).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
    // os valores fotografam datas, duração, trabalho e custo da tarefa
    const value = state.baselineValues[baseline!.id]!.t1!;
    expect(value.start).toBe(Date.UTC(2026, 0, 5));
    expect(value.duration).toBe(86_400_000);

    // persistência: baseline + 3 valores no lote
    expect(events.filter((e) => e.entity === "baselines")).toHaveLength(1);
    expect(events.filter((e) => e.entity === "baseline_values")).toHaveLength(3);
  });

  it("salva apenas as tarefas da seleção", () => {
    const result = useDomainStore.getState().saveBaseline({
      name: "Só a segunda",
      kind: "baseline",
      scope: "selection",
      taskIds: ["t2"],
    });

    expect(result.ok).toBe(true);
    const [baseline] = Object.values(useDomainStore.getState().baselines);
    expect(baseline!.scope).toBe("selection");
    expect(Object.keys(useDomainStore.getState().baselineValues[baseline!.id] ?? {})).toEqual([
      "t2",
    ]);
  });

  it("recusa a seleção vazia sem alterar nada", () => {
    const result = useDomainStore.getState().saveBaseline({
      name: "Vazia",
      kind: "baseline",
      scope: "selection",
      taskIds: [],
    });

    expect(result.ok).toBe(false);
    expect(useDomainStore.getState().baselines).toEqual({});
    expect(events).toHaveLength(0);
  });

  it("limite de 11 linhas de base; planos provisórios não contam", () => {
    const domain = useDomainStore.getState();
    for (let index = 1; index <= 11; index += 1) {
      const saved = domain.saveBaseline({
        name: `Baseline ${index}`,
        kind: "baseline",
        scope: "project",
      });
      expect(saved.ok).toBe(true);
    }

    const refused = domain.saveBaseline({
      name: "Baseline 12",
      kind: "baseline",
      scope: "project",
    });
    expect(refused).toEqual({
      ok: false,
      message: "Limite de 11 linhas de base por projeto.",
    });

    const state = useDomainStore.getState();
    expect(
      Object.values(state.baselines).filter((b) => b.kind === "baseline"),
    ).toHaveLength(11);

    // o plano provisório segue livre do limite
    const interim = domain.saveBaseline({
      name: "Plano X",
      kind: "interim",
      scope: "project",
    });
    expect(interim.ok).toBe(true);
    expect(
      Object.values(useDomainStore.getState().baselines).filter((b) => b.kind === "interim"),
    ).toHaveLength(1);
  });

  it("remove a baseline com os seus valores", () => {
    useDomainStore.getState().saveBaseline({
      name: "Para apagar",
      kind: "baseline",
      scope: "selection",
      taskIds: ["t1", "t3"],
    });
    const [baseline] = Object.values(useDomainStore.getState().baselines);

    events.length = 0;
    useDomainStore.getState().removeBaseline(baseline!.id);

    expect(useDomainStore.getState().baselines).toEqual({});
    expect(useDomainStore.getState().baselineValues).toEqual({});

    const deletes = events.filter((e) => e.kind === "delete");
    expect(deletes.find((e) => e.entity === "baselines")?.key).toBe(baseline!.id);
    const valueDeletes = deletes.filter((e) => e.entity === "baseline_values");
    const valueKeys = valueDeletes
      .map((event) => event.key as [string, string])
      .sort((a, b) => a[1].localeCompare(b[1]));
    // chave composta [baselineId, taskId] — o servidor decodifica tuplas
    expect(valueKeys).toEqual([
      [baseline!.id, "t1"],
      [baseline!.id, "t3"],
    ]);
  });

  it("desfazer remove a baseline salva e refazer a devolve", () => {
    useDomainStore.getState().saveBaseline({
      name: "Com undo",
      kind: "baseline",
      scope: "project",
    });
    expect(Object.keys(useDomainStore.getState().baselines)).toHaveLength(1);

    expect(useDomainStore.getState().undo()).toBe(true);
    expect(useDomainStore.getState().baselines).toEqual({});
    expect(useDomainStore.getState().baselineValues).toEqual({});

    expect(useDomainStore.getState().redo()).toBe(true);
    expect(Object.keys(useDomainStore.getState().baselines)).toHaveLength(1);
    useHistoryStore.getState().clear();
  });
});
