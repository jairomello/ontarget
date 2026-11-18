import { formatDurationMs } from "@ontarget/core";

/** Duração em ms de tempo útil → texto curto (`3d`, `4h`, `90min`). */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return formatDurationMs(ms);
}

/** Percentual para exibição (`42%`). */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)}%`;
}
