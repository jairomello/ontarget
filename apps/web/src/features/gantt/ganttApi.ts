/**
 * Ponte de acesso entre os comandos globais (keymap) e o componente do
 * Gantt — que é quem conhece o intervalo de datas do projeto.
 */
export type FitMode = "project" | "selection";

export interface GanttApi {
  /** Ajusta o zoom para caber no projeto ou na seleção. */
  fit: (mode: FitMode) => void;
  /** Ajusta zoom e rolagem para exibir exatamente o intervalo [from, to]. */
  fitRange: (from: number, to: number) => void;
  /** Zoom em torno de um ponto da tela (ponteiro). */
  zoomAt: (factor: number, clientX: number) => void;
}

let api: GanttApi | null = null;

export function registerGanttApi(instance: GanttApi): () => void {
  api = instance;
  return () => {
    if (api === instance) api = null;
  };
}

export function getGanttApi(): GanttApi | null {
  return api;
}
