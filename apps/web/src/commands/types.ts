/** Escopo de um comando: quem pode dispará-lo (docs/architecture.md §7.2). */
export type CommandScope = "grid" | "gantt" | "global";

export interface CommandContext {
  /** Painel com foco ativo. */
  scope: CommandScope;
  /** Há uma célula em edição — bloqueia atalhos de navegação/estrutura. */
  editing: boolean;
}

export interface Command {
  id: string;
  scope: CommandScope;
  /** Rótulo usado no overlay de atalhos e na paleta de comandos. */
  label: string;
  /** Combinações aceitas no formato canônico, ex.: "Ctrl+Shift+Right". */
  keys?: string[];
  /** Prioridade: escopos específicos (10) vencem os globais (0). */
  priority?: number;
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void;
}

/** Evento mínimo de teclado aceito pelo keymap (permite testes sem DOM). */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}
