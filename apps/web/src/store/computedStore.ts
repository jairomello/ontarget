import { create } from "zustand";
import type { ScheduleResult } from "@ontarget/core";

/** Medição da última execução do motor de agendamento. */
export interface ComputationInfo {
  at: number;
  ms: number;
}

/**
 * Estado derivado: resultado do agendamento e caches.
 * Nunca é salvo nem desfeito — sempre recalculado a partir do domínio
 * (docs/architecture.md §10.1 e D4).
 */
export interface ComputedState {
  schedule: ScheduleResult | null;
  computation: ComputationInfo | null;
  setSchedule: (schedule: ScheduleResult, info: ComputationInfo) => void;
  clear: () => void;
}

export const useComputedStore = create<ComputedState>()((set) => ({
  schedule: null,
  computation: null,
  setSchedule: (schedule, info) => set({ schedule, computation: info }),
  clear: () => set({ schedule: null, computation: null }),
}));
