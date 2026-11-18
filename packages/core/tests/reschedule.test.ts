import { describe, expect, it } from "bun:test";
import { DAY_MS, defaultCalendar, type Calendar } from "../src/calendar/calendar";
import { rescheduleForCalendarChange, type RescheduleTask } from "../src/calendar/reschedule";

/**
 * 05/01/2026 é segunda-feira; 07/01 é quarta-feira.
 * Convenção inclusive: `finish` é a meia-noite do último dia trabalhado.
 */
const MON = Date.UTC(2026, 0, 5);
const WED = MON + 2 * DAY_MS;
const THU = WED + DAY_MS;
const FRI = WED + 2 * DAY_MS;

const base = defaultCalendar();

function withHoliday(date: number, isWorking = false): Calendar {
  return {
    ...base,
    exceptions: [{ date, isWorking, name: isWorking ? "Compensação" : "Feriado" }],
  };
}

function task(patch: Partial<RescheduleTask> = {}): RescheduleTask {
  return { id: "t1", start: WED, finish: FRI, schedulingMode: "auto", ...patch };
}

describe("rescheduleForCalendarChange", () => {
  it("feriado no início desloca o início e preserva a duração útil", () => {
    const updates = rescheduleForCalendarChange([task()], base, withHoliday(WED));

    expect(updates).toHaveLength(1);
    expect(updates[0]!.start).toBe(THU);
    // 3 dias úteis (qua–sex) preservados a partir da quinta: qui, sex, seg
    expect(updates[0]!.finish).toBe(THU + 4 * DAY_MS);
  });

  it("feriado no meio estende o término sem mover o início", () => {
    const updates = rescheduleForCalendarChange([task()], base, withHoliday(THU));

    expect(updates).toHaveLength(1);
    expect(updates[0]!.start).toBe(WED);
    // qua, sex, seg (o feriado quinta pula e o fim de semana também)
    expect(updates[0]!.finish).toBe(FRI + 3 * DAY_MS);
  });

  it("dia útil especial em fim de semana encurta o trabalho", () => {
    // sexta a segunda: com o sábado útil, o mesmo trabalho cabe antes
    const sat = Date.UTC(2026, 0, 10);
    const weekendTask: RescheduleTask = { id: "t2", start: FRI, finish: FRI + 3 * DAY_MS };
    const updates = rescheduleForCalendarChange([weekendTask], base, withHoliday(sat, true));

    expect(updates).toHaveLength(1);
    expect(updates[0]!.start).toBe(FRI);
    expect(updates[0]!.finish).toBe(sat);
  });

  it("tarefas manuais e inativas são ignoradas", () => {
    const updates = rescheduleForCalendarChange(
      [
        task({ id: "manual", schedulingMode: "manual" }),
        task({ id: "inactive", isInactive: true }),
      ],
      base,
      withHoliday(WED),
    );

    expect(updates).toEqual([]);
  });

  it("marco mantém duração zero", () => {
    const updates = rescheduleForCalendarChange(
      [task({ start: WED, finish: WED, isMilestone: true })],
      base,
      withHoliday(WED),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]!.start).toBe(THU);
    expect(updates[0]!.finish).toBe(THU);
  });

  it("nada muda quando o calendário não afeta a tarefa", () => {
    const updates = rescheduleForCalendarChange([task()], base, base);
    expect(updates).toEqual([]);
  });
});
