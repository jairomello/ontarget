import { comboFromEvent, normalizeCombo } from "./keymap";
import type { Command, CommandContext, KeyEventLike } from "./types";

/**
 * Registro único de comandos: menus, botões e atalhos passam por aqui,
 * garantindo que um mesmo `id` produza exatamente o mesmo efeito.
 */
const registry = new Map<string, Command>();
let orderedCache: Command[] | null = null;
let sequence = 0;
const order = new Map<string, number>();

export function registerCommand(command: Command): void {
  registry.set(command.id, command);
  order.set(command.id, sequence++);
  orderedCache = null;
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

/** Comandos em ordem de atuação: maior prioridade primeiro. */
export function listCommands(): Command[] {
  if (!orderedCache) {
    orderedCache = [...registry.values()].sort((a, b) => {
      const priority = (b.priority ?? 0) - (a.priority ?? 0);
      if (priority !== 0) return priority;
      return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    });
  }
  return orderedCache;
}

/** Executa um comando pelo id — caminho usado por menus e botões. */
export function runCommand(id: string, ctx: CommandContext): boolean {
  const command = registry.get(id);
  if (!command) return false;
  if (command.when && !command.when(ctx)) return false;
  command.run(ctx);
  return true;
}

/**
 * Resolve um evento de teclado em um comando.
 *
 * Regras:
 *  - com célula em edição **nenhum** atalho roda (o editor manda);
 *  - comandos só disparam no seu escopo (ou no global);
 *  - a primeira combinação correspondente por prioridade vence.
 */
export function handleKeyDown(event: KeyEventLike, ctx: CommandContext): boolean {
  if (ctx.editing) return false;

  const combo = comboFromEvent(event);

  for (const command of listCommands()) {
    if (!command.keys?.some((binding) => normalizeCombo(binding) === combo)) continue;
    if (command.scope !== "global" && command.scope !== ctx.scope) continue;
    if (command.when && !command.when(ctx)) continue;

    command.run(ctx);
    return true;
  }

  return false;
}

/** Limpa o registro — apenas para testes. */
export function resetCommands(): void {
  registry.clear();
  order.clear();
  orderedCache = null;
  sequence = 0;
}
