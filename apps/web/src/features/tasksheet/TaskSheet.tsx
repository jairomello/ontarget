import { isFilterActive } from "@ontarget/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "../../lib/api";
import { formatDuration, formatPercent } from "../../lib/format";
import { useComputedStore } from "../../store/computedStore";
import { selectWbsMask, useDomainStore } from "../../store/domainStore";
import { createTask } from "../../store/taskFactory";
import { useUiStore } from "../../store/uiStore";
import { ROW_HEIGHTS } from "../../ui/theme";
import { CellEditor } from "./CellEditor";
import {
  COLUMNS,
  buildTemplate,
  isCustomColumnKey,
  stickyOffsets,
  visibleColumns,
  type ColumnDef,
  type ColumnState,
} from "./columns";
import {
  buildFieldColumn,
  customCellValueFor,
  customCellTextFor,
  indicatorIconsFor,
  wbsCodeText,
} from "../shared/fields";
import { headerHeightFor } from "../gantt/header";
import { notifyScroll, subscribeScroll } from "../shared/scrollSync";
import { parseTsv, planPaste } from "./paste";
import { predecessorsText } from "../shared/predecessors";
import type { Task } from "../../store/types";
import { assignmentNamesText } from "../shared/assignments";
import { useQueryRows } from "../shared/query";
import {
  currentSelectedBaseline,
  deviationText,
  useSelectedBaseline,
  type DeviationKey,
} from "../shared/tracking";
import styles from "./TaskSheet.module.css";

interface EditingState {
  id: string;
  key: string;
  seed?: string;
}

/** Valor atual da célula, a partir do domínio. */
export function cellValue(task: Record<string, unknown>, key: string): unknown {
  if (isCustomColumnKey(key)) return customCellValueFor(key, task as unknown as Task);
  switch (key) {
    case "name":
      return task.name;
    case "indicator":
      return null; // somente leitura
    case "wbs":
      return task.wbsCode ?? task.outlineNumber;
    case "pred":
      return predecessorsText(String(task.id));
    case "res":
      return assignmentNamesText(String(task.id));
    case "start":
      return task.start;
    case "finish":
      return task.finish;
    case "duration":
      return task.duration;
    case "percent":
      return task.percentComplete;
    default:
      return null;
  }
}

/** Texto exibido (e impresso) de uma célula, conforme o tipo da coluna. */
export function cellText(column: ColumnDef, task: Record<string, unknown>): string {
  if (isCustomColumnKey(column.key)) {
    return customCellTextFor(column.key, task as unknown as Task);
  }
  if (column.key.startsWith("dev")) {
    const tracking = currentSelectedBaseline();
    return deviationText(
      column.key as DeviationKey,
      task as unknown as Task,
      tracking.baseline,
      tracking.values,
    );
  }

  switch (column.key) {
    case "name":
      return String(task.name ?? "");
    case "indicator":
      return indicatorIconsFor(task as unknown as Task);
    case "wbs":
      return wbsCodeText(task as unknown as Task);
    case "pred":
      return predecessorsText(String(task.id));
    case "res":
      return assignmentNamesText(String(task.id));
    case "start":
      return formatDate(task.start as number | null);
    case "finish":
      return formatDate(task.finish as number | null);
    case "duration":
      return formatDuration(task.duration as number | null);
    case "percent":
      return formatPercent(task.percentComplete as number | null);
    default:
      return "";
  }
}

/**
 * Task Sheet: a grade de tarefas como superfície primária de edição
 * (specs/task-sheet). As linhas vêm de `visibleRows` — a mesma função que
 * alimenta o Gantt — e toda célula é editável inline.
 */
export function TaskSheet() {
  const tasks = useDomainStore((state) => state.tasks);
  // assina a baseline selecionada: força re-render das colunas de desvio
  const tracking = useSelectedBaseline();
  const criticalPath = useComputedStore((state) => state.schedule?.criticalPath);
  const criticalVisible = useUiStore((state) => state.criticalVisible);
  const criticalSet = useMemo(() => new Set(criticalPath ?? []), [criticalPath]);
  // opções da coluna Recursos (editor `list`) — memoizado: um array novo a
  // cada chamada de seletor causaria re-render infinito
  const resources = useDomainStore((state) => state.resources);
  const resourceNames = useMemo(
    () =>
      Object.values(resources)
        .map((resource) => resource.name)
        .sort((a, b) => a.localeCompare(b)),
    [resources],
  );

  const query = useUiStore((state) => state.query);
  const selection = useUiStore((state) => state.selection);
  const density = useUiStore((state) => state.density);
  const activeView = useUiStore((state) => state.activeView);
  const columnState = useUiStore((state) => state.columnState[state.activeView]);

  // campos personalizados de tarefa → colunas dinâmicas da grade
  const customFields = useDomainStore((state) => state.customFields);
  // valores e máscara: re-renderizam as células de indicador/código
  const customFieldValues = useDomainStore((state) => state.customFieldValues);
  const wbsMask = useDomainStore(selectWbsMask);
  const customFieldDefs = useMemo(
    () =>
      Object.values(customFields)
        .filter((field) => field.entityType === "task")
        .map((field) => buildFieldColumn(field)),
    [customFields],
  );
  const cfEntries: ColumnState[] = useMemo(
    () =>
      customFieldDefs.map((def) => {
        const saved = columnState.find((candidate) => candidate.key === def.key);
        return {
          key: def.key,
          visible: saved?.visible ?? true,
          width: saved?.width ?? def.width,
        };
      }),
    [customFieldDefs, columnState],
  );
  const fullState = useMemo(() => [...columnState, ...cfEntries], [columnState, cfEntries]);
  const toggleRow = useUiStore((state) => state.toggleRow);
  const toggleCollapsed = useUiStore((state) => state.toggleCollapsed);
  const setSelection = useUiStore((state) => state.setSelection);
  const setCellEditing = useUiStore((state) => state.setCellEditing);
  const toggleColumn = useUiStore((state) => state.toggleColumn);
  const resizeColumn = useUiStore((state) => state.resizeColumn);
  const moveColumnTo = useUiStore((state) => state.moveColumn);

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const resizingRef = useRef(false);

  const rowHeight = ROW_HEIGHTS[density];
  const scrollRef = useRef<HTMLDivElement>(null);
  const pxPerDay = useUiStore((state) => state.zoom.pxPerDay);
  const headerHeight = headerHeightFor(pxPerDay);

  // rolagem vertical compartilhada com o Gantt (features/shared/scrollSync)
  useEffect(
    () =>
      subscribeScroll((state, source) => {
        if (source === "sheet") return;
        const node = scrollRef.current;
        if (node && Math.abs(node.scrollTop - state.top) > 1) node.scrollTop = state.top;
      }),
    [],
  );

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (node) notifyScroll("sheet", node.scrollTop);
  }, []);

  const columns = useMemo(
    () => visibleColumns(fullState, customFieldDefs),
    [fullState, customFieldDefs],
  );
  const template = useMemo(() => buildTemplate(fullState), [fullState]);
  const offsets = useMemo(() => stickyOffsets(fullState), [fullState]);
  const columnKeys = columns.map((column) => column.key);

  // linhas da visão: filtros + ordenação + agrupamento (fonte única com o Gantt)
  const rows = useQueryRows();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  // Revela a tarefa pedida pelos alertas: rola a grade e, pela rolagem
  // compartilhada, o Gantt acompanha (specs/tracking — "Navegar do alerta").
  const revealTaskId = useUiStore((state) => state.revealTaskId);
  useEffect(() => {
    if (!revealTaskId) return;
    const index = rows.findIndex((row) => row.id === revealTaskId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" });
    useUiStore.getState().setRevealTaskId(null);
  }, [revealTaskId, rows, virtualizer]);

  const startEdit = (id: string, key: string, seed?: string) => {
    const column = columns.find((candidate) => candidate.key === key);
    if (!column?.type || (!column.apply && !column.commit)) return;
    setSelection({ activeRow: id, activeColumn: key, rows: [id] });
    setEditing({ id, key, seed });
  };

  const commitEdit = (value: unknown) => {
    if (!editing) return;
    const task = tasks[editing.id];
    const column = columns.find((candidate) => candidate.key === editing.key);
    if (task && column?.commit) {
      const errors = column.commit(editing.id, String(value));
      setNotice(errors.length > 0 ? errors.join("  ·  ") : null);
    } else if (task && column?.apply) {
      useDomainStore.getState().updateTask(editing.id, column.apply(task, value));
      setNotice(null);
    }
    setEditing(null);
    scrollRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditing(null);
    scrollRef.current?.focus();
  };

  const moveRow = (delta: number, extend: boolean) => {
    const currentId = selection.activeRow ?? selection.rows[0] ?? null;

    // sem seleção, a primeira seta escolhe a extremidade da grade
    if (!currentId) {
      const target = rows[delta >= 0 ? 0 : rows.length - 1];
      if (target) toggleRow(target.id);
      return;
    }

    const currentIndex = rows.findIndex((row) => row.id === currentId);
    const baseIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = Math.min(rows.length - 1, Math.max(0, baseIndex + delta));
    const nextId = rows[nextIndex]?.id;
    if (!nextId) return;

    if (!extend) {
      toggleRow(nextId);
      return;
    }

    const anchorId = selection.rows[0] ?? currentId ?? nextId;
    const anchorIndex = rows.findIndex((row) => row.id === anchorId);
    const from = Math.min(anchorIndex, nextIndex);
    const to = Math.max(anchorIndex, nextIndex);
    setSelection({
      rows: rows.slice(from, to + 1).map((row) => row.id),
      activeRow: nextId,
    });
  };

  /**
   * Reordena arrastando uma linha sobre outra, dentro do mesmo nível
   * (specs/task-structure — "Ordenação de tarefas ... por arrastar,
   * preservando as subárvores"). Um único comando de desfazer.
   */
  const moveByDrop = (draggedId: string, targetId: string, after: boolean) => {
    const state = useDomainStore.getState();
    const dragged = state.tasks[draggedId];
    const target = state.tasks[targetId];
    if (!dragged || !target || draggedId === targetId) return;
    if (dragged.parentId !== target.parentId) return; // só entre irmãos

    const siblings = state.taskOrder.filter(
      (id) => state.tasks[id]?.parentId === target.parentId,
    );
    const fromIndex = siblings.indexOf(draggedId);
    const targetIndex = siblings.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0) return;

    const withoutDragged = siblings.filter((id) => id !== draggedId);
    const destination = withoutDragged.indexOf(targetId) + (after ? 1 : 0);
    const steps = destination - fromIndex;
    if (steps === 0) return;

    const direction = steps > 0 ? "down" : "up";
    // com seleção múltipla, o bloco inteiro acompanha (mesmo nível)
    const selected = selection.rows;
    const block =
      selected.includes(draggedId) && selected.length > 1
        ? selected.filter((id) => state.tasks[id]?.parentId === dragged.parentId)
        : [draggedId];
    state.moveTasks(block, direction, Math.abs(steps));
  };

  const moveActiveColumn = (delta: number) => {
    const current = selection.activeColumn ?? "name";
    const index = Math.max(0, columnKeys.indexOf(current));
    const next = columnKeys[Math.min(columnKeys.length - 1, Math.max(0, index + delta))];
    if (next) setSelection({ activeColumn: next });
  };

  const selectAll = () => {
    setSelection({
      rows: rows.map((row) => row.id),
      activeRow: selection.activeRow ?? rows[0]?.id ?? null,
    });
  };

  const pageSize = () => {
    const height = scrollRef.current?.clientHeight ?? 400;
    return Math.max(1, Math.floor(height / rowHeight) - 1);
  };

  // Colunas usadas em copiar/colar: alinhadas com o Excel (a primeira é o
  // nome da tarefa); o WBS é derivado e fica de fora.
  const editableColumns = columns.filter(
    (column) => column.type && column.apply && column.key !== "wbs",
  );

  const copySelection = async () => {
    const selected = new Set(
      selection.rows.length > 0
        ? selection.rows
        : selection.activeRow
          ? [selection.activeRow]
          : [],
    );
    const ordered = rows.filter((row) => selected.has(row.id));
    if (ordered.length === 0) return;

    const header = editableColumns.map((column) => column.label).join("\t");
    const body = ordered.map((row) => {
      const task = tasks[row.id];
      if (!task) return "";
      return editableColumns
        .map((column) => cellText(column, task as unknown as Record<string, unknown>))
        .join("\t");
    });

    try {
      await navigator.clipboard.writeText([header, ...body].join("\n"));
    } catch {
      // sem permissão de clipboard: a cópia é silenciosamente ignorada
    }
  };

  const pasteFromClipboard = async () => {
    const activeId = selection.activeRow ?? selection.rows[0];
    const task = activeId ? tasks[activeId] : undefined;
    if (!task || !activeId) return;

    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    if (!text.trim()) return;

    const plan = planPaste({
      projectId: task.projectId,
      lines: parseTsv(text),
      anchor: task,
      anchorIndex: Math.max(0, rows.findIndex((row) => row.id === activeId)),
      columns: editableColumns,
      labels: editableColumns.map((column) => column.label),
    });

    useDomainStore.getState().applyPaste({
      anchorId: activeId,
      updates: plan.updates,
      creates: plan.creates,
    });
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;

    const rowId = selection.activeRow ?? selection.rows[0];
    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      void copySelection();
      return;
    }
    if (ctrl && (event.key === "v" || event.key === "V")) {
      event.preventDefault();
      void pasteFromClipboard();
      return;
    }
    if (ctrl && (event.key === "a" || event.key === "A")) {
      event.preventDefault();
      selectAll();
      return;
    }

    if (!rowId && rows.length === 0) return;

    const activeKey = selection.activeColumn ?? "name";

    if (event.key === "F2" || event.key === "Enter") {
      if (!rowId) return;
      event.preventDefault();
      startEdit(rowId, activeKey);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (ctrl) {
        const target = event.key === "Home" ? rows[0] : rows.at(-1);
        if (target) {
          toggleRow(target.id);
          setSelection({
            activeColumn: event.key === "Home" ? columnKeys[0] : columnKeys.at(-1),
          });
        }
      } else {
        setSelection({ activeColumn: event.key === "Home" ? columnKeys[0] : columnKeys.at(-1) });
      }
      return;
    }

    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      moveRow(event.key === "PageDown" ? pageSize() : -pageSize(), event.shiftKey);
      return;
    }

    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !ctrl && !event.altKey) {
      event.preventDefault();
      moveRow(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
      return;
    }

    // com Ctrl/Meta as setas pertencem aos comandos globais (indentar, etc.)
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && !ctrl && !event.altKey) {
      event.preventDefault();
      moveActiveColumn(event.key === "ArrowRight" ? 1 : -1);
      return;
    }

    // digitação direta: o primeiro caractere substitui o conteúdo
    // (`+` e `-` ficam com a hierarquia — recolher/expandir)
    if (
      event.key.length === 1 &&
      !ctrl &&
      !event.altKey &&
      event.key !== "+" &&
      event.key !== "-"
    ) {
      const column = columns.find((candidate) => candidate.key === activeKey);
      if (column?.type) {
        event.preventDefault();
        // sem seleção, a primeira digitação começa pela primeira linha
        const targetId = rowId ?? rows[0]?.id;
        if (!targetId) return;
        if (!rowId) toggleRow(targetId);
        startEdit(targetId, activeKey, event.key);
      }
    }
  };

  const startResize = (
    event: React.PointerEvent<HTMLElement>,
    key: string,
    width: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    resizingRef.current = true;
    const startX = event.clientX;

    const onMove = (moveEvent: PointerEvent) => {
      resizeColumn(activeView, key, width + (moveEvent.clientX - startX));
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className={styles.sheet}
      data-testid="task-sheet"
      data-baseline={tracking.baseline?.id}
    >
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.addButton}
          data-testid="filters-toggle"
          onClick={() => useUiStore.getState().setPanel("filters", true)}
        >
          Filtros
        </button>
        <button
          type="button"
          className={styles.addButton}
          data-testid="views-toggle"
          onClick={() => useUiStore.getState().setPanel("views", true)}
        >
          Visões
        </button>
        <button
          type="button"
          className={styles.addButton}
          data-testid="fields-toggle"
          onClick={() => useUiStore.getState().setPanel("fields", true)}
        >
          Campos
        </button>
        <button
          type="button"
          className={styles.addButton}
          data-testid="add-task"
          onClick={() => {
            const state = useDomainStore.getState();
            const task = createTask(state.projectId ?? "", { name: "Nova tarefa" });
            state.addTask(task, state.taskOrder.length);
            toggleRow(task.id);
          }}
        >
          + Nova tarefa
        </button>

        <div className={styles.toolbarRight}>
          {notice && (
            <span className={styles.notice} data-testid="sheet-notice" role="alert">
              {notice}
            </span>
          )}
          <span className={styles.count}>{rows.length} linhas</span>

          <button
            type="button"
            className={styles.addButton}
            data-testid="columns-toggle"
            aria-expanded={columnsMenuOpen}
            onClick={() => setColumnsMenuOpen((open) => !open)}
          >
            Colunas
          </button>
        </div>

        {columnsMenuOpen && (
          <>
            <div
              className={styles.menuBackdrop}
              onClick={() => setColumnsMenuOpen(false)}
              role="presentation"
            />
            <div className={styles.columnsMenu} data-testid="columns-menu" role="menu">
              {[...COLUMNS, ...customFieldDefs].map((column) => {
                const state = fullState.find((candidate) => candidate.key === column.key);
                return (
                  <label key={column.key} className={styles.menuItem}>
                    <input
                      type="checkbox"
                      data-testid={`column-toggle-${column.key}`}
                      checked={Boolean(state?.visible)}
                      disabled={column.key === "name"}
                      onChange={() => toggleColumn(activeView, column.key)}
                    />
                    <span>{column.label || "Estrutura"}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div
        className={styles.viewport}
        ref={scrollRef}
        tabIndex={0}
        // grade hierárquica (specs/ui-shell — "papéis ARIA de tabela
        // hierárquica"): treegrid com níveis nas linhas e células reais
        role="treegrid"
        aria-label="Folha de tarefas"
        aria-multiselectable="true"
        data-testid="task-sheet-scroll"
        onKeyDown={handleGridKeyDown}
        onScroll={handleScroll}
        onFocus={() => useUiStore.getState().setFocus("grid")}
      >
        <div
          className={styles.header}
          role="row"
          style={{ gridTemplateColumns: template, height: headerHeight }}
        >
          {columns.map((column) => (
            <div
              key={column.key}
              className={[
                styles.headerCell,
                column.numeric ? styles.numeric : "",
                column.sticky ? styles.sticky : "",
              ].join(" ")}
              style={
                column.sticky
                  ? { left: offsets[column.key], position: "sticky" as const }
                  : undefined
              }
              role="columnheader"
              draggable
              data-testid={`header-${column.key}`}
              onDragStart={(event) => {
                if (resizingRef.current) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.setData("text/column", column.key);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("text/column")) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                const dragged = event.dataTransfer.getData("text/column");
                if (dragged && dragged !== column.key) {
                  moveColumnTo(activeView, dragged, column.key);
                }
              }}
            >
              <span className={styles.headerLabel}>{column.label}</span>
              <span
                className={styles.resizeHandle}
                data-testid={`resize-${column.key}`}
                onPointerDown={(event) => startResize(event, column.key, columnWidth(columnState, column.key))}
                role="separator"
                aria-label={`Redimensionar ${column.label}`}
              />
            </div>
          ))}
        </div>

        <div className={styles.body} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;

            // --- cabeçalho de grupo (agrupamento ativo) -----------------------
            if (row.isGroup) {
              return (
                <div
                  key={row.id}
                  data-testid="group-row"
                  data-group-label={row.groupLabel}
                  data-group-depth={row.groupDepth ?? 0}
                  role="row"
                  aria-level={(row.groupDepth ?? 0) + 1}
                  className={[styles.row, styles.groupRow].join(" ")}
                  style={{
                    gridTemplateColumns: template,
                    height: rowHeight,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    className={styles.groupHeader}
                    role="gridcell"
                    style={{
                      paddingLeft: `calc(var(--sp-2) + ${(row.groupDepth ?? 0) * 16}px)`,
                    }}
                  >
                    <span className={styles.groupLabel}>{row.groupLabel}</span>
                    <span className={styles.groupStat} data-testid="group-count">
                      {row.groupCount} tarefa{row.groupCount === 1 ? "" : "s"}
                    </span>
                    <span className={styles.groupStat} data-testid="group-work">
                      Σ {formatDuration(row.groupSummary?.work ?? null)}
                    </span>
                  </div>
                </div>
              );
            }

            const task = tasks[row.id];
            if (!task) return null;

            const selected = selection.rows.includes(row.id);
            const active = selection.activeRow === row.id;
            const critical = criticalVisible && criticalSet.has(row.id);

            return (
              <div
                key={row.id}
                data-testid="task-row"
                data-task-id={row.id}
                data-depth={row.depth}
                data-active={active ? "true" : "false"}
                data-selected={selected ? "true" : "false"}
                data-critical={critical ? "true" : undefined}
                role="row"
                aria-level={row.depth + 1}
                aria-selected={selected}
                aria-expanded={row.isSummary ? !row.collapsed : undefined}
                className={[
                  styles.row,
                  selected ? styles.selected : "",
                  active ? styles.active : "",
                  task.isSummary ? styles.summary : "",
                  task.isInactive ? styles.inactive : "",
                  critical ? styles.critical : "",
                ].join(" ")}
                style={{
                  gridTemplateColumns: template,
                  height: rowHeight,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                // arraste para a Timeline (specs/timeline-view — "Adicionar
                // tarefas à Timeline"); desligado durante edição de célula
                draggable={!editing}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/task-id", row.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  // aceita o drop só para arrastes de tarefa (reordenar)
                  if (!event.dataTransfer.types.includes("text/task-id")) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = event.dataTransfer.getData("text/task-id");
                  if (!draggedId || draggedId === row.id) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const after = event.clientY > rect.top + rect.height / 2;
                  moveByDrop(draggedId, row.id, after);
                }}
                onClick={(event) => toggleRow(row.id, event.ctrlKey || event.metaKey)}
              >
                {columns.map((column) => {
                  const isEditing = editing?.id === row.id && editing.key === column.key;
                  const isSticky = Boolean(column.sticky);
                  const baseClass = [
                    styles.cell,
                    column.numeric ? styles.numeric : "",
                    column.key === "name" ? styles.name : "",
                    column.key === "wbs" || column.numeric ? styles.mono : "",
                    isSticky ? styles.sticky : "",
                  ].join(" ");

                  const style: React.CSSProperties = isSticky
                    ? {
                        left: offsets[column.key],
                        position: "sticky",
                        ...(column.key === "name"
                          ? { paddingLeft: `calc(var(--sp-2) + ${row.depth * 16}px)` }
                          : {}),
                      }
                    : column.key === "name"
                      ? { paddingLeft: `calc(var(--sp-2) + ${row.depth * 16}px)` }
                      : {};

                  if (column.key === "toggle") {
                    return (
                      <div
                        key={column.key}
                        className={[styles.cell, styles.sticky, styles.center].join(" ")}
                        style={style}
                        role="gridcell"
                      >
                        {row.isSummary && (
                          <button
                            type="button"
                            className={styles.twisty}
                            aria-label={row.collapsed ? "Expandir" : "Recolher"}
                            aria-expanded={!row.collapsed}
                            data-testid="row-toggle"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleCollapsed(row.id);
                            }}
                          >
                            {row.collapsed ? "▸" : "▾"}
                          </button>
                        )}
                      </div>
                    );
                  }

                  if (isEditing && column.type && (column.apply || column.commit)) {
                    return (
                      <div
                        key={column.key}
                        className={baseClass}
                        style={style}
                        role="gridcell"
                        data-testid={`cell-${column.key}`}
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <CellEditor
                          type={column.type}
                          value={cellValue(task as unknown as Record<string, unknown>, column.key)}
                          options={column.key === "res" ? resourceNames : column.options}
                          label={`${column.label} — ${task.name}`}
                          seed={editing.seed}
                          onCommit={commitEdit}
                          onCancel={cancelEdit}
                          onEditingChange={setCellEditing}
                        />
                      </div>
                    );
                  }

                  return (
                    <div
                      key={column.key}
                      className={baseClass}
                      style={style}
                      role="gridcell"
                      data-testid={`cell-${column.key}`}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        startEdit(row.id, column.key);
                      }}
                    >
                      {column.key === "name" ? (
                        <>
                          <span className={styles.nameText}>
                            {cellText(column, task as unknown as Record<string, unknown>)}
                          </span>
                          {row.hidden > 0 && (
                            <span className={styles.hiddenBadge} data-testid="hidden-count">
                              +{row.hidden}
                            </span>
                          )}
                          {task.isMilestone && <span className={styles.marker}>◆</span>}
                        </>
                      ) : (
                        cellText(column, task as unknown as Record<string, unknown>)
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {rows.length === 0 && (
          <p
            className={styles.empty}
            data-testid={isFilterActive(query) ? "query-empty" : "task-sheet-empty"}
          >
            {isFilterActive(query)
              ? "Nenhum item corresponde aos filtros ativos. Ajuste ou limpe o filtro."
              : "Nenhuma tarefa. Use “+ Nova tarefa” para começar a WBS."}
          </p>
        )}
      </div>
    </div>
  );
}

/** Largura atual de uma coluna no estado configurado. */
function columnWidth(state: Array<{ key: string; width: number }>, key: string): number {
  return state.find((column) => column.key === key)?.width ?? 100;
}
