import { writeFileSync } from "node:fs";
import path from "node:path";
import { registerAppCommands } from "../apps/web/src/commands";
import { buildShortcutsMarkdown } from "../apps/web/src/commands/shortcutsDoc";

/**
 * Gera `docs/atalhos.md` direto do keymap registrado.
 * Uso: `bun run docs:shortcuts`
 */
registerAppCommands();

const target = path.resolve(import.meta.dir, "../docs/atalhos.md");
writeFileSync(target, buildShortcutsMarkdown());
console.log(`docs/atalhos.md atualizado (${target})`);
