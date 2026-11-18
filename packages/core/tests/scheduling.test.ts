import { describe, expect, it } from "bun:test";
import { DAY_MS, HOUR_MS, defaultCalendar, type Calendar } from "../src/calendar/calendar";
import { runSchedule } from "../src/scheduling/pipeline";
import type { ScheduleLinkInput, ScheduleTaskInput, SchedulingLinkType } from "../src/scheduling/types";

/**
 * 05/01/2026 é segunda-feira.
 * Convenção inclusive: `finish` é a meia-noite do último dia trabalhado —
 * uma tarefa de 1 dia começando na segunda termina na segunda.
 */
const MON = Date.UTC(2026, 0, 5);
const DAY = DAY_MS;
const WORKDAY = 9 * HOUR_MS; // turno padrão 09:00–18:00

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

function link(
  predecessorId: string,
  successorId: string,
  type: SchedulingLinkType = "fs",
  lagMs = 0,
): ScheduleLinkInput {
  return { id: `${predecessorId}->${successorId}`, predecessorId, successorId, type, lagMs };
}

describe("cadeias simples (forward/backward pass)", () => {
  it("encadeia FS com float zero e caminho crítico completo", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", { duration: WORKDAY }),
        task("c", { duration: WORKDAY }),
      ],
      links: [link("a", "b"), link("b", "c")],
    });

    expect(result.tasks.a).toMatchObject({
      start: MON,
      finish: MON,
      totalFloat: 0,
      freeFloat: 0,
      critical: true,
    });
    expect(result.tasks.b).toMatchObject({
      start: MON + DAY,
      finish: MON + DAY,
      totalFloat: 0,
      critical: true,
    });
    expect(result.tasks.c).toMatchObject({
      start: MON + 2 * DAY,
      finish: MON + 2 * DAY,
      totalFloat: 0,
      critical: true,
    });

    expect(result.criticalPath).toEqual(["a", "b", "c"]);
    expect(result.projectFinish).toBe(MON + 2 * DAY);
    expect(result.cycles).toEqual([]);
  });

  it("ressalta o ramo mais curto com float livre e total positivos", () => {
    // a (1 dia) e b (2 dias) convergem em c: a sobra folga
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", { duration: 2 * WORKDAY }),
        task("c", { duration: WORKDAY }),
      ],
      links: [link("a", "c"), link("b", "c")],
    });

    expect(result.tasks.c).toMatchObject({
      start: MON + 2 * DAY,
      finish: MON + 2 * DAY,
      critical: true,
    });
    expect(result.tasks.b).toMatchObject({
      start: MON,
      finish: MON + DAY,
      critical: true,
      totalFloat: 0,
    });
    expect(result.tasks.a).toMatchObject({
      start: MON,
      finish: MON,
      critical: false,
      totalFloat: WORKDAY,
      freeFloat: WORKDAY,
    });
  });

  it("aplica latência FS em dias úteis", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("a", { duration: WORKDAY }), task("b", { duration: WORKDAY })],
      links: [link("a", "b", "fs", 2 * WORKDAY)],
    });

    // a termina na segunda; latência de 2 dias úteis => b começa na quinta
    expect(result.tasks.a).toMatchObject({ start: MON, finish: MON });
    expect(result.tasks.b).toMatchObject({ start: MON + 3 * DAY, finish: MON + 3 * DAY });
  });

  it("marco tem duração zero e é crítico quando depende do projeto", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("m", { isMilestone: true, duration: 0 })],
      links: [],
    });

    expect(result.tasks.m).toMatchObject({
      start: MON,
      finish: MON,
      duration: 0,
      totalFloat: 0,
      critical: true,
    });
  });
});

describe("múltiplos caminhos críticos", () => {
  it("duas cadeias independentes de igual duração são ambas críticas", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", { duration: WORKDAY }),
        task("c", { duration: WORKDAY }),
        task("d", { duration: WORKDAY }),
      ],
      links: [link("a", "b"), link("c", "d")],
    });

    expect([...result.criticalPath].sort()).toEqual(["a", "b", "c", "d"]);
    for (const id of ["a", "b", "c", "d"]) {
      expect(result.tasks[id]!.critical).toBe(true);
      expect(result.tasks[id]!.totalFloat).toBe(0);
    }
    expect(result.projectFinish).toBe(MON + DAY);
  });

  it("três caminhos convergentes: só o mais longo é crítico no início", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", { duration: 2 * WORKDAY }),
        task("c", { duration: 3 * WORKDAY }),
        task("join", { duration: WORKDAY }),
      ],
      links: [link("a", "join"), link("b", "join"), link("c", "join")],
    });

    // o caminho mais longo (c, 3 dias) define o projeto; a e b ficam com float
    expect(result.tasks.join).toMatchObject({
      start: MON + 3 * DAY,
      finish: MON + 3 * DAY,
      critical: true,
    });
    expect(result.tasks.c).toMatchObject({ critical: true, totalFloat: 0 });
    expect(result.tasks.b!.critical).toBe(false);
    expect(result.tasks.b!.totalFloat).toBe(WORKDAY);
    expect(result.tasks.a!.critical).toBe(false);
    expect(result.tasks.a!.totalFloat).toBe(2 * WORKDAY);
  });
});

describe("etapas do pipeline", () => {
  it("exclui inativas sem alterar as datas delas nem as dos demais", () => {
    const future = MON + 100 * DAY;
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("off", { isInactive: true, duration: WORKDAY, start: future, finish: future }),
        task("on", { duration: WORKDAY }),
      ],
      links: [],
    });

    expect(result.tasks.off).toMatchObject({
      start: future,
      finish: future,
      excluded: "inactive",
      critical: false,
      totalFloat: null,
    });
    expect(result.tasks.on).toMatchObject({ start: MON, finish: MON });
  });

  it("calcula roll-up do resumo como mínimo/máximo dos filhos", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("p", { isSummary: true }),
        task("c1", { parentId: "p", duration: WORKDAY }),
        task("c2", { parentId: "p", duration: WORKDAY }),
      ],
      links: [link("c1", "c2")],
    });

    expect(result.order).toEqual(["c1", "c2", "p"]);
    expect(result.tasks.p).toMatchObject({
      start: MON,
      finish: MON + DAY,
      duration: 2 * WORKDAY,
    });
  });

  it("tarefa manual mantém as datas e as propaga aos sucessores", () => {
    const manual = Date.UTC(2026, 1, 2); // segunda, 02/02/2026
    const result = runSchedule({
      calendar: cal,
      projectStart: MON, // anterior à manual: não pode puxá-la
      tasks: [
        task("m", {
          schedulingMode: "manual",
          manualStart: manual,
          manualFinish: manual + 2 * DAY,
        }),
        task("s", { duration: WORKDAY }),
      ],
      links: [link("m", "s")],
    });

    expect(result.tasks.m).toMatchObject({ start: manual, finish: manual + 2 * DAY });
    expect(result.tasks.s).toMatchObject({
      start: manual + 2 * DAY + DAY, // dia seguinte ao término inclusive
      finish: manual + 2 * DAY + DAY,
    });
  });

  it("identifica ciclos sem parar o cálculo do restante", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY, start: MON, finish: MON }),
        task("b", { duration: WORKDAY, start: MON + DAY, finish: MON + DAY }),
        task("c", { duration: WORKDAY }),
      ],
      links: [link("a", "b"), link("b", "a")],
    });

    expect([...result.cycles].sort()).toEqual(["a", "b"]);
    expect(result.tasks.a).toMatchObject({ excluded: "cycle", critical: false, totalFloat: null });
    expect(result.tasks.b).toMatchObject({ excluded: "cycle", critical: false });
    expect(result.tasks.c).toMatchObject({ start: MON, finish: MON, critical: true });
  });

  it("marca como pendente a tarefa sem duração e sem datas", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("ph", { isPlaceholder: true })],
      links: [],
    });

    expect(result.tasks.ph).toMatchObject({
      start: null,
      finish: null,
      excluded: "pending",
      critical: false,
    });
  });

  it("expande recorrência semanal e desloca a ocorrência sobre feriado", () => {
    const holiday = MON + 7 * DAY; // segunda seguinte
    const calWithHoliday: Calendar = {
      ...cal,
      exceptions: [{ date: holiday, isWorking: false, name: "Feriado" }],
    };

    const result = runSchedule({
      calendar: calWithHoliday,
      projectStart: MON,
      tasks: [
        task("r", {
          duration: WORKDAY,
          start: MON,
          finish: MON + DAY,
          recurrence: JSON.stringify({ frequency: "weekly", interval: 1, count: 3 }),
        }),
      ],
      links: [],
    });

    expect(Object.keys(result.tasks).sort()).toEqual(["r", "r#2", "r#3"]);
    expect(result.tasks.r).toMatchObject({ start: MON, finish: MON });
    // segunda do feriado deslocada para terça; a seguinte permanece na segunda
    expect(result.tasks["r#2"]).toMatchObject({ start: holiday + DAY });
    expect(result.tasks["r#3"]).toMatchObject({ start: holiday + 7 * DAY });
  });
});

/** Acha o conflito de restrição de uma tarefa. */
function constraintConflict(
  conflicts: Array<{ taskId: string; kind: string; code: string; message: string }>,
  taskId: string,
) {
  return conflicts.find((conflict) => conflict.taskId === taskId && conflict.kind === "constraint");
}

describe("restrições de data (8 tipos)", () => {
  it("ASAP mantém o cálculo mais rápido possível, sem conflito", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", { duration: WORKDAY, constraintType: "asap" }),
      ],
      links: [link("a", "b")],
    });

    expect(result.tasks.b).toMatchObject({ start: MON + DAY, finish: MON + DAY });
    expect(result.conflicts).toEqual([]);
  });

  it("ALAP agenda do fim do projeto para trás", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: 3 * WORKDAY }),
        task("b", { duration: WORKDAY, constraintType: "alap" }),
      ],
      links: [],
    });

    // sem restrição, b começaria na segunda; com ALAP, vai para a quarta
    expect(result.tasks.a).toMatchObject({ start: MON, finish: MON + 2 * DAY });
    expect(result.tasks.b).toMatchObject({ start: MON + 2 * DAY, finish: MON + 2 * DAY });
    expect(result.projectFinish).toBe(MON + 2 * DAY);
    expect(result.conflicts).toEqual([]);
  });

  it("SNET adia o início e registra o conflito", () => {
    const friday = MON + 4 * DAY;
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", {
          duration: WORKDAY,
          constraintType: "snet",
          constraintDate: friday,
        }),
      ],
      links: [link("a", "b")],
    });

    // o vínculo daria início na terça; a restrição vence e leva para a sexta
    expect(result.tasks.b).toMatchObject({ start: friday, finish: friday });
    expect(constraintConflict(result.conflicts, "b")).toMatchObject({
      code: "constraint_wins",
      kind: "constraint",
    });
    expect(constraintConflict(result.conflicts, "b")!.message).toContain("Começar Não Antes De");
  });

  it("SNLT antecipa o início e registra o conflito", () => {
    const tuesday = MON + DAY;
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: 3 * WORKDAY }),
        task("b", {
          duration: WORKDAY,
          constraintType: "snlt",
          constraintDate: tuesday,
        }),
      ],
      links: [link("a", "b")],
    });

    // o vínculo daria início na quinta; a restrição puxa para a terça
    expect(result.tasks.b).toMatchObject({ start: tuesday, finish: tuesday });
    expect(constraintConflict(result.conflicts, "b")).toMatchObject({ code: "constraint_wins" });
  });

  it("FNET adia o término e registra o conflito", () => {
    const friday = MON + 4 * DAY;
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", {
          duration: WORKDAY,
          constraintType: "fnet",
          constraintDate: friday,
        }),
      ],
      links: [link("a", "b")],
    });

    // o término calculado seria terça; a restrição leva para a sexta
    expect(result.tasks.b).toMatchObject({ start: friday, finish: friday });
    expect(constraintConflict(result.conflicts, "b")).toMatchObject({ code: "constraint_wins" });
  });

  it("FNLT antecipa o término e registra o conflito", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", {
          duration: WORKDAY,
          constraintType: "fnlt",
          constraintDate: MON,
        }),
      ],
      links: [link("a", "b")],
    });

    // o término calculado seria terça; a restrição puxa para a segunda
    expect(result.tasks.b).toMatchObject({ start: MON, finish: MON });
    expect(constraintConflict(result.conflicts, "b")).toMatchObject({ code: "constraint_wins" });
  });

  it("Deve Começar Em fixa o início na data da restrição", () => {
    const thursday = MON + 3 * DAY;
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", {
          duration: WORKDAY,
          constraintType: "must_start_on",
          constraintDate: thursday,
        }),
      ],
      links: [link("a", "b")],
    });

    expect(result.tasks.b).toMatchObject({ start: thursday, finish: thursday });
    expect(constraintConflict(result.conflicts, "b")).toMatchObject({ code: "constraint_wins" });
  });

  it("Deve Terminar Em fixa o término na data da restrição", () => {
    const thursday = MON + 3 * DAY;
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", {
          duration: WORKDAY,
          constraintType: "must_finish_on",
          constraintDate: thursday,
        }),
      ],
      links: [link("a", "b")],
    });

    expect(result.tasks.b).toMatchObject({ start: thursday, finish: thursday });
    expect(constraintConflict(result.conflicts, "b")).toMatchObject({ code: "constraint_wins" });
  });

  it("registra o conflito do ciclo por vínculo", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("a", { duration: WORKDAY }), task("b", { duration: WORKDAY })],
      links: [link("a", "b"), link("b", "a")],
    });

    const cycle = result.conflicts.filter((conflict) => conflict.kind === "cycle");
    expect(cycle).toHaveLength(2);
    expect(cycle[0]!.code).toBe("dependency_cycle");
  });
});

describe("prazos (deadlines)", () => {
  it("registra conflito quando o término calculado excede o prazo", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("t", { duration: 3 * WORKDAY, deadline: MON + DAY })],
      links: [],
    });

    expect(result.tasks.t).toMatchObject({ finish: MON + 2 * DAY });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      taskId: "t",
      kind: "deadline",
      code: "deadline_exceeded",
    });
    expect(result.conflicts[0]!.message).toContain("excede o prazo");
  });

  it("não registra conflito quando o prazo é atendido", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("t", { duration: WORKDAY, deadline: MON + 5 * DAY })],
      links: [],
    });

    expect(result.conflicts).toEqual([]);
  });
});

describe("tipos de tarefa e esforço (duração × unidades × trabalho)", () => {
  it("duração fixa mantém a duração e deriva o trabalho", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("t", { taskType: "fixed_duration", duration: 2 * WORKDAY })],
      links: [],
      units: { t: 2 },
    });

    expect(result.tasks.t).toMatchObject({
      start: MON,
      finish: MON + DAY,
      duration: 2 * WORKDAY,
      work: 4 * WORKDAY, // duração × unidades
    });
  });

  it("trabalho fixo com mais unidades reduz a duração", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("t", { taskType: "fixed_work", work: 2 * WORKDAY })],
      links: [],
      units: { t: 2 },
    });

    expect(result.tasks.t).toMatchObject({
      start: MON,
      finish: MON,
      duration: WORKDAY, // trabalho / unidades
      work: 2 * WORKDAY, // trabalho preservado
    });
  });

  it("unidades fixas preservam as unidades e derivam o trabalho", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("t", { taskType: "fixed_units", duration: WORKDAY })],
      links: [],
      units: { t: 0.5 },
    });

    expect(result.tasks.t).toMatchObject({
      duration: WORKDAY,
      work: WORKDAY * 0.5, // duração × unidades
    });
  });

  it("sem unidades informadas usa 1 como padrão", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("t", { taskType: "fixed_work", work: 2 * WORKDAY })],
      links: [],
    });

    expect(result.tasks.t).toMatchObject({ duration: 2 * WORKDAY, work: 2 * WORKDAY });
  });

  it("soma o trabalho dos filhos no resumo", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("p", { isSummary: true }),
        task("c1", { parentId: "p", taskType: "fixed_duration", duration: WORKDAY }),
        task("c2", { parentId: "p", taskType: "fixed_duration", duration: WORKDAY }),
      ],
      links: [],
      units: { c1: 1, c2: 2 },
    });

    expect(result.tasks.p).toMatchObject({ work: WORKDAY + 2 * WORKDAY });
  });
});

describe("tarefas inativas (specs/scheduling)", () => {
  it("não entram no roll-up do resumo", () => {
    const long = MON + 10 * DAY;
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("p", { isSummary: true }),
        task("c1", { parentId: "p", duration: WORKDAY }),
        task("c2", { parentId: "p", isInactive: true, duration: 5 * WORKDAY, start: long, finish: long + 4 * DAY }),
      ],
      links: [],
    });

    // o resumo acompanha apenas o filho ativo
    expect(result.tasks.p).toMatchObject({ start: MON, finish: MON });
    expect(result.tasks.c2).toMatchObject({ excluded: "inactive", critical: false });
  });

  it("não entram no caminho crítico nem atrasam os dependentes", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY }),
        task("b", { isInactive: true, duration: 5 * WORKDAY, start: MON, finish: MON + 4 * DAY }),
        task("c", { duration: WORKDAY }),
      ],
      links: [link("a", "b"), link("b", "c")],
    });

    // sem a inativa, a e c são independentes e começam no início do projeto
    expect(result.tasks.a).toMatchObject({ start: MON, critical: true });
    expect(result.tasks.c).toMatchObject({ start: MON, critical: true });
    expect([...result.criticalPath].sort()).toEqual(["a", "c"]);
    expect(result.tasks.b).toMatchObject({ excluded: "inactive", critical: false });
  });
});

describe("tarefas de espaço reservado (placeholders)", () => {
  it("só com nome fica pendente sem bloquear o restante", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("ph", { isPlaceholder: true }),
        task("s", { duration: WORKDAY }),
        task("t", { duration: WORKDAY }),
      ],
      links: [link("ph", "s")],
    });

    expect(result.tasks.ph).toMatchObject({
      start: null,
      finish: null,
      excluded: "pending",
      critical: false,
    });
    // o sucessor do placeholder não é bloqueado: segue pelo início do projeto
    expect(result.tasks.s).toMatchObject({ start: MON, finish: MON });
    expect(result.tasks.t).toMatchObject({ start: MON });
  });

  it("mantém o início informado e marca o término como pendente", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("ph", { isPlaceholder: true, start: MON + 2 * DAY })],
      links: [],
    });

    expect(result.tasks.ph).toMatchObject({
      start: MON + 2 * DAY,
      finish: null,
      excluded: "pending",
    });
  });
});

describe("roll-up top-down (resumo com datas manuais)", () => {
  it("as datas manuais do resumo vencem o roll-up e sinalizam a divergência", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("p", { isSummary: true, manualStart: MON + 3 * DAY, manualFinish: MON + 4 * DAY }),
        task("c1", { parentId: "p", duration: WORKDAY }),
      ],
      links: [],
    });

    expect(result.tasks.p).toMatchObject({ start: MON + 3 * DAY, finish: MON + 4 * DAY });
    // o rollup registrado é o dos filhos, com a divergência sinalizada
    expect(result.rollups.p).toEqual({
      start: MON,
      finish: MON,
      divergent: true,
    });
  });

  it("datas manuais iguais ao roll-up não são divergentes", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("p", { isSummary: true, manualStart: MON, manualFinish: MON }),
        task("c1", { parentId: "p", duration: WORKDAY }),
      ],
      links: [],
    });

    expect(result.tasks.p).toMatchObject({ start: MON, finish: MON });
    expect(result.rollups.p).toEqual({ start: MON, finish: MON, divergent: false });
  });
});

describe("splits (divisão de tarefas)", () => {
  const segments = JSON.stringify([
    { start: MON, finish: MON },
    { start: MON + 3 * DAY, finish: MON + 3 * DAY },
  ]);

  it("soma a duração útil dos segmentos e mantém o intervalo fora", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("sp", { duration: WORKDAY, segments })],
      links: [],
    });

    expect(result.tasks.sp).toMatchObject({
      start: MON,
      finish: MON + 3 * DAY,
      duration: 2 * WORKDAY, // intervalo de 1 dia não computado
    });
  });

  it("propaga o término dos segmentos ao sucessor", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("sp", { segments }), task("s", { duration: WORKDAY })],
      links: [link("sp", "s")],
    });

    expect(result.tasks.s).toMatchObject({ start: MON + 4 * DAY, finish: MON + 4 * DAY });
  });

  it("rejeita JSON de segmentos inválido e cai no cálculo normal", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("sp", { duration: WORKDAY, segments: "não é json" })],
      links: [],
    });

    expect(result.tasks.sp).toMatchObject({ start: MON, finish: MON });
  });
});

describe("recorrência com fim por data", () => {
  it("expande enquanto a ocorrência cabe no endDate", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("r", {
          duration: WORKDAY,
          start: MON,
          finish: MON + DAY,
          recurrence: JSON.stringify({ frequency: "daily", interval: 1, endDate: MON + 2 * DAY }),
        }),
      ],
      links: [],
    });

    expect(Object.keys(result.tasks).sort()).toEqual(["r", "r#2", "r#3"]);
    expect(result.tasks["r#3"]).toMatchObject({ start: MON + 2 * DAY });
  });
});

describe("tipos de vínculo (FS, SS, FF, SF)", () => {
  const predecessor = () => task("p", { duration: 2 * WORKDAY }); // seg–ter

  it("SS: o sucessor não começa antes do predecessor", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [predecessor(), task("s", { duration: WORKDAY })],
      links: [link("p", "s", "ss")],
    });

    // ambos começam na segunda; o sucessor termina no mesmo dia
    expect(result.tasks.p).toMatchObject({ start: MON, finish: MON + DAY });
    expect(result.tasks.s).toMatchObject({ start: MON, finish: MON });
  });

  it("FF: o sucessor não termina antes do predecessor", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [predecessor(), task("s", { duration: WORKDAY })],
      links: [link("p", "s", "ff")],
    });

    // termina junto com o predecessor (terça) — não antes
    expect(result.tasks.p).toMatchObject({ start: MON, finish: MON + DAY });
    expect(result.tasks.s).toMatchObject({ start: MON + DAY, finish: MON + DAY });
  });

  it("SF: o sucessor não termina antes do início do predecessor", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [predecessor(), task("s", { duration: WORKDAY })],
      links: [link("p", "s", "sf")],
    });

    // termina na segunda (dia em que o predecessor começa)
    expect(result.tasks.s).toMatchObject({ start: MON, finish: MON });
    expect(result.tasks.p).toMatchObject({ start: MON, finish: MON + DAY });
  });

  it("FS: o sucessor não começa antes do término do predecessor", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [predecessor(), task("s", { duration: WORKDAY })],
      links: [link("p", "s", "fs")],
    });

    expect(result.tasks.s).toMatchObject({ start: MON + 2 * DAY, finish: MON + 2 * DAY });
  });
});

describe("origem das tarefas sem predecessor", () => {
  it("sem predecessor respeita a data inicial informada (maior que o início do projeto)", () => {
    const late = MON + 4 * DAY;
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [task("solo", { duration: WORKDAY, start: late, finish: late })],
      links: [],
    });

    expect(result.tasks.solo).toMatchObject({ start: late, finish: late });
  });

  it("com predecessor os vínculos vencem a data inicial", () => {
    const late = MON + 6 * DAY;
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("p", { duration: WORKDAY }),
        task("s", { duration: WORKDAY, start: late, finish: late }),
      ],
      links: [link("p", "s")],
    });

    // o vínculo daria início na terça; a data inicial não segura a tarefa
    expect(result.tasks.s).toMatchObject({ start: MON + DAY, finish: MON + DAY });
  });
});

describe("Task Inspector: cadeia condutora e motivos", () => {
  it("identifica o predecessor determinante entre três candidatos", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: 3 * WORKDAY, name: "Condutora A" }),
        task("b", { duration: WORKDAY, name: "Com folga B" }),
        task("c", { duration: 2 * WORKDAY, name: "Com folga C" }),
        task("x", { duration: WORKDAY, name: "Alvo X" }),
      ],
      links: [link("a", "x"), link("b", "x"), link("c", "x")],
    });

    // a é a mais tardia (termina quarta) e define o início de x na quinta
    expect(result.tasks.x).toMatchObject({ start: MON + 3 * DAY });
    expect(result.chains.x).toEqual(["a"]);
    expect(result.reasons.x).toMatchObject({
      source: "predecessor",
      predecessorId: "a",
      linkType: "fs",
    });
    expect(result.reasons.x!.text).toContain("Condutora A");

    // só a condutora tem float total zero
    expect(result.tasks.a!.totalFloat).toBe(0);
    expect(result.tasks.b!.totalFloat).toBeGreaterThan(0);
    expect(result.tasks.c!.totalFloat).toBeGreaterThan(0);

    // a origem do cálculo é o início do projeto
    expect(result.reasons.a).toMatchObject({ source: "project", predecessorId: null });
    expect(result.reasons.a!.text).toContain("Início do projeto");
  });

  it("encadeia a cadeia condutora até a origem", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("a", { duration: WORKDAY, name: "Origem" }),
        task("b", { duration: WORKDAY, name: "Meio" }),
        task("c", { duration: WORKDAY, name: "Fim" }),
      ],
      links: [link("a", "b"), link("b", "c")],
    });

    expect(result.chains.c).toEqual(["b", "a"]);
    expect(result.chains.b).toEqual(["a"]);
    expect(result.chains.a).toEqual([]);
    expect(result.reasons.c!.predecessorId).toBe("b");
  });

  it("explica roll-up, tarefa manual e restrição vencedora", () => {
    const result = runSchedule({
      calendar: cal,
      projectStart: MON,
      tasks: [
        task("p", { isSummary: true, name: "Fase" }),
        task("c1", { parentId: "p", duration: WORKDAY, name: "Filho" }),
        task("m", {
          schedulingMode: "manual",
          manualStart: MON + 5 * DAY,
          manualFinish: MON + 5 * DAY,
          name: "Manual",
        }),
        task("s", {
          duration: WORKDAY,
          constraintType: "snet",
          constraintDate: MON + 3 * DAY,
          name: "Restrita",
        }),
      ],
      links: [link("c1", "s")],
    });

    expect(result.reasons.p).toMatchObject({ source: "rollup" });
    expect(result.reasons.p!.text).toContain("Roll-up");
    expect(result.reasons.m).toMatchObject({ source: "manual" });
    expect(result.reasons.s).toMatchObject({ source: "constraint", predecessorId: null });
    expect(result.reasons.s!.text).toContain("Começar Não Antes De");
    // a restrição venceu: a cadeia condutora termina nela
    expect(result.chains.s).toEqual([]);
  });
});
