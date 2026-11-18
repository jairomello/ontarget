/**
 * Cálculo de trabalho e custo de atribuições (specs/resources — "Cálculo de
 * trabalho e custo").
 *
 *  - trabalho = duração × unidades (ms de tempo útil; a duração já está no
 *    tempo útil do agendamento e o calendário da pessoa entra pela sua
 *    disponibilidade — specs/resources, superalocação);
 *  - custo = trabalho convertido em horas × taxa padrão (R$/h).
 *
 * Funções puras — sem I/O, sem DOM.
 */

import { HOUR_MS } from "../calendar/calendar";

/** Trabalho de uma atribuição em ms de tempo útil: duração × unidades. */
export function assignmentWork(durationMs: number, units: number): number {
  if (!(durationMs > 0) || !(units > 0)) return 0;
  return durationMs * units;
}

/** Custo da atribuição: horas de trabalho × taxa padrão (R$/h). */
export function assignmentCost(workMs: number, standardRate: number): number {
  if (!(workMs > 0) || !(standardRate > 0)) return 0;
  return (workMs / HOUR_MS) * standardRate;
}
