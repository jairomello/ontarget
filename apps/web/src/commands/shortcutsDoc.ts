import { buildShortcutGroups } from "./shortcuts";

/**
 * Markdown da documentação de atalhos (docs/atalhos.md) — gerado do MESMO
 * keymap que alimenta o overlay `?` e o dispatcher de teclas, para que o
 * documento nunca diverga do que a aplicação executa
 * (docs/architecture.md §7.2).
 */
export function buildShortcutsMarkdown(): string {
  const groups = buildShortcutGroups();

  const lines: string[] = [
    "# Atalhos do ontarget",
    "",
    "> Gerado de `apps/web/src/commands` — a mesma fonte do overlay de",
    "> atalhos (`?`) e do dispatcher de teclas. Regenere com",
    "> `bun run docs:shortcuts` após alterar o keymap.",
    "",
  ];

  for (const group of groups) {
    lines.push(`## ${group.title}`, "", "| Comando | Atalho |", "| --- | --- |");
    for (const item of group.items) {
      const keys = item.keys.map((binding) => `\`${binding}\``).join(", ");
      lines.push(`| ${item.label} | ${keys} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
