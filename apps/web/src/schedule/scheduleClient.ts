/**
 * Cliente do agendamento: despacha o cálculo para o Web Worker
 * (specs/scheduling) e notifica o `computedStore` quando o resultado chega.
 *
 * Sem suporte a `Worker` no ambiente (testes), cai para o cálculo
 * síncrono no próprio thread — mesma função pura, mesmo resultado.
 */
import { runSchedule, type Calendar, type ScheduleLinkInput, type ScheduleResult, type ScheduleTaskInput } from "@ontarget/core";

export interface ScheduleInput {
  tasks: ScheduleTaskInput[];
  links: ScheduleLinkInput[];
  calendar: Calendar;
  /** Calendários próprios das tarefas, por id. */
  calendars?: Record<string, Calendar>;
  units?: Record<string, number>;
  projectStart?: number;
}

export interface ScheduleComputation {
  result: ScheduleResult;
  ms: number;
}

type Listener = (computation: ScheduleComputation) => void;

interface ScheduleResponse {
  seq: number;
  result: ScheduleResult;
  ms: number;
}

export class ScheduleClient {
  private worker: Worker | null = null;
  private seq = 0;
  private listener: Listener | null = null;
  private lastInput: ScheduleInput | null = null;

  constructor() {
    if (typeof Worker === "undefined") return;

    try {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<ScheduleResponse>) => {
        // Respostas fora de ordem (edições rápidas) são descartadas.
        if (event.data.seq !== this.seq) return;
        this.listener?.({ result: event.data.result, ms: event.data.ms });
      };
      this.worker.onerror = () => {
        // Worker indisponível: demite e refaz o último snapshot de forma
        // síncrona — a partir daí o cálculo acontece no próprio thread.
        this.worker?.terminate();
        this.worker = null;
        const retry = this.lastInput;
        if (retry) this.request(retry);
      };
    } catch {
      this.worker = null;
    }
  }

  /** Registra o callback de resultado; devolve a função de remoção. */
  onChange(listener: Listener): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  /** Envia um snapshot para cálculo (assíncrono quando há worker). */
  request(input: ScheduleInput): void {
    this.lastInput = input;
    this.seq += 1;
    const seq = this.seq;

    if (!this.worker) {
      const started = performance.now();
      const result = runSchedule(input);
      this.listener?.({ result, ms: performance.now() - started });
      return;
    }

    this.worker.postMessage({ seq, ...input });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.listener = null;
  }
}
