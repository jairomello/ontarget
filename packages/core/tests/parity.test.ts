import { describe, expect, it } from "bun:test";
import { DAY_MS, HOUR_MS, type Calendar } from "../src/calendar/calendar";
import { runSchedule } from "../src/scheduling/pipeline";
import type {
  ScheduleLinkInput,
  ScheduleOptions,
  ScheduleTaskInput,
} from "../src/scheduling/types";

/**
 * Paridade com o MS Project 2010 (PRD §8, itens 1–10).
 *
 * Calendário-espeelho do MSP: seg–sex, 09:00–17:00 (8 h/dia), de modo que
 * "1 dia" = 8 h = `WORKDAY_MS` do produto.
 *
 * ATENÇÃO: as expectativas foram derivadas da semântica documentada do
 * MS Project 2010. Antes do release, **validar contra o MS Project real**
 * (design.md — risco "Divergência de datas vs. MS Project"). Itens 4, 9 e
 * 10 estão como pendentes: dependem de recursos das fases 7, 8 e 10.
 */

const MON = Date.UTC(2026, 0, 5); // segunda-feira
const WED = Date.UTC(2026, 0, 7); // quarta-feira
const DAY = DAY_MS;
const DAY8 = 8 * HOUR_MS; // "1 dia" do MS Project (8 h)

/** Calendário-espeelho: seg–sex, 09:00–17:00, sem exceções. */
const msCalendar: Calendar = {
  id: "ms-2010",
  name: "MS Project 2010",
  weeklyMask: 0b00011111,
  workingHoursStart: "09:00",
  workingHoursEnd: "17:00",
  exceptions: [],
};

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

function link(
  predecessorId: string,
  successorId: string,
  type: ScheduleLinkInput["type"] = "fs",
  lagMs = 0,
): ScheduleLinkInput {
  return { id: `${predecessorId}->${successorId}`, predecessorId, successorId, type, lagMs };
}

function options(patch: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return { tasks: [], links: [], calendar: msCalendar, projectStart: MON, ...patch };
}

describe("PRD §8 — paridade com o MS Project 2010", () => {
  it("item 1: cadeia FS com lag em dias úteis atravessando o fim de semana", () => {
    // P1 (qua–sex, 2d) → P2 com lag de 2 dias úteis: pula o fim de semana
    const result = runSchedule(
      options({
        projectStart: WED,
        tasks: [task("p1", { duration: 2 * DAY8 }), task("p2", { duration: 3 * DAY8 })],
        links: [link("p1", "p2", "fs", 2 * DAY8)],
      }),
    );

    // p1: quarta e quinta; lag 2d a partir da sexta → segunda e terça úteis
    expect(result.tasks.p1).toMatchObject({ start: WED, finish: WED + DAY });
    expect(result.tasks.p2).toMatchObject({
      start: WED + 6 * DAY, // terça seguinte (sex + 2 dias úteis)
      finish: WED + 8 * DAY, // qua, qui e sex da semana seguinte
    });
    expect(result.tasks.p1!.critical).toBe(true);
    expect(result.tasks.p2!.critical).toBe(true);
    expect(result.conflicts).toEqual([]);
    // validar vs MS Project 2010
  });

  it("item 2: restrição Start No Earlier Than sobre dependência SS", () => {
    const thursday = MON + 3 * DAY;
    const result = runSchedule(
      options({
        tasks: [
          task("p1", { duration: 2 * DAY8 }),
          task("p2", {
            duration: DAY8,
            constraintType: "snet",
            constraintDate: thursday,
          }),
        ],
        links: [link("p1", "p2", "ss")],
      }),
    );

    // o SS daria início na segunda; a restrição vence e fixa na quinta
    expect(result.tasks.p1).toMatchObject({ start: MON, finish: MON + DAY });
    expect(result.tasks.p2).toMatchObject({ start: thursday, finish: thursday });
    expect(
      result.conflicts.find((conflict) => conflict.taskId === "p2"),
    ).toMatchObject({ kind: "constraint", code: "constraint_wins" });
    // validar vs MS Project 2010
  });

  it("item 5: tarefa manual em cadeia automática preserva datas e propaga", () => {
    const manualStart = MON + 3 * DAY; // quinta
    const manualFinish = MON + 4 * DAY; // sexta
    const result = runSchedule(
      options({
        tasks: [
          task("a", { duration: 2 * DAY8 }),
          task("m", {
            schedulingMode: "manual",
            manualStart,
            manualFinish,
            start: manualStart,
            finish: manualFinish,
          }),
          task("c", { duration: DAY8 }),
        ],
        links: [link("a", "m"), link("m", "c")],
      }),
    );

    expect(result.tasks.a).toMatchObject({ start: MON, finish: MON + DAY });
    // a manual não se move
    expect(result.tasks.m).toMatchObject({ start: manualStart, finish: manualFinish });
    // o sucessor começa no primeiro dia útil seguinte (segunda)
    expect(result.tasks.c).toMatchObject({ start: MON + 7 * DAY, finish: MON + 7 * DAY });
    // validar vs MS Project 2010
  });

  it("item 6: roll-up de resumo ignora a tarefa inativa", () => {
    const later = MON + 20 * DAY;
    const result = runSchedule(
      options({
        tasks: [
          task("p", { isSummary: true }),
          task("c1", { parentId: "p", duration: 2 * DAY8 }),
          task("c2", {
            parentId: "p",
            isInactive: true,
            duration: 10 * DAY8,
            start: later,
            finish: later + 9 * DAY,
          }),
        ],
        links: [],
      }),
    );

    // o resumo acompanha só o filho ativo, mesmo com a inativa mais tardia
    expect(result.tasks.p).toMatchObject({ start: MON, finish: MON + DAY });
    expect(result.tasks.c2).toMatchObject({ excluded: "inactive", critical: false });
    // validar vs MS Project 2010
  });

  it("item 7: split com intervalo de 3 dias preserva a duração total", () => {
    // segmentos qua–sex... qui–sex com folga de 3 dias (seg, ter, qua)
    const segments = JSON.stringify([
      { start: MON, finish: MON },
      { start: MON + 4 * DAY, finish: MON + 4 * DAY },
    ]);
    const result = runSchedule(
      options({ tasks: [task("t", { duration: 2 * DAY8, segments })] }),
    );

    expect(result.tasks.t).toMatchObject({
      start: MON,
      finish: MON + 4 * DAY, // última sexta após a folga
      duration: 2 * DAY8, // 2 dias úteis; o intervalo de 3 dias não conta
    });
    // validar vs MS Project 2010
  });

  it("item 8: recorrência semanal desloca a ocorrência que cai no feriado", () => {
    const holiday = MON + 14 * DAY; // terceira segunda do mês
    const result = runSchedule(
      options({
        calendar: { ...msCalendar, exceptions: [{ date: holiday, isWorking: false, name: "Feriado" }] },
        tasks: [
          task("r", {
            duration: 2 * DAY8,
            start: MON,
            finish: MON + DAY,
            recurrence: JSON.stringify({ frequency: "weekly", interval: 1, count: 4 }),
          }),
        ],
      }),
    );

    expect(result.tasks.r).toMatchObject({ start: MON });
    expect(result.tasks["r#2"]).toMatchObject({ start: MON + 7 * DAY });
    // a ocorrência da segunda com feriado desloca para a terça…
    expect(result.tasks["r#3"]).toMatchObject({ start: MON + 15 * DAY });
    // …e a seguinte mantém a ordem semanal
    expect(result.tasks["r#4"]).toMatchObject({ start: MON + 21 * DAY });
    // validar vs MS Project 2010
  });

  it("item 3: calendário de tarefa com turno de 6h converte a duração", () => {
    // turno de 6h (09:00–15:00) aplicado só a esta tarefa
    const sixHours: Calendar = { ...msCalendar, id: "tarefa-6h", workingHoursEnd: "15:00" };
    const duration = 8 * HOUR_MS;

    const result = runSchedule(
      options({
        tasks: [
          task("prazo", { duration, name: "No calendário do projeto" }),
          task("turno", { duration, calendarId: "tarefa-6h", name: "Com turno de 6h" }),
        ],
        calendars: { "tarefa-6h": sixHours },
      }),
    );

    // 8 h: cabe em um dia no calendário do projeto (8h), mas ocupa dois dias
    // no turno de 6h da própria tarefa
    expect(result.tasks.prazo).toMatchObject({ start: MON, finish: MON });
    expect(result.tasks.turno).toMatchObject({ start: MON, finish: MON + DAY });
    // validar vs MS Project 2010
  });

  // --- itens pendentes de recursos das próximas fases ----------------------

  it.skip(
    "item 4: Fixed Work com 2 recursos em 50% — pendente: atribuições reais (tarefa 7.4)",
    () => undefined,
  );

  it.skip(
    "item 9: baseline salva e desvios SV/SLIP — pendente: tracking (tarefas 8.1 e 8.2)",
    () => undefined,
  );

  it.skip(
    "item 10: deadline excedido com alerta e marcador no timeline — pendente: alertas e timeline (tarefas 8.5 e 10.1); o conflito de prazo já é coberto em scheduling.test.ts",
    () => undefined,
  );
});
