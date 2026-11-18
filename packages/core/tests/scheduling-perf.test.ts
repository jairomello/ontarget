import { describe, expect, it } from "bun:test";
import { HOUR_MS, defaultCalendar } from "../src/calendar/calendar";
import { runSchedule } from "../src/scheduling/pipeline";
import type { ScheduleLinkInput, ScheduleTaskInput } from "../src/scheduling/types";

/**
 * Orçamento de performance (specs/scheduling — "Recálculo incremental e
 * desempenho"): recálculo completo de 5.000 tarefas em até 300 ms.
 */

const MON = Date.UTC(2026, 0, 5);
const WORKDAY = 9 * HOUR_MS;
const COUNT = 5_000;
const CHAINS = 10;
const PER_CHAIN = COUNT / CHAINS;
const BUDGET_MS = 300;
/**
 * Runners compartilhados do GitHub são bem mais lentos e ruidosos que a
 * máquina de desenvolvimento: o alvo de 300 ms é do produto, não do hardware
 * do runner. A folga maior no CI ainda pega regressões de ordem de grandeza
 * (ex.: O(n²), que levaria segundos).
 */
const CI_FACTOR = 3;

function task(id: string, isSummary = false): ScheduleTaskInput {
  return {
    id,
    parentId: isSummary ? null : null,
    isSummary,
    isInactive: false,
    isPlaceholder: false,
    isMilestone: false,
    schedulingMode: "auto",
    manualStart: null,
    manualFinish: null,
    duration: isSummary ? null : WORKDAY,
    start: null,
    finish: null,
  };
}

/** 10 cadeias paralelas de 500 tarefas, cada uma com seu resumo. */
function buildProject(): { tasks: ScheduleTaskInput[]; links: ScheduleLinkInput[] } {
  const tasks: ScheduleTaskInput[] = [];
  const links: ScheduleLinkInput[] = [];

  for (let chain = 0; chain < CHAINS; chain += 1) {
    const summaryId = `p${chain}`;
    tasks.push(task(summaryId, true));
    let previous: string | null = null;

    for (let index = 0; index < PER_CHAIN; index += 1) {
      const id = `t${chain}-${index}`;
      const item = task(id);
      item.parentId = summaryId;
      tasks.push(item);

      if (previous) {
        links.push({
          id: `${previous}->${id}`,
          predecessorId: previous,
          successorId: id,
          type: "fs",
          lagMs: 0,
        });
      }
      previous = id;
    }
  }

  return { tasks, links };
}

describe("performance do agendamento", () => {
  it(`recalcula ${COUNT} tarefas em até ${BUDGET_MS} ms`, () => {
    const { tasks, links } = buildProject();
    const options = { tasks, links, calendar: defaultCalendar(), projectStart: MON };

    // aquecimento (JIT) antes da medição
    runSchedule(options);

    // melhor de 3: uma pausa de GC/IO do runner não deve reprovar o orçamento
    let elapsed = Number.POSITIVE_INFINITY;
    let result = runSchedule(options);
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      result = runSchedule(options);
      elapsed = Math.min(elapsed, performance.now() - started);
    }

    const budget = process.env.CI ? BUDGET_MS * CI_FACTOR : BUDGET_MS;

    // todas as cadeias têm o mesmo comprimento: tudo é crítico
    expect(result.criticalPath.length).toBe(COUNT + CHAINS);
    expect(result.projectFinish).toBeGreaterThan(MON);
    expect(elapsed).toBeLessThanOrEqual(budget);
  });
});
