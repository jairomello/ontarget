import { beforeEach, describe, expect, it } from "bun:test";
import {
  buildShortcutGroups,
  listCommands,
  normalizeCombo,
  registerAppCommands,
} from "../src/commands";

beforeEach(() => {
  registerAppCommands();
});

describe("overlay de atalhos (3.5)", () => {
  it("exibe exatamente os comandos que têm binding registrado", () => {
    const shown = buildShortcutGroups().flatMap((group) => group.items.map((item) => item.id));
    const registered = listCommands()
      .filter((command) => (command.keys?.length ?? 0) > 0)
      .map((command) => command.id);

    expect(shown.sort()).toEqual(registered.sort());
  });

  it("mostra o rótulo e as combinações canônicas do keymap", () => {
    const commands = listCommands();
    const groups = buildShortcutGroups();

    for (const group of groups) {
      for (const item of group.items) {
        const command = commands.find((candidate) => candidate.id === item.id);
        expect(command, `comando ${item.id} não encontrado`).toBeDefined();
        expect(item.label).toBe(command!.label);
        expect(item.keys).toEqual(command!.keys!.map((binding) => normalizeCombo(binding)));
      }
    }
  });

  it("agrupa por escopo na ordem global, Task Sheet, Gantt", () => {
    const groups = buildShortcutGroups();
    expect(groups.map((group) => group.scope)).toEqual(["global", "grid", "gantt"]);
    expect(groups[0]?.title).toBe("Geral");
    expect(groups[1]?.title).toBe("Task Sheet");
    expect(groups[2]?.title).toBe("Gantt Chart");
  });

  it("inclui os atalhos principais conhecidos", () => {
    const groups = buildShortcutGroups();
    const flat = groups.flatMap((group) => group.items);

    const indent = flat.find((item) => item.id === "grid.indent");
    expect(indent?.keys).toContain("Ctrl+Shift+Right");

    const undo = flat.find((item) => item.id === "global.undo");
    expect(undo?.keys).toContain("Ctrl+Z");

    const showShortcuts = flat.find((item) => item.id === "global.showShortcuts");
    expect(showShortcuts?.keys).toContain("?");
  });

  it("comandos sem atalho ficam fora do overlay", () => {
    const withoutKeys = listCommands().filter((command) => (command.keys?.length ?? 0) === 0);
    const shown = buildShortcutGroups().flatMap((group) => group.items.map((item) => item.id));

    for (const command of withoutKeys) {
      expect(shown).not.toContain(command.id);
    }
  });
});
