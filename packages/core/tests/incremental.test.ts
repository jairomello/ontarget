import { describe, expect, it } from "bun:test";
import { DAY_MS, HOUR_MS, defaultCalendar, type Calendar } from "../src/calendar/calendar";
import { changedScheduleIds } from "../src/scheduling/incremental";
import { runSchedule } from "../src/scheduling/pipeline";
import type {
  ScheduleOptions,
  ScheduleResult,
  ScheduleTaskInput,
} from "../src/scheduling/types";

/** 05/01/2026 é segunda-feira. */
const MON = Date.UTC(2026, 0, 5);
const DAY = DAY_MS;
const WORKDAY = 9 * HOUR_MS;
const cal = defaultCalendar();

function task(id: string, patch: Partial<ScheduleTaskInput> = {}): ScheduleTaskInput {
  return {
    id,
    parentId: null,
    isSummary: false,
    isInactive: false,
    isPlaceholder: false,
    isMilestone: false,
    schedulingMode: "auto",
    manualStart: null,
    manualFinish: null,
    duration: null,
    start: null,
    finish: null,
    ...patch,
  };
}

/**
 * Dois grafos independentes: A→B→C (define o fim do projeto) e D→E (mais
 * curto, fora do envelope), mais o resumo P com os filhos c1→c2.
 */
function buildTasks(): ScheduleTaskInput[] {
  return [
    task("a", { duration: WORKDAY }),
    task("b", { duration: WORKDAY }),
    task("c", { duration: WORKDAY }),
    task("d", { duration: WORKDAY }),
    task("e", { duration: WORKDAY }),
    task("p", { isSummary: true }),
    task("c1", { parentId: "p", duration: WORKDAY }),
    task("c2", { parentId: "p", duration: WORKDAY }),
  ];
}

const baseLinks = (): ScheduleOptions["links"] => [
  { id: "a->b", predecessorId: "a", successorId: "b", type: "fs", lagMs: 0 },
  { id: "b->c", predecessorId: "b", successorId: "c", type: "fs", lagMs: 0 },
  { id: "d->e", predecessorId: "d", successorId: "e", type: "fs", lagMs: 0 },
  { id: "c1->c2", predecessorId: "c1", successorId: "c2", type: "fs", lagMs: 0 },
];

const baseOptions = (): ScheduleOptions => ({
  tasks: buildTasks(),
  links: baseLinks(),
  calendar: cal,
  projectStart: MON,
});

/** Clona as opções com a duração de uma tarefa alterada. */
function withDuration(id: string, duration: number): ScheduleOptions {
  const options = baseOptions();
  options.tasks = options.tasks.map((entry) =>
    entry.id === id ? { ...entry, duration } : entry,
  );
  return options;
}

describe("changedScheduleIds", () => {
  it("devolve o id da tarefa alterada", () => {
    const prev = { tasks: buildTasks(), links: baseLinks() };
    const next = {
      tasks: prev.tasks.map((entry) =>
        entry.id === "b" ? { ...entry, duration: 4 * WORKDAY } : entry,
      ),
      links: prev.links,
    };

    expect(changedScheduleIds(prev, next)).toEqual(["b"]);
  });

  it("devolve os extremos do vínculo alterado", () => {
    const prev = { tasks: buildTasks(), links: baseLinks() };
    const next = {
      tasks: prev.tasks,
      links: prev.links.map((entry) =>
        entry.id === "a->b" ? { ...entry, lagMs: DAY } : entry,
      ),
    };

    expect([...changedScheduleIds(prev, next)!].sort()).toEqual(["a", "b"]);
  });

  it("devolve vazio quando nada muda", () => {
    const prev = { tasks: buildTasks(), links: baseLinks() };
    expect(changedScheduleIds(prev, { tasks: buildTasks(), links: prev.links })).toEqual([]);
  });

  it("devolve null para entrada/saída estrutural", () => {
    const prev = { tasks: buildTasks(), links: baseLinks() };

    expect(changedScheduleIds(prev, { tasks: [...prev.tasks, task("novo")], links: prev.links })).toBeNull();
    expect(changedScheduleIds(prev, { tasks: prev.tasks.slice(0, -1), links: prev.links })).toBeNull();
    expect(changedScheduleIds(prev, { tasks: prev.tasks, links: prev.links.slice(0, -1) })).toBeNull();
  });
});

describe("recálculo incremental", () => {
  it("produz exatamente o mesmo resultado do recálculo completo", () => {
    const edited = withDuration("d", 2 * WORKDAY);
    const full = runSchedule(edited);
    const baseline: ScheduleResult = runSchedule(baseOptions());
    const incremental = runSchedule({
      ...edited,
      incremental: { baseline, changedIds: ["d"] },
    });

    expect(incremental.meta).toEqual({ incremental: true });
    expect(incremental.tasks).toEqual(full.tasks);
    expect(incremental.rollups).toEqual(full.rollups);
    expect(incremental.conflicts).toEqual(full.conflicts);
    expect([...incremental.criticalPath].sort()).toEqual([...full.criticalPath].sort());
    expect(incremental.projectFinish).toBe(full.projectFinish);
    expect([...incremental.order].sort()).toEqual([...full.order].sort());
  });

  it("mantém intactos os resultados fora da cadeia alterada", () => {
    const baseline = runSchedule(baseOptions());
    const incremental = runSchedule({
      ...withDuration("d", 2 * WORKDAY),
      incremental: { baseline, changedIds: ["d"] },
    });

    // a cadeia A→B→C e o resumo não participam: permanecem idênticos
    for (const id of ["a", "b", "c", "c1", "c2", "p"]) {
      expect(incremental.tasks[id]).toEqual(baseline.tasks[id]);
    }
    expect(incremental.tasks.d!.duration).toBe(2 * WORKDAY);
    expect(incremental.meta).toEqual({ incremental: true });
  });

  it("inclui o resumo quando um filho muda (roll-up)", () => {
    const edited = withDuration("c2", 2 * WORKDAY);
    const full = runSchedule(edited);
    const baseline = runSchedule(baseOptions());
    const incremental = runSchedule({
      ...edited,
      incremental: { baseline, changedIds: ["c2"] },
    });

    expect(incremental.meta).toEqual({ incremental: true });
    expect(incremental.tasks.p).toEqual(full.tasks.p);
    expect(incremental.rollups.p).toEqual(full.rollups.p);
  });

  it("mantém os calendários próprios das tarefas no recálculo incremental", () => {
    const sixHours: Calendar = {
      ...defaultCalendar(),
      id: "seis-horas",
      workingHoursEnd: "15:00",
    };
    const edited = baseOptions();
    edited.calendars = { "seis-horas": sixHours };
    edited.tasks = edited.tasks.map((entry) =>
      entry.id === "d" ? { ...entry, calendarId: "seis-horas" } : entry,
    );

    const full = runSchedule(edited);
    const baseline = runSchedule(baseOptions());
    const incremental = runSchedule({
      ...edited,
      incremental: { baseline, changedIds: ["d"] },
    });

    expect(incremental.meta).toEqual({ incremental: true });
    expect(incremental.tasks).toEqual(full.tasks);
    // a conversão é real: 9 h em turno de 6h vai para a terça
    expect(incremental.tasks.d!.finish).toBeGreaterThan(baseline.tasks.d!.finish ?? 0);
  });

  it("recalcula completo quando o fim do projeto cresce", () => {
    const baseline = runSchedule(baseOptions());
    const result = runSchedule({
      ...withDuration("d", 20 * WORKDAY),
      incremental: { baseline, changedIds: ["d"] },
    });

    expect(result.meta).toEqual({ incremental: false });
    expect(result.projectFinish).toBeGreaterThan(baseline.projectFinish);
  });

  it("recalcula completo quando a tarefa vira inativa", () => {
    const baseline = runSchedule(baseOptions());
    const options = baseOptions();
    options.tasks = options.tasks.map((entry) =>
      entry.id === "d" ? { ...entry, isInactive: true } : entry,
    );

    const result = runSchedule({
      ...options,
      incremental: { baseline, changedIds: ["d"] },
    });

    expect(result.meta).toEqual({ incremental: false });
    expect(result.tasks.d!.excluded).toBe("inactive");
  });

  it("recalcula completo quando o baseline tem ciclo", () => {
    const cyclic: ScheduleOptions = {
      ...baseOptions(),
      links: [
        ...baseLinks(),
        { id: "c->a", predecessorId: "c", successorId: "a", type: "fs", lagMs: 0 },
      ],
    };
    const baseline = runSchedule(cyclic);
    expect(baseline.cycles.length).toBeGreaterThan(0);

    const result = runSchedule({
      ...withDuration("d", 3 * WORKDAY),
      incremental: { baseline, changedIds: ["d"] },
    });

    expect(result.meta).toEqual({ incremental: false });
  });

  it("sem tarefas alteradas cai no completo (o chamador deve pular a chamada)", () => {
    const baseline = runSchedule(baseOptions());
    const result = runSchedule({
      ...baseOptions(),
      incremental: { baseline, changedIds: [] },
    });

    expect(result.meta).toEqual({ incremental: false });
    expect(result.tasks).toEqual(baseline.tasks);
  });
});
