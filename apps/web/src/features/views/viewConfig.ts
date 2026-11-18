import type { FilterSpec, SortSpec } from "@ontarget/core";
import { useUiStore, type ColumnState, type ViewKind, type ZoomState } from "../../store/uiStore";

/**
 * Visões nomeadas (specs/views-and-filters — "Visões nomeadas"): um
 * instantâneo do estado de apresentação que uma visão salva preserva e
 * restaura — colunas, ordem, filtros, agrupamento, ordenação, layout
 * dividido, zoom e estado de expansão.
 */

/** Layout dividido lembrado por visão (Timeline, detalhes e divisor). */
export interface ViewLayout {
  timeline: boolean;
  details: boolean;
  detailsWidth: number;
}

export interface ViewSnapshot {
  /** Tipo de área de trabalho da visão (Gantt, Controle, Tarefa, Equipe). */
  viewKind: ViewKind;
  columns: ColumnState[];
  query: FilterSpec;
  sorts: SortSpec[];
  groupFields: string[];
  zoom: ZoomState;
  collapsed: Record<string, boolean>;
  layout: ViewLayout;
}

const VIEW_KINDS: ViewKind[] = ["gantt", "tracking", "task_sheet", "team"];

/** Captura o estado atual da interface como snapshot de visão. */
export function captureViewSnapshot(): ViewSnapshot {
  const state = useUiStore.getState();
  return {
    viewKind: state.activeView,
    columns: state.columnState[state.activeView].map((column) => ({ ...column })),
    query: { ...state.query, presets: [...state.query.presets], conditions: state.query.conditions.map((c) => ({ ...c })) },
    sorts: state.sorts.map((sort) => ({ ...sort })),
    groupFields: [...state.groupFields],
    zoom: { ...state.zoom },
    collapsed: { ...state.collapsed },
    layout: {
      timeline: state.panels.timeline,
      details: state.panels.details,
      detailsWidth: state.panels.detailsWidth,
    },
  };
}

/**
 * Aplica um snapshot à interface. Campos ausentes ou inválidos são
 * ignorados (configuração de outra versão ou de projeto sem aquele campo).
 */
export function applyViewSnapshot(snapshot: Partial<ViewSnapshot>): void {
  const ui = useUiStore.getState();

  if (Array.isArray(snapshot.columns) && VIEW_KINDS.includes(snapshot.viewKind ?? "gantt")) {
    ui.setColumnState(snapshot.viewKind!, snapshot.columns.map((column) => ({ ...column })));
  }
  if (snapshot.viewKind && VIEW_KINDS.includes(snapshot.viewKind)) {
    ui.setActiveView(snapshot.viewKind);
  }
  if (snapshot.query && Array.isArray(snapshot.query.conditions)) {
    ui.setViewQuery({
      query: {
        combinator: snapshot.query.combinator === "or" ? "or" : "and",
        presets: Array.isArray(snapshot.query.presets) ? [...snapshot.query.presets] : [],
        conditions: snapshot.query.conditions,
      },
      sorts: Array.isArray(snapshot.sorts) ? snapshot.sorts : [],
      groupFields: Array.isArray(snapshot.groupFields) ? [...snapshot.groupFields] : [],
    });
  }
  if (snapshot.zoom && typeof snapshot.zoom.pxPerDay === "number") {
    ui.setZoom({
      pxPerDay: snapshot.zoom.pxPerDay,
      forcedUnit: snapshot.zoom.forcedUnit ?? null,
      preset: snapshot.zoom.preset ?? null,
    });
  }
  if (snapshot.collapsed && typeof snapshot.collapsed === "object") {
    ui.setAllCollapsed({ ...snapshot.collapsed });
  }
  if (snapshot.layout) {
    if (typeof snapshot.layout.timeline === "boolean") {
      ui.setPanel("timeline", snapshot.layout.timeline);
    }
    if (typeof snapshot.layout.details === "boolean") {
      ui.setPanel("details", snapshot.layout.details);
    }
    if (typeof snapshot.layout.detailsWidth === "number" && snapshot.layout.detailsWidth > 0) {
      ui.setPanel("detailsWidth", snapshot.layout.detailsWidth);
    }
  }
}

/** Serializa um snapshot para o `config` do item da biblioteca. */
export function serializeSnapshot(snapshot: ViewSnapshot): string {
  return JSON.stringify(snapshot);
}

/** Lê um snapshot do `config`; devolve `null` se estiver ilegível. */
export function parseSnapshot(config: string): ViewSnapshot | null {
  try {
    const parsed = JSON.parse(config) as Partial<ViewSnapshot>;
    if (!parsed || typeof parsed !== "object" || !VIEW_KINDS.includes(parsed.viewKind as ViewKind)) {
      return null;
    }
    return parsed as ViewSnapshot;
  } catch {
    return null;
  }
}

/** Lê o filtro salvo num item `kind: "filter"` da biblioteca. */
export function parseSavedFilter(config: string): FilterSpec | null {
  try {
    const parsed = JSON.parse(config) as { query?: FilterSpec };
    if (!parsed?.query || !Array.isArray(parsed.query.conditions)) return null;
    return parsed.query;
  } catch {
    return null;
  }
}
