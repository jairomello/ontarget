/**
 * Web Worker do agendamento (specs/scheduling — "Recálculo incremental e
 * desempenho"; docs/architecture.md D3).
 *
 * Mantém o snapshot anterior e o resultado da última execução: quando só
 * dados mudaram, o `runSchedule` recalcula apenas a cadeia afetada
 * (incremental); mudanças estruturais caem no recálculo completo.
 */
import {
  changedScheduleIds,
  runSchedule,
  type Calendar,
  type ScheduleLinkInput,
  type ScheduleResult,
  type ScheduleTaskInput,
} from "@ontarget/core";

interface ScheduleMessage {
  seq: number;
  tasks: ScheduleTaskInput[];
  links: ScheduleLinkInput[];
  calendar: Calendar;
  calendars?: Record<string, Calendar>;
  units?: Record<string, number>;
  projectStart?: number;
}

interface ScheduleResponse {
  seq: number;
  result: ScheduleResult;
  ms: number;
}

type WorkerContext = {
  onmessage: ((event: MessageEvent<ScheduleMessage>) => void) | null;
  postMessage: (data: ScheduleResponse) => void;
};

const ctx = self as unknown as WorkerContext;

let previous: { tasks: ScheduleTaskInput[]; links: ScheduleLinkInput[] } | null = null;
let previousResult: ScheduleResult | null = null;

ctx.onmessage = (event) => {
  const message = event.data;
  const started = performance.now();

  const base = {
    tasks: message.tasks,
    links: message.links,
    calendar: message.calendar,
    calendars: message.calendars,
    units: message.units,
    projectStart: message.projectStart,
  };
  const snapshot = { tasks: message.tasks, links: message.links };

  let result: ScheduleResult;

  if (previous && previousResult) {
    const changed = changedScheduleIds(previous, snapshot);

    if (changed && changed.length === 0) {
      // Nada relevante mudou: reaproveita o resultado anterior.
      result = previousResult;
    } else if (changed) {
      result = runSchedule({
        ...base,
        incremental: { baseline: previousResult, changedIds: changed },
      });
    } else {
      result = runSchedule(base);
    }
  } else {
    result = runSchedule(base);
  }

  previous = snapshot;
  previousResult = result;

  ctx.postMessage({ seq: message.seq, result, ms: performance.now() - started });
};
