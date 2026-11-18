import { describe, expect, it } from "bun:test";
import { DAY_MS, defaultCalendar, type Calendar } from "../src/calendar/calendar";
import {
  detectOverallocation,
  type AllocationTaskInput,
  type OverallocationInput,
} from "../src/resources/allocation";

/**
 * Detecção de superalocação (specs/resources) e a verificação adiada da
 * tarefa 6.5: tarefas inativas não afetam a superalocação.
 *
 * 05/01/2026 é segunda-feira; 10/01 é sábado.
 */

const MON = Date.UTC(2026, 0, 5);
const DAY = DAY_MS;

const cal = defaultCalendar();

function task(id: string, start: number, finish: number, patch: Partial<AllocationTaskInput> = {}): AllocationTaskInput {
  return { id, start, finish, isInactive: false, ...patch };
}

function input(patch: Partial<OverallocationInput> = {}): OverallocationInput {
  return {
    tasks: [],
    assignments: [],
    resources: [],
    from: MON,
    to: MON + 6 * DAY,
    calendar: cal,
    ...patch,
  };
}

const assignment = (taskId: string, resourceId: string, units = 1) => ({
  id: `${resourceId}-${taskId}`,
  taskId,
  resourceId,
  units,
});

const person = (id: string, maxUnits: number) => ({ id, maxUnits });

describe("detectOverallocation", () => {
  it("marca os dias de sobreposição com a razão demanda/capacidade", () => {
    // Ana (100%) com duas tarefas simultâneas de segunda a quinta
    const days = detectOverallocation(
      input({
        tasks: [task("t1", MON, MON + 4 * DAY), task("t2", MON + DAY, MON + 3 * DAY)],
        assignments: [assignment("t1", "ana"), assignment("t2", "ana")],
        resources: [person("ana", 1)],
      }),
    );

    // sobreposição de terça a quinta, razão 2/1 = 2
    expect(days.map((d) => d.date)).toEqual([MON + DAY, MON + 2 * DAY, MON + 3 * DAY]);
    for (const day of days) {
      expect(day).toMatchObject({ resourceId: "ana", demand: 2, capacity: 1, ratio: 2 });
      expect([...day.taskIds].sort()).toEqual(["t1", "t2"]);
    }
  });

  it("sem sobreposição não há conflito", () => {
    const days = detectOverallocation(
      input({
        tasks: [task("t1", MON, MON), task("t2", MON + 2 * DAY, MON + 2 * DAY)],
        assignments: [assignment("t1", "ana"), assignment("t2", "ana")],
        resources: [person("ana", 1)],
      }),
    );

    expect(days).toEqual([]);
  });

  it("capacidade dobrada absorve duas tarefas simultâneas", () => {
    const days = detectOverallocation(
      input({
        tasks: [task("t1", MON, MON + 2 * DAY), task("t2", MON, MON + 2 * DAY)],
        assignments: [assignment("t1", "bia"), assignment("t2", "bia")],
        resources: [person("bia", 2)],
      }),
    );

    // demanda igual à capacidade não é superalocação (é estritamente maior)
    expect(days).toEqual([]);
  });

  it("tarefas inativas ficam fora do cálculo (verificação adiada da 6.5)", () => {
    const days = detectOverallocation(
      input({
        tasks: [
          task("t1", MON, MON + 4 * DAY),
          task("t2", MON + DAY, MON + 3 * DAY),
          task("off", MON + DAY, MON + 3 * DAY, { isInactive: true }),
        ],
        assignments: [
          assignment("t1", "ana"),
          assignment("t2", "ana"),
          assignment("off", "ana"),
        ],
        resources: [person("ana", 1)],
      }),
    );

    // a inativa não infla a demanda: continua 2, não 3
    expect(days.every((d) => d.demand === 2)).toBe(true);
    expect([...days[0]!.taskIds].sort()).toEqual(["t1", "t2"]);
    expect(days[0]!.taskIds).not.toContain("off");
  });

  it("o calendário da pessoa define os dias de capacidade", () => {
    // conflito cai no sábado (10/01): o projeto não trabalha sábado…
    const weekend: Calendar = {
      ...cal,
      weeklyMask: 0b00111111, // seg..sáb (bit 5 = sábado)
    };
    const sat = Date.UTC(2026, 0, 10);

    const withProjectCalendar = detectOverallocation(
      input({
        tasks: [task("t1", MON, sat), task("t2", sat, sat)],
        assignments: [assignment("t1", "ana"), assignment("t2", "ana")],
        resources: [person("ana", 1)],
        to: sat,
      }),
    );
    // com o calendário do projeto, sábado não é avaliado
    expect(withProjectCalendar.map((d) => d.date)).not.toContain(sat);

    // com o calendário da pessoa (sábado útil), o sábado é coberto
    const withPersonCalendar = detectOverallocation(
      input({
        tasks: [task("t1", MON, sat), task("t2", sat, sat)],
        assignments: [assignment("t1", "ana"), assignment("t2", "ana")],
        resources: [{ ...person("ana", 1), calendar: weekend }],
        to: sat,
      }),
    );
    expect(withPersonCalendar.map((d) => d.date)).toContain(sat);
  });
});
