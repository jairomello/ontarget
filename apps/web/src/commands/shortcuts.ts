import { listCommands, normalizeCombo, type Command, type CommandScope } from "./index";
import type { CommandContext } from "./types";

export interface ShortcutGroup {
  scope: CommandScope;
  title: string;
  items: Array<{ id: string; label: string; keys: string[] }>;
}

const TITLES: Record<CommandScope, string> = {
  grid: "Task Sheet",
  gantt: "Gantt Chart",
  global: "Geral",
};

const SCOPE_ORDER: CommandScope[] = ["global", "grid", "gantt"];

/**
 * Monta o conteúdo do overlay de atalhos **diretamente do keymap**:
 * o que está registrado é exatamente o que é exibido
 * (docs/architecture.md §7.2 — overlay gerado a partir do keymap).
 */
export function buildShortcutGroups(commands: Command[] = listCommands()): ShortcutGroup[] {
  const groups = new Map<CommandScope, ShortcutGroup>();

  for (const scope of SCOPE_ORDER) {
    groups.set(scope, { scope, title: TITLES[scope], items: [] });
  }

  for (const command of commands) {
    if (!command.keys || command.keys.length === 0) continue;
    const group = groups.get(command.scope);
    if (!group) continue;

    group.items.push({
      id: command.id,
      label: command.label,
      keys: command.keys.map((binding) => normalizeCombo(binding)),
    });
  }

  return SCOPE_ORDER.map((scope) => groups.get(scope)!).filter(
    (group) => group.items.length > 0,
  );
}

/** Contexto de comando derivado do estado atual da UI. */
export function contextFromUi(ui: {
  focus: "grid" | "gantt";
  cellEditing: boolean;
}): CommandContext {
  return { scope: ui.focus, editing: ui.cellEditing };
}
