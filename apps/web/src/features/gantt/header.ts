import { displayUnitFor, type HeaderBand, type DisplayUnit } from "@ontarget/core";

/**
 * Altura do cabeçalho de escala, compartilhada pela Task Sheet e pelo Gantt
 * para que as linhas permaneçam alinhadas verticalmente (docs/Design.md §6.4).
 */
export const BAND_HEIGHT = 18;
const HEADER_PADDING = 6;

/** Faixas do cabeçalho para um dado zoom. */
export function bandsFor(pxPerDay: number): HeaderBand[] {
  const unit: DisplayUnit = displayUnitFor(pxPerDay);

  switch (unit) {
    case "hour":
      return ["year", "month", "day"];
    case "day":
      return ["year", "month", "day"];
    case "week":
      return ["year", "month", "week"];
    case "month":
      return ["year", "month"];
    case "quarter":
      return ["year", "quarter"];
    case "year":
      return ["year", "semester"];
  }
}

export function headerHeightFor(pxPerDay: number): number {
  return bandsFor(pxPerDay).length * BAND_HEIGHT + HEADER_PADDING;
}
