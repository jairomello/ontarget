import { beforeEach, describe, expect, it } from "bun:test";
import {
  comboFromEvent,
  handleKeyDown,
  listCommands,
  normalizeCombo,
  registerAppCommands,
  runCommand,
  type CommandContext,
} from "../src/commands";
import { resetDirtyListeners } from "../src/store/dirty";
import { useDomainStore, type DomainState } from "../src/store/domainStore";
import { useHistoryStore } from "../src/store/historyStore";
import { useUiStore } from "../src/store/uiStore";
import type { ProjectData } from "../src/store/types";
import { makeTask } from "./helpers/task";

function key(k: string, mods: Partial<Record<string, boolean>> = {}) {
  return {
    key: k,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  };
}

function structure(state: DomainState): string[] {
  return state.taskOrder.map((id) => {
    const task = state.tasks[id]!;
    return `${task.parentId ?? "-"}:${task.outlineNumber}`;
  });
}

function loadFiveBlock(): void {
  const data: ProjectData = {
    tasks: [
      makeTask("p", "Fase 1", { sortOrder: 0, outlineNumber: "1" }),
      makeTask("ref", "Referência", { parentId: "p", outlineLevel: 1, outlineNumber: "1.1", sortOrder: 1 }),
      makeTask("t1", "Tarefa 1", { parentId: "p", outlineLevel: 1, outlineNumber: "1.2", sortOrder: 2 }),
      makeTask("t2", "Tarefa 2", { parentId: "p", outlineLevel: 1, outlineNumber: "1.3", sortOrder: 3 }),
      makeTask("t3", "Tarefa 3", { parentId: "p", outlineLevel: 1, outlineNumber: "1.4", sortOrder: 4 }),
      makeTask("q", "Fase 2", { sortOrder: 5, outlineNumber: "2" }),
    ],
    taskLinks: [],
    resources: [],
    assignments: [],
  };
  useDomainStore.getState().load("p1", data);
  useUiStore.getState().setSelection({
    rows: ["t1", "t2", "t3"],
    activeRow: "t3",
    activeColumn: "name",
  });
}

const gridCtx: CommandContext = { scope: "grid", editing: false };

beforeEach(() => {
  resetDirtyListeners();
  useHistoryStore.getState().clear();
  useUiStore.getState().expandAll();
  useUiStore.getState().setZoom({ pxPerDay: 26, preset: null, forcedUnit: null });
  registerAppCommands();
});

describe("keymap (3.3)", () => {
  it("normaliza eventos para a forma canônica", () => {
    expect(comboFromEvent(key("ArrowRight", { ctrlKey: true, shiftKey: true }))).toBe(
      "Ctrl+Shift+Right",
    );
    expect(comboFromEvent(key("z", { ctrlKey: true }))).toBe("Ctrl+Z");
    expect(comboFromEvent(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Z");
    expect(comboFromEvent(key("F4"))).toBe("F4");
    expect(comboFromEvent(key("+"))).toBe("+");
    expect(comboFromEvent(key("?", { shiftKey: true }))).toBe("?");
    expect(comboFromEvent(key("Tab", { shiftKey: true }))).toBe("Shift+Tab");
  });

  it("normaliza bindings escritas de formas diferentes", () => {
    expect(normalizeCombo("ctrl+shift+right")).toBe("Ctrl+Shift+Right");
    expect(normalizeCombo("Shift+Ctrl+Right")).toBe("Ctrl+Shift+Right");
    expect(normalizeCombo("F4")).toBe("F4");
  });
});

describe("atalho e menu percorrem o mesmo comando (3.3)", () => {
  it("Ctrl+Shift+Right e o comando de menu produzem o mesmo resultado", () => {
    loadFiveBlock();
    const before = structure(useDomainStore.getState());

    // caminho 1: teclado
    const handled = handleKeyDown(key("ArrowRight", { ctrlKey: true, shiftKey: true }), gridCtx);
    expect(handled).toBe(true);
    const afterKeyboard = structure(useDomainStore.getState());
    expect(afterKeyboard).not.toEqual(before);

    // volta ao estado original e percorre o caminho 2: menu/botão
    useDomainStore.getState().reset();
    loadFiveBlock();

    const ran = runCommand("grid.indent", gridCtx);
    expect(ran).toBe(true);
    expect(structure(useDomainStore.getState())).toEqual(afterKeyboard);
  });

  it("o keymap resolve para o id do comando registrado", () => {
    const indent = listCommands().find((command) => command.id === "grid.indent");
    expect(indent).toBeDefined();
    expect(indent?.keys).toContain("Ctrl+Shift+Right");
    expect(indent?.scope).toBe("grid");
    expect(indent?.label).toBeTruthy();
  });
});

describe("guarda de modo de edição (3.3)", () => {
  it("nenhum atalho roda enquanto a célula está em edição", () => {
    loadFiveBlock();
    const before = structure(useDomainStore.getState());

    expect(
      handleKeyDown(key("ArrowRight", { ctrlKey: true, shiftKey: true }), {
        scope: "grid",
        editing: true,
      }),
    ).toBe(false);

    expect(handleKeyDown(key("z", { ctrlKey: true }), { scope: "grid", editing: true })).toBe(
      false,
    );
    expect(handleKeyDown(key("+"), { scope: "grid", editing: true })).toBe(false);

    expect(structure(useDomainStore.getState())).toEqual(before);
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });
});

describe("escopo dos comandos (3.3)", () => {
  it("comando do Gantt não dispara com foco na grade", () => {
    loadFiveBlock();

    // com foco na grade, "+" recolhe a hierarquia — o zoom não muda
    expect(handleKeyDown(key("+"), { scope: "grid", editing: false })).toBe(true);
    expect(useUiStore.getState().collapsed["t3"]).toBe(true);
    expect(useUiStore.getState().zoom.pxPerDay).toBe(26);

    // com foco no Gantt, "+" amplia a escala
    expect(handleKeyDown(key("+"), { scope: "gantt", editing: false })).toBe(true);
    expect(useUiStore.getState().zoom.pxPerDay).toBeGreaterThan(26);
  });

  it("comandos globais disparam em qualquer escopo", () => {
    loadFiveBlock();
    runCommand("grid.indent", gridCtx);
    expect(useHistoryStore.getState().past).toHaveLength(1);

    expect(handleKeyDown(key("z", { ctrlKey: true }), { scope: "gantt", editing: false })).toBe(
      true,
    );
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });

  it("combinação desconhecida não é consumida", () => {
    loadFiveBlock();
    expect(handleKeyDown(key("F13"), gridCtx)).toBe(false);
    expect(runCommand("comando.inexistente", gridCtx)).toBe(false);
  });
});
