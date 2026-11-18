import { describe, expect, it } from "bun:test";
import { HOUR_MS, defaultCalendar, type ScheduleTaskInput } from "@ontarget/core";
import { ScheduleClient, type ScheduleComputation } from "../src/schedule/scheduleClient";

/** 05/01/2026 é segunda-feira. */
const MON = Date.UTC(2026, 0, 5);
const WORKDAY = 9 * HOUR_MS;

function task(id: string, duration: number): ScheduleTaskInput {
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
    duration,
    start: null,
    finish: null,
  };
}

/** Envia e aguarda o resultado (caminho síncrono ou worker). */
function compute(tasks: ScheduleTaskInput[]): Promise<ScheduleComputation> {
  const client = new ScheduleClient();
  return new Promise<ScheduleComputation>((resolve) => {
    client.onChange((computation) => {
      client.dispose();
      resolve(computation);
    });
    client.request({
      tasks,
      links:
        tasks.length > 1
          ? [{ id: "a->b", predecessorId: "a", successorId: "b", type: "fs", lagMs: 0 }]
          : [],
      calendar: defaultCalendar(),
      projectStart: MON,
    });
  });
}

describe("ScheduleClient", () => {
  it("calcula o snapshot e notifica o resultado", async () => {
    const computation = await compute([task("a", WORKDAY), task("b", WORKDAY)]);

    expect(computation.result.tasks.a).toMatchObject({ start: MON, finish: MON });
    expect(computation.result.tasks.b).toMatchObject({ start: MON + 86_400_000 });
    expect(computation.result.meta.incremental).toBe(false);
    expect(computation.ms).toBeGreaterThanOrEqual(0);
  });
});
