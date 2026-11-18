import { beforeEach, describe, expect, it } from "bun:test";
import { onDirty, resetDirtyListeners, type DirtyEvent } from "../src/store/dirty";
import { useComputedStore } from "../src/store/computedStore";
import { useDomainStore } from "../src/store/domainStore";
import { useUiStore } from "../src/store/uiStore";
import type { Task } from "../src/store/types";

/** Remove as ações (funções) para comparações estruturais. */
function dataOf(state: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(state).filter(([, value]) => typeof value !== "function"),
  );
}

function makeTask(id: string, name: string): Task {
  const now = Date.now();
  return {
    id,
    projectId: "p1",
    parentId: null,
    outlineLevel: 0,
    outlineNumber: "1",
    sortOrder: 0,
    name,
    notes: null,
    isSummary: false,
    isMilestone: false,
    isInactive: false,
    schedulingMode: "auto",
    isPlaceholder: false,
    taskType: "fixed_duration",
    effortDriven: true,
    constraintType: null,
    constraintDate: null,
    deadline: null,
    manualStart: null,
    manualFinish: null,
    manualDuration: null,
    start: now,
    finish: now + 86_400_000,
    duration: 86_400_000,
    durationUnit: "day",
    work: null,
    cost: null,
    fixedCost: null,
    actualStart: null,
    actualFinish: null,
    actualDuration: null,
    actualWork: null,
    actualCost: null,
    percentComplete: 0,
    physicalPercent: null,
    durationEstimated: true,
    priority: 500,
    calendarId: null,
    wbsCode: null,
    recurrence: null,
    segments: null,
    createdAt: now,
    updatedAt: now,
  };
}

let events: DirtyEvent[];
let unsubscribe: () => void;

beforeEach(() => {
  resetDirtyListeners();
  events = [];
  unsubscribe = onDirty((event) => events.push(event));

  useDomainStore.getState().reset();
  useDomainStore.getState().load("p1", {
    tasks: [makeTask("t1", "Tarefa um"), makeTask("t2", "Tarefa dois")],
    taskLinks: [],
    resources: [],
    assignments: [],
  });
  useUiStore.setState({
    selection: { rows: [], activeRow: null, activeColumn: null },
    collapsed: {},
    focus: "grid",
  });
  useComputedStore.getState().clear();
});

describe("separação de stores (3.1)", () => {
  it("editar domínio não altera o uiStore", () => {
    const uiBefore = dataOf(useUiStore.getState() as unknown as Record<string, unknown>);

    useDomainStore.getState().updateTask("t1", { name: "Nome alterado" });

    expect(dataOf(useUiStore.getState() as unknown as Record<string, unknown>)).toEqual(
      uiBefore,
    );
  });

  it("editar domínio emite apenas eventos de entidades do domínio", () => {
    useDomainStore.getState().updateTask("t1", { duration: 172_800_000 });

    expect(events).toHaveLength(1);
    expect(events[0]?.entity).toBe("tasks");
    expect(events[0]?.key).toBe("t1");
    expect(events[0]?.kind).toBe("upsert");
    // nenhum evento de UI pode chegar ao canal de persistência
    expect(["ui", "selection", "zoom", "theme", "panels"]).not.toContain(events[0]?.entity);
  });

  it("alterar a UI não toca no domínio nem gera persistência", () => {
    const domainBefore = dataOf(useDomainStore.getState() as unknown as Record<string, unknown>);
    events.length = 0;

    useUiStore.getState().toggleCollapsed("t1");
    useUiStore.getState().setSelection({ rows: ["t2"], activeRow: "t2" });
    useUiStore.getState().setZoom({ pxPerDay: 60 });
    useUiStore.getState().setFocus("gantt");
    useUiStore.getState().setTheme("dark");

    expect(events).toHaveLength(0);
    expect(dataOf(useDomainStore.getState() as unknown as Record<string, unknown>)).toEqual(
      domainBefore,
    );
  });

  it("o estado derivado não é persistido nem faz parte da UI", () => {
    const uiBefore = dataOf(useUiStore.getState() as unknown as Record<string, unknown>);
    const domainBefore = dataOf(useDomainStore.getState() as unknown as Record<string, unknown>);

    useComputedStore.getState().setSchedule(
      {
        tasks: {},
        order: [],
        criticalPath: [],
        cycles: [],
        conflicts: [],
        rollups: {},
        chains: {},
        reasons: {},
        projectStart: 1,
        projectFinish: 2,
        meta: { incremental: false },
      },
      { at: Date.now(), ms: 1 },
    );

    expect(events).toHaveLength(0);
    expect(dataOf(useUiStore.getState() as unknown as Record<string, unknown>)).toEqual(
      uiBefore,
    );
    expect(dataOf(useDomainStore.getState() as unknown as Record<string, unknown>)).toEqual(
      domainBefore,
    );
  });

  it("inserções e remoções de domínio também são rastreadas", () => {
    useDomainStore.getState().addTask(makeTask("t3", "Nova"));
    expect(events.at(-1)).toMatchObject({ entity: "tasks", key: "t3", kind: "upsert" });

    useDomainStore.getState().removeTask("t3");
    expect(events.at(-1)).toMatchObject({ entity: "tasks", key: "t3", kind: "delete" });

    useDomainStore.getState().addLink({
      id: "l1",
      projectId: "p1",
      predecessorId: "t1",
      successorId: "t2",
      type: "fs",
      lagMs: 0,
      crossProjectRef: null,
    });
    expect(events.at(-1)).toMatchObject({ entity: "task_links", key: "l1" });
  });
});
