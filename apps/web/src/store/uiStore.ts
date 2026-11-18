import { EMPTY_FILTER, type FilterSpec, type SortSpec } from "@ontarget/core";
import { create } from "zustand";
import { COLUMN_DEFS, TRACKING_ONLY_COLUMNS, defaultColumnState, isCustomColumnKey } from "../features/tasksheet/columns";
import type { DensityName, PaletteName, ThemeName } from "../ui/theme";
import type { Id } from "./types";

/**
 * Estado de apresentação: seleção, foco, hierarquia recolhida, zoom, tema
 * e painéis. Não é persistido no servidor nem entra no undo
 * (docs/architecture.md §10.1).
 */
export type FocusScope = "grid" | "gantt";

/** Estado do salvamento exibido na barra de aplicação. */
export type SaveState = "idle" | "saving" | "saved" | "error";

export type ViewKind = "gantt" | "tracking" | "task_sheet" | "team";

export interface Selection {
  /** Linhas selecionadas (ordem de inserção = ordem de ativação). */
  rows: Id[];
  activeRow: Id | null;
  activeColumn: string | null;
}

export interface ZoomState {
  /** Pixels por dia — contínuo, 1,5 a 4.000 (docs/Design.md §7). */
  pxPerDay: number;
  /** Unidade forçada pelo preset; `null` = derivada do zoom. */
  forcedUnit: string | null;
  preset: string | null;
}

export interface PanelsState {
  timeline: boolean;
  details: boolean;
  detailsWidth: number;
  /** Painel de calendários (dias úteis, turnos, exceções). */
  calendars: boolean;
  /** Painel de recursos (equipes e pessoas). */
  resources: boolean;
  /** Painel de equipe (faixas, superalocação e reatribuição por arraste). */
  team: boolean;
  /** Painel de linhas de base e planos provisórios. */
  baselines: boolean;
  /** Painel de data de status e atualização em lote. */
  statusdate: boolean;
  /** Painel de alertas de desempenho. */
  alerts: boolean;
  /** Painel de campos personalizados. */
  fields: boolean;
  /** Painel de filtros, ordenação e agrupamento. */
  filters: boolean;
  /** Painel de visões nomeadas e biblioteca global. */
  views: boolean;
}

/** Estado configurável de uma coluna da Task Sheet. */
export interface ColumnState {
  key: string;
  visible: boolean;
  width: number;
}

export interface UiState {
  selection: Selection;
  focus: FocusScope;
  /** Há uma célula em edição — silencia os atalhos da grade. */
  cellEditing: boolean;
  /** Overlay de atalhos (`?`) aberto. */
  shortcutsOpen: boolean;
  collapsed: Record<Id, boolean>;
  activeView: ViewKind;
  /** Baseline do Tracking Gantt (null = a mais recente salva). */
  trackingBaselineId: Id | null;
  /** Tarefa a revelar (rolagem até ela); consumida e limpa pela grade. */
  revealTaskId: Id | null;
  /** Filtros ativos da visão (specs/views-and-filters). */
  query: FilterSpec;
  /** Ordenação múltipla (campos na ordem de precedência). */
  sorts: SortSpec[];
  /** Campos de agrupamento (na ordem dos níveis). */
  groupFields: string[];
  /** Configuração de colunas por visão (largura, visibilidade e ordem). */
  columnState: Record<ViewKind, ColumnState[]>;
  /**
   * Destaque do caminho crítico no Gantt e na grade (specs/scheduling —
   * "Cálculo do caminho crítico"); ligado por padrão, como no MS Project.
   */
  criticalVisible: boolean;
  zoom: ZoomState;
  theme: ThemeName;
  density: DensityName;
  /** Paleta de cor aplicada ao documento (specs/ui-shell). */
  palette: PaletteName;
  panels: PanelsState;
  /** Estado do indicador de salvamento (specs/ui-shell). */
  saveState: SaveState;

  setSelection: (selection: Partial<Selection>) => void;
  toggleRow: (id: Id, additive?: boolean) => void;
  clearSelection: () => void;
  setFocus: (focus: FocusScope) => void;
  setCellEditing: (editing: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setColumnState: (view: ViewKind, state: ColumnState[]) => void;
  toggleColumn: (view: ViewKind, key: string) => void;
  resizeColumn: (view: ViewKind, key: string, width: number) => void;
  moveColumn: (view: ViewKind, key: string, targetKey: string) => void;
  setCriticalVisible: (visible: boolean) => void;
  setSaveState: (state: SaveState) => void;
  toggleCollapsed: (id: Id) => void;
  setCollapsed: (id: Id, collapsed: boolean) => void;
  expandAll: () => void;
  collapseAll: (ids: Id[]) => void;
  /** Substitui o mapa de recolhimento (restauração de visão nomeada). */
  setAllCollapsed: (collapsed: Record<Id, boolean>) => void;
  setActiveView: (view: ViewKind) => void;
  setTrackingBaseline: (id: Id | null) => void;
  setRevealTaskId: (id: Id | null) => void;
  /** Atualiza a consulta da visão (filtros, ordenação e agrupamento). */
  setViewQuery: (patch: Partial<{
    query: FilterSpec;
    sorts: SortSpec[];
    groupFields: string[];
  }>) => void;
  setZoom: (zoom: Partial<ZoomState>) => void;
  setTheme: (theme: ThemeName) => void;
  setDensity: (density: DensityName) => void;
  setPalette: (palette: PaletteName) => void;
  setPanel: <K extends keyof PanelsState>(key: K, value: PanelsState[K]) => void;
  /** Largura da coluna da grade no divisor Grade↔Gantt (0 = automática). */
  sheetWidth: number;
  /** `persist=false` durante o arraste; grava o layout só ao soltar. */
  setSheetWidth: (width: number, persist?: boolean) => void;
}

const EMPTY_SELECTION: Selection = { rows: [], activeRow: null, activeColumn: null };

const COLUMNS_STORAGE_KEY = "ontarget.columns";
const LAYOUT_STORAGE_KEY = "ontarget.layout";
/** Chaves anteriores ao rename; lidas como fallback para não perder o layout. */
const LEGACY_COLUMNS_STORAGE_KEY = "e-project.columns";
const LEGACY_LAYOUT_STORAGE_KEY = "e-project.layout";
const VIEWS: ViewKind[] = ["gantt", "tracking", "task_sheet", "team"];

/**
 * Layout lembrado por sessão (specs/views-and-filters — "Visão de detalhes
 * e layout dividido"): visão ativa e divisores/restrições de painel.
 */
interface SavedLayout {
  activeView: ViewKind;
  timeline: boolean;
  details: boolean;
  detailsWidth: number;
  /** Largura da coluna da grade no divisor (0 = automática, ~44%). */
  sheetWidth: number;
}

function loadLayout(): Partial<SavedLayout> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw =
      localStorage.getItem(LAYOUT_STORAGE_KEY) ?? localStorage.getItem(LEGACY_LAYOUT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SavedLayout>;
    const saved: Partial<SavedLayout> = {};
    if (VIEWS.includes(parsed.activeView as ViewKind)) saved.activeView = parsed.activeView;
    if (typeof parsed.timeline === "boolean") saved.timeline = parsed.timeline;
    if (typeof parsed.details === "boolean") saved.details = parsed.details;
    if (typeof parsed.detailsWidth === "number" && parsed.detailsWidth > 0) {
      saved.detailsWidth = parsed.detailsWidth;
    }
    if (typeof parsed.sheetWidth === "number" && parsed.sheetWidth >= 0) {
      saved.sheetWidth = parsed.sheetWidth;
    }
    return saved;
  } catch {
    return {};
  }
}

function persistLayout(layout: SavedLayout): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // armazenamento indisponível: o layout vale só na sessão
  }
}

/**
 * Configuração padrão de colunas por visão: as colunas de desvio do
 * Tracking Gantt só aparecem por padrão na visão "Controle".
 */
function defaultColumns(): Record<ViewKind, ColumnState[]> {
  const base = defaultColumnState();
  return Object.fromEntries(
    VIEWS.map((view) => [
      view,
      base.map((column) => ({
        ...column,
        visible: view === "tracking" ? true : !TRACKING_ONLY_COLUMNS.includes(column.key),
      })),
    ]),
  ) as Record<ViewKind, ColumnState[]>;
}

/** Restaura a configuração salva (por sessão) validando o formato. */
function loadColumnState(): Record<ViewKind, ColumnState[]> {
  const fallback = defaultColumns();
  if (typeof localStorage === "undefined") return fallback;

  try {
    const raw =
      localStorage.getItem(COLUMNS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_COLUMNS_STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Record<string, ColumnState[]>;
    const restored = { ...fallback };

    for (const view of VIEWS) {
      const columns = parsed[view];
      if (!Array.isArray(columns)) continue;
      const valid = columns.filter(
        (column) =>
          typeof column?.key === "string" &&
          typeof column?.visible === "boolean" &&
          typeof column?.width === "number" &&
          (Boolean(COLUMN_DEFS[column.key]) || isCustomColumnKey(column.key)),
      );
      if (valid.length > 0) {
        // acrescenta colunas novas (ex.: desvio) que o salvo não conhecia,
        // respeitando o padrão de visibilidade da própria visão
        const base = fallback[view] ?? [];
        const known = new Set(valid.map((column) => column.key));
        restored[view] = [
          ...valid,
          ...base.filter((column) => !known.has(column.key)),
        ];
      }
    }

    return restored;
  } catch {
    return fallback;
  }
}

function persistColumns(state: Record<ViewKind, ColumnState[]>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // armazenamento indisponível: a configuração vale só na sessão
  }
}

const initialLayout = loadLayout();

export const useUiStore = create<UiState>()((set) => ({
  selection: EMPTY_SELECTION,
  focus: "grid",
  cellEditing: false,
  shortcutsOpen: false,
  collapsed: {},
  activeView: initialLayout.activeView ?? "gantt",
  trackingBaselineId: null,
  revealTaskId: null,
  query: EMPTY_FILTER,
  sorts: [],
  groupFields: [],
  columnState: loadColumnState(),
  criticalVisible: true,
  zoom: { pxPerDay: 26, forcedUnit: null, preset: null },
  theme: "auto",
  density: "comfortable",
  palette: "indigo",
  saveState: "idle",
  sheetWidth: initialLayout.sheetWidth ?? 0,
  panels: {
    timeline: initialLayout.timeline ?? true,
    details: initialLayout.details ?? false,
    detailsWidth: initialLayout.detailsWidth ?? 360,
    calendars: false,
    resources: false,
    team: false,
    baselines: false,
    statusdate: false,
    alerts: false,
    fields: false,
    filters: false,
    views: false,
  },

  setSelection: (selection) =>
    set((state) => ({ selection: { ...state.selection, ...selection } })),

  toggleRow: (id, additive = false) =>
    set((state) => {
      if (!additive) {
        return { selection: { rows: [id], activeRow: id, activeColumn: state.selection.activeColumn } };
      }
      const exists = state.selection.rows.includes(id);
      const rows = exists
        ? state.selection.rows.filter((row) => row !== id)
        : [...state.selection.rows, id];
      return {
        selection: {
          rows,
          activeRow: rows.at(-1) ?? null,
          activeColumn: state.selection.activeColumn,
        },
      };
    }),

  clearSelection: () => set({ selection: EMPTY_SELECTION }),

  setFocus: (focus) => set({ focus }),

  setCellEditing: (cellEditing) => set({ cellEditing }),

  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  toggleCollapsed: (id) =>
    set((state) => ({
      collapsed: { ...state.collapsed, [id]: !state.collapsed[id] },
    })),

  setCollapsed: (id, collapsed) =>
    set((state) => ({ collapsed: { ...state.collapsed, [id]: collapsed } })),

  expandAll: () => set({ collapsed: {} }),

  collapseAll: (ids) =>
    set((state) => {
      const collapsed = { ...state.collapsed };
      for (const id of ids) collapsed[id] = true;
      return { collapsed };
    }),

  setAllCollapsed: (collapsed) => set({ collapsed }),

  setActiveView: (activeView) =>
    set((state) => {
      persistLayout({
        activeView,
        timeline: state.panels.timeline,
        details: state.panels.details,
        detailsWidth: state.panels.detailsWidth,
        sheetWidth: state.sheetWidth,
      });
      return { activeView };
    }),
  setTrackingBaseline: (trackingBaselineId) => set({ trackingBaselineId }),
  setRevealTaskId: (revealTaskId) => set({ revealTaskId }),
  setViewQuery: (patch) => set((state) => ({ ...state, ...patch })),

  setColumnState: (view, state) =>
    set((s) => {
      const columnState = { ...s.columnState, [view]: state };
      persistColumns(columnState);
      return { columnState };
    }),

  toggleColumn: (view, key) =>
    set((s) => {
      if (key === "name") return s; // coluna âncora: sempre visível
      const list = s.columnState[view];
      const index = list.findIndex((column) => column.key === key);
      // coluna dinâmica (campo personalizado) ainda sem entrada: cria oculta
      const next =
        index === -1
          ? [...list, { key, visible: false, width: 140 }]
          : list.map((column) =>
              column.key === key ? { ...column, visible: !column.visible } : column,
            );
      const columnState = { ...s.columnState, [view]: next };
      persistColumns(columnState);
      return { columnState };
    }),

  resizeColumn: (view, key, width) =>
    set((s) => {
      const clamped = Math.min(640, Math.max(48, Math.round(width)));
      const list = s.columnState[view];
      const exists = list.some((column) => column.key === key);
      const next = exists
        ? list.map((column) => (column.key === key ? { ...column, width: clamped } : column))
        : [...list, { key, visible: true, width: clamped }];
      const columnState = { ...s.columnState, [view]: next };
      persistColumns(columnState);
      return { columnState };
    }),

  moveColumn: (view, key, targetKey) =>
    set((s) => {
      const list = [...s.columnState[view]];
      if (!list.some((column) => column.key === key)) {
        list.push({ key, visible: true, width: 140 }); // coluna dinâmica
      }
      const from = list.findIndex((column) => column.key === key);
      const to = list.findIndex((column) => column.key === targetKey);
      if (from < 0 || to < 0 || from === to) return s;

      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved!);

      const columnState = { ...s.columnState, [view]: list };
      persistColumns(columnState);
      return { columnState };
    }),

  setCriticalVisible: (criticalVisible) => set({ criticalVisible }),

  setZoom: (zoom) => set((state) => ({ zoom: { ...state.zoom, ...zoom } })),

  setTheme: (theme) => set({ theme }),

  setDensity: (density) => set({ density }),

  setPalette: (palette) => set({ palette }),

  setPanel: (key, value) =>
    set((state) => {
      const panels = { ...state.panels, [key]: value };
      // só o layout dividido é lembrado entre sessões (não os painéis abertos)
      if (key === "timeline" || key === "details" || key === "detailsWidth") {
        persistLayout({
          activeView: state.activeView,
          timeline: panels.timeline,
          details: panels.details,
          detailsWidth: panels.detailsWidth,
          sheetWidth: state.sheetWidth,
        });
      }
      return { panels };
    }),

  setSheetWidth: (sheetWidth, persist = true) =>
    set((state) => {
      if (persist) {
        persistLayout({
          activeView: state.activeView,
          timeline: state.panels.timeline,
          details: state.panels.details,
          detailsWidth: state.panels.detailsWidth,
          sheetWidth,
        });
      }
      return { sheetWidth };
    }),

  setSaveState: (state) => set({ saveState: state }),
}));
