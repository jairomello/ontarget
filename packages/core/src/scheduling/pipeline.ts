/**
 * Pipeline de agendamento (docs/architecture.md §8.3, etapas 1–7):
 *
 *  1. expandir recorrências
 *  2. excluir inativas do cálculo
 *  3. grafo de dependências (ordem topológica; ciclos identificados)
 *  4. roll-up de resumos (mín/máx dos descendentes ativos)
 *  5. forward pass (CPM com calendário, restrições e tipos de tarefa)
 *  6. backward pass (late start/finish)
 *  7. float total/livre, caminho crítico e conflitos
 *
 * Convenções:
 *  - datas em epoch ms UTC-naive; `finish` é **inclusive** (meia-noite do
 *    último dia trabalhado — tarefa seg–sex termina na sexta);
 *  - início automático sempre na meia-noite de um dia útil;
 *  - agendamento dia-granular: lags sub-dia são absorvidos na data;
 *  - tarefa manual mantém as datas do usuário e as propaga aos sucessores;
 *  - `alap` é resolvido em passada própria, do fim do projeto para trás;
 *  - função pura: sem I/O, sem DOM, sem estado.
 */
import {
  DAY_MS,
  addWorkingTime,
  durationBetween,
  isWorkingDay,
  startOfDay,
  subtractWorkingTime,
  workingWindow,
  type Calendar,
} from "../calendar/calendar";
import { formatDateInput } from "../values/parse";
import { buildGraph } from "./graph";
import { expandRecurrences } from "./recurrence";
import type {
  ScheduleConflict,
  ScheduleExclusion,
  ScheduleLinkInput,
  ScheduleOptions,
  ScheduleReason,
  ScheduleResult,
  ScheduleRollup,
  ScheduleTaskInput,
  ScheduledTask,
} from "./types";

/** Prefixo dos vínculos usados apenas para ordenar roll-up (não entram no CPM). */
const ORDER_ONLY_PREFIX = "#rollup#";

const CONSTRAINT_LABELS: Record<string, string> = {
  asap: "O mais rápido possível (ASAP)",
  alap: "O mais tarde possível (ALAP)",
  snet: "Começar Não Antes De",
  snlt: "Começar Não Depois De",
  fnet: "Terminar Não Antes De",
  fnlt: "Terminar Não Depois De",
  must_start_on: "Deve Começar Em",
  must_finish_on: "Deve Terminar Em",
};

interface Dated {
  start: number;
  finish: number;
  duration: number;
  work: number;
}

/** Vínculo que determina um candidato de data (Task Inspector). */
interface LinkDriver {
  predecessorId: string;
  linkType: ScheduleReason["linkType"];
  lagMs: number;
}

/* -------------------------------------------------------------------------- */
/* Alinhamento de datas                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Início mais cedo: meia-noite do primeiro dia útil em ou após `instant`.
 * Se o turno do dia já terminou, o trabalho seguinte é no dia útil seguinte.
 */
function earliestStart(cal: Calendar, instant: number): number {
  let day = startOfDay(instant);
  const window = workingWindow(cal, day);
  if (window && instant >= window.end) day += DAY_MS;
  return nextWorkingDay(cal, day, +1);
}

/**
 * Término **inclusive**: meia-noite do último dia trabalhado (conv. do
 * produto — a tarefa seg–sex termina na sexta). `addWorkingTime` nunca
 * devolve meia-noite, então o arredondamento para baixo é seguro.
 */
function finishOf(instant: number): number {
  return startOfDay(instant);
}

/** Dia útil em ou antes de `day` (limites do backward pass). */
function previousWorkingDay(cal: Calendar, day: number): number {
  return nextWorkingDay(cal, day, -1);
}

function nextWorkingDay(cal: Calendar, day: number, step: 1 | -1): number {
  let guard = 0;
  while (!isWorkingDay(cal, day) && guard < 4_000) {
    day += step * DAY_MS;
    guard += 1;
  }
  return day;
}

/** Aplica latência (positiva ou negativa) a um instante, em tempo útil. */
function applyLag(cal: Calendar, instant: number, lag: number): number {
  if (lag === 0) return instant;
  return lag > 0
    ? addWorkingTime(cal, instant, lag)
    : subtractWorkingTime(cal, instant, -lag);
}

/** Limite máximo de término para FS: `limit` menos a latência e um dia. */
function latestFinishFromStartLimit(cal: Calendar, limit: number, lag: number): number {
  return startOfDay(applyLag(cal, limit - DAY_MS, -lag));
}

/** Limite máximo de término para FF: `limit` menos a latência. */
function latestFinishBound(cal: Calendar, limit: number, lag: number): number {
  return startOfDay(applyLag(cal, limit, -lag));
}

/** Limite máximo de início (SS/SF): dia útil em ou antes do limite. */
function latestStartLimit(cal: Calendar, limit: number, lag: number): number {
  return previousWorkingDay(cal, startOfDay(applyLag(cal, limit, -lag)));
}

/* -------------------------------------------------------------------------- */
/* Duração, trabalho e unidades                                                */
/* -------------------------------------------------------------------------- */

/** Calendário aplicável a uma tarefa: o próprio, ou o do projeto. */
function taskCalendar(task: ScheduleTaskInput, options: ScheduleOptions): Calendar {
  const id = task.calendarId;
  return (id ? options.calendars?.[id] : null) ?? options.calendar;
}

/** Unidades da tarefa (soma das atribuições); padrão 1. */
function unitsOf(options: ScheduleOptions, id: string): number {
  const value = options.units?.[id];
  return value !== undefined && value > 0 ? value : 1;
}

/**
 * Duração útil da tarefa conforme o tipo (specs/scheduling — "Tipos de
 * tarefa e esforço"): trabalho fixo deriva `duração = trabalho / unidades`;
 * `null` quando não há como calcular (pendente).
 */
function effectiveDuration(
  cal: Calendar,
  task: ScheduleTaskInput,
  units: number,
): number | null {
  const plannedWork = task.work ?? null;
  if (task.taskType === "fixed_work" && plannedWork !== null && plannedWork > 0 && units > 0) {
    return plannedWork / units;
  }
  if (task.duration !== null) return Math.max(0, task.duration);
  if (task.isMilestone) return 0;

  const start = task.start ?? task.manualStart;
  const finish = task.finish ?? task.manualFinish;
  if (start !== null && finish !== null && finish >= start) {
    // término inclusive: soma o último dia à janela
    return durationBetween(cal, start, finish + DAY_MS);
  }
  return null;
}

/** Trabalho derivado: `duração × unidades` (ou o trabalho fixo informado). */
function workOf(task: ScheduleTaskInput, duration: number, units: number): number {
  const plannedWork = task.work ?? null;
  if (task.taskType === "fixed_work" && plannedWork !== null && plannedWork > 0) return plannedWork;
  return duration * units;
}

/** Datas fixas de uma tarefa manual (imune ao cálculo). */
function manualDates(
  cal: Calendar,
  task: ScheduleTaskInput,
  units: number,
): Dated | null {
  if (task.schedulingMode !== "manual") return null;

  const start = task.manualStart ?? task.start;
  const finish = task.manualFinish ?? task.finish;
  if (start === null) return null;

  const duration = effectiveDuration(cal, task, units) ?? 0;
  const end = finish ?? (duration > 0 ? finishOf(addWorkingTime(cal, start, duration)) : start);
  const safeFinish = Math.max(end, start);
  return { start, finish: safeFinish, duration, work: workOf(task, duration, units) };
}

/* -------------------------------------------------------------------------- */
/* Splits (segmentos de tarefa)                                                */
/* -------------------------------------------------------------------------- */

interface Segment {
  start: number;
  finish: number;
}

/** Interpreta `Task.segments` (JSON de `[{"start", "finish"}, …]`). */
export function parseSegments(raw: string | null | undefined): Segment[] | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const segments: Segment[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return null;
    const { start, finish } = entry as { start?: unknown; finish?: unknown };
    if (typeof start !== "number" || typeof finish !== "number" || finish < start) return null;
    segments.push({ start, finish });
  }

  segments.sort((a, b) => a.start - b.start);
  return segments;
}

/**
 * Datas de uma tarefa dividida (specs/scheduling — "Divisão de tarefas"):
 * os segmentos fixam início/término e a duração é a soma do tempo útil de
 * cada segmento — o intervalo não útil entre eles não é computado.
 */
function segmentedDates(
  cal: Calendar,
  task: ScheduleTaskInput,
  units: number,
): Dated | null {
  const segments = parseSegments(task.segments);
  if (!segments) return null;

  let start = Number.POSITIVE_INFINITY;
  let finish = Number.NEGATIVE_INFINITY;
  let duration = 0;

  for (const segment of segments) {
    if (segment.start < start) start = segment.start;
    if (segment.finish > finish) finish = segment.finish;
    duration += durationBetween(cal, segment.start, segment.finish + DAY_MS);
  }

  return { start, finish, duration, work: workOf(task, duration, units) };
}

/**
 * Datas manuais de um resumo em planejamento top-down: vencem o roll-up
 * (specs/task-structure — "Resumo top-down divergente").
 */
function summaryManualDates(
  cal: Calendar,
  task: ScheduleTaskInput,
  units: number,
  childrenDates: Dated | null,
): Dated | null {
  if (task.manualStart === null && task.manualFinish === null) return null;

  const both = task.manualStart !== null && task.manualFinish !== null;
  const duration = both
    ? durationBetween(cal, task.manualStart!, task.manualFinish! + DAY_MS)
    : (effectiveDuration(cal, task, units) ?? childrenDates?.duration ?? 0);

  let start = task.manualStart;
  let finish = task.manualFinish;

  if (start === null && finish !== null) {
    start = startOfDay(subtractWorkingTime(cal, finish, duration));
  }
  if (finish === null && start !== null) {
    finish = duration === 0 ? start : finishOf(addWorkingTime(cal, start, duration));
  }
  if (start === null || finish === null) return null;

  const safeFinish = Math.max(finish, start);
  return {
    start,
    finish: safeFinish,
    duration,
    work: childrenDates?.work ?? workOf(task, duration, units),
  };
}

/* -------------------------------------------------------------------------- */
/* Restrições de data (specs/scheduling — "Restrições de data")                */
/* -------------------------------------------------------------------------- */

/** Início cujo término inclusive é `finishDay` (marcos: próprio dia). */
function startEndingAt(cal: Calendar, finishDay: number, duration: number): number {
  if (duration === 0) return finishDay;
  return startOfDay(subtractWorkingTime(cal, finishDay + DAY_MS, duration));
}

interface ConstraintOutcome {
  start: number;
  finish: number;
  conflict: string | null;
}

/**
 * Aplica a restrição da tarefa sobre o início calculado. Toda restrição que
 * altera a data derivada de vínculos/projeto registra um conflito
 * (specs/scheduling — "Restrição vence o cálculo" e "Restrição conflitante").
 */
function applyConstraint(
  cal: Calendar,
  task: ScheduleTaskInput,
  start: number,
  duration: number,
  /** Início que o cálculo daria sem o piso da data inicial (links/projeto). */
  derivedStart: number,
): ConstraintOutcome {
  const computeFinish = (value: number) =>
    duration === 0 ? value : finishOf(addWorkingTime(cal, value, duration));

  const type = task.constraintType;
  const date = task.constraintDate;
  if (
    !type ||
    type === "asap" ||
    type === "alap" ||
    date === null ||
    date === undefined
  ) {
    return { start, finish: computeFinish(start), conflict: null };
  }

  const label = CONSTRAINT_LABELS[type] ?? type;
  const formatted = formatDateInput(date);
  let nextStart = start;
  let conflict: string | null = null;

  switch (type) {
    case "snet": {
      const floor = earliestStart(cal, date);
      if (floor > nextStart) {
        nextStart = floor;
        conflict = `${label} em ${formatted} vence o cálculo e adia o início`;
      }
      break;
    }
    case "snlt": {
      const cap = previousWorkingDay(cal, startOfDay(date));
      if (nextStart > cap) {
        nextStart = cap;
        conflict = `${label} em ${formatted} antecipa o início calculado`;
      }
      break;
    }
    case "fnet": {
      // término inclusive: a data escolhida é o próprio último dia desejado
      const required = earliestStart(cal, date);
      if (computeFinish(nextStart) < required) {
        nextStart = startEndingAt(cal, required, duration);
        conflict = `${label} em ${formatted} adia o término calculado`;
      }
      break;
    }
    case "fnlt": {
      const cap = previousWorkingDay(cal, startOfDay(date));
      if (computeFinish(nextStart) > cap) {
        nextStart = startEndingAt(cal, cap, duration);
        conflict = `${label} em ${formatted} antecipa o término calculado`;
      }
      break;
    }
    case "must_start_on": {
      // exata: compara com o que o cálculo daria — a restrição vence mesmo
      // quando a data armazenada já está nela (o conflito é estável)
      const forced = earliestStart(cal, date);
      const derived = earliestStart(cal, derivedStart);
      if (forced !== derived) {
        conflict = `${label} ${formatted} vence o cálculo`;
      }
      nextStart = forced;
      break;
    }
    case "must_finish_on": {
      const forced = earliestStart(cal, date);
      const derived = duration === 0
        ? earliestStart(cal, derivedStart)
        : finishOf(addWorkingTime(cal, earliestStart(cal, derivedStart), duration));
      if (forced !== derived) {
        conflict = `${label} ${formatted} vence o cálculo`;
      }
      nextStart = startEndingAt(cal, forced, duration);
      break;
    }
    default:
      break;
  }

  return { start: nextStart, finish: computeFinish(nextStart), conflict };
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                    */
/* -------------------------------------------------------------------------- */

export function runSchedule(options: ScheduleOptions): ScheduleResult {
  // Recálculo incremental: só a cadeia afetada; qualquer sinal de risco
  // (ciclo, envelope do projeto, grafo desconhecido) cai no completo.
  const incremental = options.incremental;
  if (incremental) {
    const planned = planIncremental(options, incremental);
    if (planned) {
      const subset = runSchedule({
        tasks: planned.tasks,
        links: planned.links,
        calendar: options.calendar,
        calendars: options.calendars,
        projectStart: incremental.baseline.projectStart,
        projectEnd: incremental.baseline.projectFinish,
        units: options.units,
      });
      const stitched = stitchIncremental(incremental.baseline, subset, planned.affected);
      if (stitched) return stitched;
    }
    return runSchedule({ ...options, incremental: undefined });
  }

  const cal = options.calendar;
  const conflicts: ScheduleConflict[] = [];

  // 1. expandir recorrências
  const expanded = expandRecurrences(options.tasks, cal);

  // 2. inativas ficam de fora do cálculo, com os dados preservados
  const active = expanded.filter((task) => !task.isInactive);
  const byId = new Map(active.map((task) => [task.id, task]));

  const children = new Map<string, string[]>();
  for (const task of active) {
    if (!task.parentId) continue;
    const list = children.get(task.parentId);
    if (list) list.push(task.id);
    else children.set(task.parentId, [task.id]);
  }

  // Arestas de ordenação: resumo sempre depois dos filhos (roll-up).
  const orderLinks: ScheduleLinkInput[] = [];
  for (const task of active) {
    if (!task.parentId || !byId.has(task.parentId)) continue;
    orderLinks.push({
      id: `${ORDER_ONLY_PREFIX}${task.id}->${task.parentId}`,
      predecessorId: task.id,
      successorId: task.parentId,
      type: "fs",
      lagMs: 0,
    });
  }
  const isOrderOnly = (link: ScheduleLinkInput) => link.id.startsWith(ORDER_ONLY_PREFIX);

  // 3. grafo (topologia estável; ciclos identificados, cálculo segue)
  const graph = buildGraph(
    active.map((task) => task.id),
    [...options.links, ...orderLinks],
  );

  const seedStarts = active
    .map((task) => task.start ?? task.manualStart)
    .filter((value): value is number => value !== null);
  const projectStart =
    options.projectStart ??
    (seedStarts.length > 0 ? Math.min(...seedStarts) : startOfDay(Date.now()));

  const early = new Map<string, Dated>();
  const late = new Map<string, Dated>();
  const rollupByTask = new Map<string, ScheduleRollup>();
  const reasons = new Map<string, ScheduleReason>();
  const excluded = new Map<string, ScheduleExclusion>();
  for (const id of graph.cyclic) excluded.set(id, "cycle");

  /** Registra o roll-up de um resumo e a divergência do top-down. */
  const recordRollup = (id: string, own: Dated, childrenDates: Dated | null): void => {
    if (!childrenDates) {
      rollupByTask.set(id, { start: own.start, finish: own.finish, divergent: false });
      return;
    }
    rollupByTask.set(id, {
      start: childrenDates.start,
      finish: childrenDates.finish,
      divergent: childrenDates.start !== own.start || childrenDates.finish !== own.finish,
    });
  };

  /** Candidatos de início/término vindos dos vínculos de um nó. */
  const fromPredecessors = (
    id: string,
    cal: Calendar,
  ): {
    startCand: number | null;
    finishCand: number | null;
    startDriver: LinkDriver | null;
    finishDriver: LinkDriver | null;
  } => {
    let startCand: number | null = null;
    let finishCand: number | null = null;
    let startDriver: LinkDriver | null = null;
    let finishDriver: LinkDriver | null = null;

    for (const link of graph.predecessors.get(id) ?? []) {
      if (isOrderOnly(link)) continue;
      const pred = early.get(link.predecessorId);
      if (!pred) continue;
      const driver: LinkDriver = {
        predecessorId: link.predecessorId,
        linkType: link.type,
        lagMs: link.lagMs,
      };

      if (link.type === "fs") {
        // `finish` inclusive: o sucessor começa no dia útil seguinte + latência
        const value = earliestStart(cal, applyLag(cal, pred.finish + DAY_MS, link.lagMs));
        if (startCand === null || value > startCand) {
          startCand = value;
          startDriver = driver;
        }
      } else if (link.type === "ss") {
        const value = earliestStart(cal, applyLag(cal, pred.start, link.lagMs));
        if (startCand === null || value > startCand) {
          startCand = value;
          startDriver = driver;
        }
      } else if (link.type === "ff") {
        // término inclusive: latência zero mantém o mesmo dia
        const value =
          link.lagMs === 0
            ? pred.finish
            : earliestStart(cal, applyLag(cal, pred.finish, link.lagMs));
        if (finishCand === null || value > finishCand) {
          finishCand = value;
          finishDriver = driver;
        }
      } else {
        const value =
          link.lagMs === 0
            ? pred.start
            : earliestStart(cal, applyLag(cal, pred.start, link.lagMs));
        if (finishCand === null || value > finishCand) {
          finishCand = value;
          finishDriver = driver;
        }
      }
    }

    return { startCand, finishCand, startDriver, finishDriver };
  };

  /** Forward pass; `deferAlap` adia as alap para a passada própria. */
  const forwardPass = (deferAlap: boolean, pinned: Map<string, Dated>): void => {
    for (const id of graph.order) {
      const task = byId.get(id)!;
      const units = unitsOf(options, id);
      const isSummary = task.isSummary;
      const tcal = taskCalendar(task, options);
      const childrenDates = isSummary ? rollup(tcal, children.get(id), early) : null;

      const pinnedFixed = pinned.get(id);
      const manualFixed = manualDates(tcal, task, units);
      const fixed = pinnedFixed ?? manualFixed ?? segmentedDates(tcal, task, units);
      if (fixed) {
        early.set(id, fixed);
        reasons.set(
          id,
          pinnedFixed
            ? {
                source: "constraint",
                predecessorId: null,
                linkType: null,
                lagMs: 0,
                text: `O mais tarde possível (ALAP): agendado do fim do projeto (${formatDateInput(projectEnd0)}) para trás.`,
              }
            : manualFixed
              ? {
                  source: "manual",
                  predecessorId: null,
                  linkType: null,
                  lagMs: 0,
                  text: "Tarefa manual: datas definidas pelo usuário.",
                }
              : {
                  source: "segments",
                  predecessorId: null,
                  linkType: null,
                  lagMs: 0,
                  text: "Tarefa dividida (splits): datas definidas pelos segmentos.",
                },
        );
        if (isSummary) recordRollup(id, fixed, childrenDates);
        continue;
      }

      if (deferAlap && task.schedulingMode === "auto" && task.constraintType === "alap") {
        continue;
      }

      if (isSummary) {
        // Roll-up top-down (specs/scheduling — "Roll-up de tarefas-resumo"):
        // datas manuais do resumo vencem o roll-up dos filhos ativos.
        const topDown = summaryManualDates(tcal, task, units, childrenDates);
        if (topDown) {
          early.set(id, topDown);
          recordRollup(id, topDown, childrenDates);
          reasons.set(id, {
            source: "manual",
            predecessorId: null,
            linkType: null,
            lagMs: 0,
            text: "Resumo com datas manuais (top-down): prevalecem sobre o roll-up dos filhos.",
          });
          continue;
        }

        if (childrenDates) {
          early.set(id, childrenDates);
          recordRollup(id, childrenDates, childrenDates);
          reasons.set(id, {
            source: "rollup",
            predecessorId: null,
            linkType: null,
            lagMs: 0,
            text: "Roll-up: início mínimo e término máximo das subtarefas ativas.",
          });
          continue;
        }
        // resumo sem filhos calculáveis: segue como tarefa comum
      }

      const duration = effectiveDuration(tcal, task, units);
      if (duration === null) {
        excluded.set(id, "pending");
        continue;
      }

      const { startCand, finishCand, startDriver, finishDriver } = fromPredecessors(id, tcal);
      // O que o cálculo daria (links/projeto), sem o piso da data inicial —
      // é a referência das restrições exatas.
      const derivedStart = earliestStart(tcal, startCand ?? projectStart);
      // Sem predecessor, além do início do projeto a tarefa respeita a data
      // inicial informada (coluna Início, colagem) — o maior dos dois.
      const seed = task.start ?? task.manualStart;
      const origin =
        startCand === null && seed !== null
          ? Math.max(derivedStart, earliestStart(tcal, seed))
          : projectStart;
      let start = earliestStart(tcal, startCand ?? origin);
      let driver: LinkDriver | null = startCand !== null ? startDriver : null;
      if (finishCand !== null) {
        const fromFinish = earliestStart(
          tcal,
          subtractWorkingTime(tcal, finishCand + DAY_MS, duration),
        );
        if (fromFinish > start) {
          start = fromFinish;
          driver = finishDriver;
        }
      }

      const outcome = applyConstraint(tcal, task, start, duration, derivedStart);
      if (outcome.conflict) {
        conflicts.push({
          taskId: id,
          kind: "constraint",
          code: "constraint_wins",
          message: outcome.conflict,
        });
      }

      reasons.set(
        id,
        outcome.conflict
          ? {
              source: "constraint",
              predecessorId: null,
              linkType: null,
              lagMs: 0,
              text: outcome.conflict,
            }
          : buildPredecessorReason(driver, outcome.start, outcome.finish, early, byId),
      );

      early.set(id, {
        start: outcome.start,
        finish: outcome.finish,
        duration,
        work: workOf(task, duration, units),
      });
    }
  };

  // 4 + 5. forward pass (ASAP) — as alap ficam de fora nesta passada
  forwardPass(true, new Map());

  const finishes = () => [...early.values()].map((entry) => entry.finish);
  const projectEnd0 =
    options.projectEnd ?? (finishes().length > 0 ? Math.max(...finishes()) : projectStart);

  // ALAP: o mais tarde possível sem ultrapassar o fim do projeto, sempre
  // respeitando os predecessores; as datas ficam fixadas para a 2ª passada.
  const alapDates = new Map<string, Dated>();
  for (const id of graph.order) {
    const task = byId.get(id)!;
    if (task.schedulingMode !== "auto" || task.constraintType !== "alap") continue;

    const units = unitsOf(options, id);
    const tcal = taskCalendar(task, options);
    const duration = effectiveDuration(tcal, task, units);
    if (duration === null) {
      excluded.set(id, "pending");
      continue;
    }

    let start = earliestStart(
      tcal,
      subtractWorkingTime(tcal, projectEnd0 + DAY_MS, duration),
    );
    start = Math.max(start, earliestStart(tcal, projectStart));

    const { startCand, finishCand } = fromPredecessors(id, tcal);
    if (startCand !== null && startCand > start) start = startCand;
    if (finishCand !== null) {
      const fromFinish = earliestStart(
        tcal,
        subtractWorkingTime(tcal, finishCand + DAY_MS, duration),
      );
      if (fromFinish > start) start = fromFinish;
    }

    const finish = duration === 0 ? start : finishOf(addWorkingTime(tcal, start, duration));
    alapDates.set(id, { start, finish, duration, work: workOf(task, duration, units) });
  }

  // 5 (2ª passada): recalcula tudo com as alap fixadas — o que propaga às
  // tarefas dependentes — e mantém apenas os conflitos desta passada.
  early.clear();
  rollupByTask.clear();
  reasons.clear();
  conflicts.length = 0;
  forwardPass(false, alapDates);

  // 6. backward pass (late start/finish) em ordem topológica inversa
  const computedFinishes = [...early.values()].map((entry) => entry.finish);
  const projectFinish =
    options.projectEnd ??
    (computedFinishes.length > 0 ? Math.max(...computedFinishes) : projectStart);

  for (const id of [...graph.order].reverse()) {
    const entry = early.get(id);
    if (!entry) continue;
    const tcal = taskCalendar(byId.get(id)!, options);

    let lateFinish = projectFinish;
    let startLimit: number | null = null;

    for (const link of graph.successors.get(id) ?? []) {
      if (isOrderOnly(link)) continue;
      const succ = late.get(link.successorId);
      if (!succ) continue;

      if (link.type === "fs") {
        lateFinish = Math.min(lateFinish, latestFinishFromStartLimit(tcal, succ.start, link.lagMs));
      } else if (link.type === "ff") {
        lateFinish = Math.min(lateFinish, latestFinishBound(tcal, succ.finish, link.lagMs));
      } else if (link.type === "ss") {
        const value = latestStartLimit(tcal, succ.start, link.lagMs);
        startLimit = startLimit === null ? value : Math.min(startLimit, value);
      } else {
        const value = latestStartLimit(tcal, succ.finish, link.lagMs);
        startLimit = startLimit === null ? value : Math.min(startLimit, value);
      }
    }

    let lateStart =
      entry.duration === 0
        ? lateFinish
        : previousWorkingDay(
            tcal,
            startOfDay(subtractWorkingTime(tcal, lateFinish + DAY_MS, entry.duration)),
          );

    if (startLimit !== null && startLimit < lateStart) {
      lateStart = startLimit;
      lateFinish =
        entry.duration === 0 ? lateStart : finishOf(addWorkingTime(tcal, lateStart, entry.duration));
    }

    late.set(id, { start: lateStart, finish: lateFinish, duration: entry.duration, work: entry.work });
  }

  // 7. floats, caminho crítico e conflitos
  const tasks: Record<string, ScheduledTask> = {};

  for (const task of expanded) {
    const entry = early.get(task.id);
    const end = late.get(task.id);

    if (!entry || !end) {
      tasks[task.id] = {
        id: task.id,
        start: task.start ?? task.manualStart,
        finish: task.finish ?? task.manualFinish,
        duration: task.duration,
        work: task.work ?? null,
        lateStart: null,
        lateFinish: null,
        totalFloat: null,
        freeFloat: null,
        critical: false,
        excluded: excluded.get(task.id) ?? (task.isInactive ? "inactive" : "pending"),
      };
      continue;
    }

    const tcal = taskCalendar(task, options);
    const totalFloat = durationBetween(tcal, entry.start, end.start);
    const freeFloat = freeFloatOf(tcal, task.id, entry, early, graph.successors, projectFinish);

    tasks[task.id] = {
      id: task.id,
      start: entry.start,
      finish: entry.finish,
      duration: entry.duration,
      work: entry.work,
      lateStart: end.start,
      lateFinish: end.finish,
      totalFloat,
      freeFloat,
      critical: totalFloat === 0,
    };

    // Prazo excedido (specs/scheduling — "Prazos (deadlines)").
    if (task.deadline !== null && task.deadline !== undefined && entry.finish > task.deadline) {
      conflicts.push({
        taskId: task.id,
        kind: "deadline",
        code: "deadline_exceeded",
        message: `Término calculado (${formatDateInput(entry.finish)}) excede o prazo (${formatDateInput(task.deadline)})`,
      });
    }
  }

  // Ciclos: uma entrada por vínculo envolvido (specs/scheduling — "Detecção
  // de ciclos": identifica as arestas participantes).
  const cyclic = new Set(graph.cyclic);
  for (const link of options.links) {
    if (cyclic.has(link.predecessorId) && cyclic.has(link.successorId)) {
      conflicts.push({
        taskId: link.successorId,
        kind: "cycle",
        code: "dependency_cycle",
        message: `Vínculo de ${link.predecessorId} para ${link.successorId} forma ciclo`,
      });
    }
  }

  const criticalPath = graph.order.filter((id) => tasks[id]?.critical);

  // Cadeia condutora (Task Inspector): segue o predecessor determinante
  // de cada tarefa até a origem (specs/task-dependencies — "Cadeia condutora").
  const chains: Record<string, string[]> = {};
  for (const id of graph.order) {
    if (!tasks[id] || tasks[id]!.start === null) continue;
    const chain: string[] = [];
    const seen = new Set<string>([id]);
    let cursor = reasons.get(id)?.predecessorId ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      chain.push(cursor);
      cursor = reasons.get(cursor)?.predecessorId ?? null;
    }
    chains[id] = chain;
  }

  return {
    tasks,
    order: graph.order,
    criticalPath,
    cycles: graph.cyclic,
    conflicts,
    rollups: Object.fromEntries(rollupByTask),
    chains,
    reasons: Object.fromEntries(reasons),
    projectStart,
    projectFinish,
    meta: { incremental: false },
  };
}

/* -------------------------------------------------------------------------- */
/* Recálculo incremental                                                       */
/* -------------------------------------------------------------------------- */

interface IncrementalPlan {
  affected: Set<string>;
  tasks: ScheduleTaskInput[];
  links: ScheduleLinkInput[];
}

/**
 * Fecho das tarefas alteradas nas duas direções — vínculos e aresta
 * filho→resumo (roll-up). O fecho é fechado por construção: nenhum vínculo
 * cruza o conjunto, então o sub-problema é autocontido.
 */
function planIncremental(
  options: ScheduleOptions,
  incremental: NonNullable<ScheduleOptions["incremental"]>,
): IncrementalPlan | null {
  const { baseline, changedIds } = incremental;
  // Ciclo torna o fecho imprevisível: recálculo completo.
  if (baseline.cycles.length > 0) return null;

  const inputById = new Map(options.tasks.map((task) => [task.id, task]));
  const seed: string[] = [];
  for (const id of changedIds) {
    const task = inputById.get(id);
    // Removida ou inativa (sai do cálculo): recálculo completo.
    if (!task || task.isInactive) return null;
    seed.push(id);
  }
  if (seed.length === 0) return null;

  const neighbors = new Map<string, string[]>();
  const connect = (from: string, to: string) => {
    const list = neighbors.get(from);
    if (list) list.push(to);
    else neighbors.set(from, [to]);
  };
  for (const task of options.tasks) {
    if (!neighbors.has(task.id)) neighbors.set(task.id, []);
  }
  for (const edge of options.links) {
    connect(edge.predecessorId, edge.successorId);
    connect(edge.successorId, edge.predecessorId);
  }
  for (const task of options.tasks) {
    if (task.parentId && inputById.has(task.parentId)) {
      connect(task.id, task.parentId);
      connect(task.parentId, task.id);
    }
  }

  const affected = new Set<string>();
  const queue = [...seed];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (affected.has(id)) continue;
    if (!inputById.has(id)) continue; // ponta pendurada: não pertence ao domínio
    affected.add(id);
    for (const next of neighbors.get(id) ?? []) {
      if (!affected.has(next)) queue.push(next);
    }
  }

  const tasks = options.tasks.filter((task) => affected.has(task.id));
  const links = options.links.filter(
    (edge) => affected.has(edge.predecessorId) && affected.has(edge.successorId),
  );
  const touching = options.links.filter(
    (edge) => affected.has(edge.predecessorId) || affected.has(edge.successorId),
  ).length;
  // Se algum vínculo cruzar o fecho, o plano não é seguro.
  if (touching !== links.length) return null;

  return { affected, tasks, links };
}

/** Remenda o sub-resultado no baseline; `null` = recálculo completo. */
function stitchIncremental(
  baseline: ScheduleResult,
  subset: ScheduleResult,
  affected: Set<string>,
): ScheduleResult | null {
  if (subset.cycles.length > 0) return null;

  const merged: Record<string, ScheduledTask> = { ...baseline.tasks };

  for (const id of affected) {
    const fresh = subset.tasks[id];
    const previous = baseline.tasks[id];
    if (!fresh || !previous) return null;

    const freshFinish = fresh.finish ?? null;
    // O projeto cresceu além do fim conhecido: o envelope muda e afeta o
    // float de todas as tarefas — recálculo completo.
    if (fresh.excluded === undefined && freshFinish !== null && freshFinish > baseline.projectFinish) {
      return null;
    }
    // E o oposto: se o fim do projeto vinha de uma tarefa alterada que
    // encolheu, os floats também mudariam — completo.
    if (
      previous.finish !== null &&
      previous.finish === baseline.projectFinish &&
      (freshFinish === null || freshFinish < baseline.projectFinish)
    ) {
      return null;
    }

    merged[id] = fresh;
  }

  // Ordem topológica: sem arestas cruzando o fecho, o bloco afetado pode
  // substituir as posições antigas em qualquer ponto.
  const order: string[] = [];
  let inserted = false;
  for (const id of baseline.order) {
    if (affected.has(id)) {
      if (!inserted) {
        order.push(...subset.order);
        inserted = true;
      }
      continue;
    }
    order.push(id);
  }
  if (!inserted) order.push(...subset.order);

  const criticalPath = [
    ...baseline.criticalPath.filter((id) => !affected.has(id)),
    ...subset.criticalPath,
  ];
  const conflicts = [
    ...baseline.conflicts.filter((conflict) => !affected.has(conflict.taskId)),
    ...subset.conflicts,
  ];
  const rollups = { ...baseline.rollups };
  for (const [id, entry] of Object.entries(subset.rollups)) rollups[id] = entry;

  const chains = { ...baseline.chains };
  for (const [id, entry] of Object.entries(subset.chains)) chains[id] = entry;

  const reasons = { ...baseline.reasons };
  for (const [id, entry] of Object.entries(subset.reasons)) reasons[id] = entry;

  return {
    tasks: merged,
    order,
    criticalPath,
    cycles: [],
    conflicts,
    rollups,
    chains,
    reasons,
    projectStart: baseline.projectStart,
    projectFinish: baseline.projectFinish,
    meta: { incremental: true },
  };
}

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Motivo do agendamento (Task Inspector): predecessor determinante ou a
 * origem do cálculo. As datas citadas vêm do forward pass recém-executado.
 */
function buildPredecessorReason(
  driver: LinkDriver | null,
  start: number,
  finish: number,
  early: Map<string, Dated>,
  byId: Map<string, ScheduleTaskInput>,
): ScheduleReason {
  if (!driver) {
    return {
      source: "project",
      predecessorId: null,
      linkType: null,
      lagMs: 0,
      text: `Início do projeto (${formatDateInput(start)}).`,
    };
  }

  const pred = early.get(driver.predecessorId);
  const name = byId.get(driver.predecessorId)?.name ?? driver.predecessorId;
  const type = (driver.linkType ?? "fs").toUpperCase();
  const lag = driver.lagMs !== 0 ? ` com lag de ${Math.round(driver.lagMs / DAY_MS)}d` : "";

  let text: string;
  if (driver.linkType === "ss") {
    text = `${type} com "${name}"${lag}: início do predecessor em ${formatDateInput(pred?.start ?? start)} → início em ${formatDateInput(start)}.`;
  } else if (driver.linkType === "ff") {
    text = `${type} com "${name}"${lag}: término do predecessor em ${formatDateInput(pred?.finish ?? finish)} → término em ${formatDateInput(finish)}.`;
  } else if (driver.linkType === "sf") {
    text = `${type} com "${name}"${lag}: início do predecessor em ${formatDateInput(pred?.start ?? start)} → término em ${formatDateInput(finish)}.`;
  } else {
    text = `${type} com "${name}"${lag}: término do predecessor em ${formatDateInput(pred?.finish ?? finish)} → início em ${formatDateInput(start)}.`;
  }

  return {
    source: "predecessor",
    predecessorId: driver.predecessorId,
    linkType: driver.linkType,
    lagMs: driver.lagMs,
    text,
  };
}

/** Roll-up: início mínimo, término máximo e trabalho somado dos filhos. */
function rollup(
  cal: Calendar,
  childIds: string[] | undefined,
  early: Map<string, Dated>,
): Dated | null {
  if (!childIds || childIds.length === 0) return null;

  let start = Number.POSITIVE_INFINITY;
  let finish = Number.NEGATIVE_INFINITY;
  let work = 0;
  let count = 0;

  for (const childId of childIds) {
    const child = early.get(childId);
    if (!child) continue;
    count += 1;
    if (child.start < start) start = child.start;
    if (child.finish > finish) finish = child.finish;
    work += child.work;
  }

  if (count === 0) return null;
  return { start, finish, duration: durationBetween(cal, start, finish + DAY_MS), work };
}

/** Float livre: menor folga entre o fim antecipado e o início dos sucessores. */
function freeFloatOf(
  cal: Calendar,
  id: string,
  entry: Dated,
  early: Map<string, Dated>,
  successors: Map<string, ScheduleLinkInput[]>,
  projectFinish: number,
): number {
  const links = successors.get(id) ?? [];
  if (links.length === 0) return durationBetween(cal, entry.finish, projectFinish);

  let slack = Number.POSITIVE_INFINITY;
  for (const link of links) {
    const succ = early.get(link.successorId);
    if (!succ) continue;

    let value: number;
    if (link.type === "fs") value = durationBetween(cal, entry.finish + DAY_MS, succ.start);
    else if (link.type === "ss") value = durationBetween(cal, entry.start, succ.start);
    else if (link.type === "ff") value = durationBetween(cal, entry.finish, succ.finish);
    else value = durationBetween(cal, entry.start, succ.finish);

    if (value < slack) slack = value;
  }

  return Number.isFinite(slack) ? slack : durationBetween(cal, entry.finish, projectFinish);
}
