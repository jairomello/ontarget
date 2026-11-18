import { create } from "zustand";
import type { Patch } from "immer";

/**
 * Histórico de desfazer/refazer (specs/editing-history).
 *
 * Cada entrada corresponde a **um comando** — operações estruturais em várias
 * tarefas geram um único conjunto de patches, e portanto um único `Ctrl+Z`.
 * O histórico é por projeto e vive só na sessão.
 */
export interface HistoryEntry {
  /** Rótulo legível do comando (ex.: "indentar tarefas"). */
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

/** Mínimo exigido pela spec: 100 passos. */
export const MAX_HISTORY_STEPS = 100;

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Acrescenta um comando concluído e limpa o futuro. */
  push: (entry: HistoryEntry) => void;
  /** Desfaz: remove do passado e devolve a entrada (empurra para o futuro). */
  undo: () => HistoryEntry | undefined;
  /** Refaz: remove do futuro e devolve a entrada (empurra para o passado). */
  redo: () => HistoryEntry | undefined;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  past: [],
  future: [],

  push: (entry) =>
    set((state) => ({
      past: [...state.past, entry].slice(-MAX_HISTORY_STEPS),
      future: [],
    })),

  undo: () => {
    const { past } = get();
    const entry = past.at(-1);
    if (!entry) return undefined;
    set({ past: past.slice(0, -1), future: [...get().future, entry] });
    return entry;
  },

  redo: () => {
    const { future } = get();
    const entry = future.at(-1);
    if (!entry) return undefined;
    set({ future: future.slice(0, -1), past: [...get().past, entry] });
    return entry;
  },

  clear: () => set({ past: [], future: [] }),
}));

export const selectCanUndo = (state: HistoryState): boolean => state.past.length > 0;
export const selectCanRedo = (state: HistoryState): boolean => state.future.length > 0;
