import { beforeEach, describe, expect, it } from "bun:test";
import { EMPTY_FILTER, type FilterSpec } from "@ontarget/core";
import {
  applyViewSnapshot,
  captureViewSnapshot,
  parseSavedFilter,
  parseSnapshot,
  serializeSnapshot,
} from "../src/features/views/viewConfig";
import { defaultColumnState } from "../src/features/tasksheet/columns";
import { useUiStore } from "../src/store/uiStore";

/**
 * Visões nomeadas (specs/views-and-filters — "Visões nomeadas"): o snapshot
 * captura colunas, filtros, agrupamento, ordenação, layout e zoom, e a
 * aplicação restaura exatamente o estado salvo.
 */

function resetUi(): void {
  const ui = useUiStore.getState();
  ui.setViewQuery({ query: EMPTY_FILTER, sorts: [], groupFields: [] });
  ui.setActiveView("gantt");
  ui.setColumnState("gantt", defaultColumnState());
  ui.setColumnState("task_sheet", defaultColumnState());
  ui.setZoom({ pxPerDay: 26, forcedUnit: null, preset: null });
  ui.setAllCollapsed({});
  ui.setPanel("timeline", true);
  ui.setPanel("details", false);
  ui.setPanel("detailsWidth", 360);
}

const ALFA_VIEW = {
  viewKind: "task_sheet" as const,
  query: {
    combinator: "or" as const,
    presets: ["critical" as const],
    conditions: [{ field: "name", operator: "contains" as const, value: "alfa" }],
  },
  sorts: [{ field: "duration", direction: "desc" as const }],
  groupFields: ["res"],
  zoom: { pxPerDay: 12, forcedUnit: "months", preset: "months" },
  collapsed: { t1: true },
  layout: { timeline: false, details: true, detailsWidth: 480 },
};

describe("viewConfig", () => {
  beforeEach(resetUi);

  it("captura o estado atual em um snapshot completo", () => {
    const ui = useUiStore.getState();
    ui.setViewQuery(ALFA_VIEW);
    ui.setActiveView("task_sheet");
    ui.setZoom(ALFA_VIEW.zoom);
    ui.setPanel("timeline", false);
    ui.setPanel("details", true);
    ui.setPanel("detailsWidth", 480);
    ui.setAllCollapsed({ t1: true });

    const snapshot = captureViewSnapshot();
    expect(snapshot.viewKind).toBe("task_sheet");
    expect(snapshot.query).toEqual(ALFA_VIEW.query);
    expect(snapshot.sorts).toEqual(ALFA_VIEW.sorts);
    expect(snapshot.groupFields).toEqual(["res"]);
    expect(snapshot.zoom.pxPerDay).toBe(12);
    expect(snapshot.collapsed).toEqual({ t1: true });
    expect(snapshot.layout).toEqual(ALFA_VIEW.layout);
  });

  it("serializa e restaura colunas, filtros, layout e zoom", () => {
    const ui = useUiStore.getState();
    ui.setViewQuery(ALFA_VIEW);
    ui.setActiveView("task_sheet");
    ui.setColumnState(
      "task_sheet",
      defaultColumnState().filter((column) => column.key !== "duration"),
    );
    ui.setZoom(ALFA_VIEW.zoom);
    ui.setPanel("timeline", false);
    ui.setPanel("details", true);
    ui.setPanel("detailsWidth", 480);
    ui.setAllCollapsed({ t1: true });

    const saved = serializeSnapshot(captureViewSnapshot());

    // bagunça tudo (volta ao padrão)
    resetUi();

    const parsed = parseSnapshot(saved);
    expect(parsed).not.toBeNull();
    applyViewSnapshot(parsed!);

    const restored = useUiStore.getState();
    expect(restored.activeView).toBe("task_sheet");
    expect(restored.columnState.task_sheet.some((c) => c.key === "duration")).toBe(false);
    expect(restored.query).toEqual(ALFA_VIEW.query);
    expect(restored.sorts).toEqual(ALFA_VIEW.sorts);
    expect(restored.groupFields).toEqual(["res"]);
    expect(restored.zoom).toEqual(ALFA_VIEW.zoom);
    expect(restored.collapsed).toEqual({ t1: true });
    expect(restored.panels.details).toBe(true);
    expect(restored.panels.detailsWidth).toBe(480);
    expect(restored.panels.timeline).toBe(false);
  });

  it("recusa configuração ilegível ou de formato desconhecido", () => {
    expect(parseSnapshot("não é json")).toBeNull();
    expect(parseSnapshot('{"viewKind":"qualquer-coisa"}')).toBeNull();
    expect(parseSnapshot("{}")).toBeNull();
    expect(parseSavedFilter("lixo")).toBeNull();
    expect(parseSavedFilter('{"query":{}}')).toBeNull();
  });

  it("lê o filtro salvo no item da biblioteca", () => {
    const query: FilterSpec = ALFA_VIEW.query;
    expect(parseSavedFilter(JSON.stringify({ query }))).toEqual(query);
  });
});
