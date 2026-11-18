export type { Command, CommandContext, CommandScope, KeyEventLike } from "./types";
export { comboFromEvent, normalizeCombo, normalizeKey } from "./keymap";
export {
  getCommand,
  handleKeyDown,
  listCommands,
  registerCommand,
  resetCommands,
  runCommand,
} from "./registry";
export { registerAppCommands } from "./definitions";
export { buildShortcutGroups, contextFromUi, type ShortcutGroup } from "./shortcuts";
export { useHotkeys } from "./useHotkeys";
