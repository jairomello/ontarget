import { getGanttApi } from "../features/gantt/ganttApi";
import { useDomainStore } from "../store/domainStore";
import { useHistoryStore } from "../store/historyStore";
import { createTask } from "../store/taskFactory";
import { useUiStore } from "../store/uiStore";
import { registerCommand } from "./registry";
import type { CommandContext } from "./types";

function selectedIds(): string[] {
  return useUiStore.getState().selection.rows;
}

/** Descendentes diretos e indiretos de um nó (pré-ordem do domínio). */
function subtreeIds(rootId: string): string[] {
  const state = useDomainStore.getState();
  const children = new Map<string, string[]>();

  for (const id of state.taskOrder) {
    const task = state.tasks[id];
    if (!task?.parentId) continue;
    const list = children.get(task.parentId);
    if (list) list.push(id);
    else children.set(task.parentId, [id]);
  }

  const out: string[] = [];
  const queue = [...(children.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}

function undoable(ctx: CommandContext): boolean {
  void ctx;
  return useHistoryStore.getState().past.length > 0;
}

function redoable(ctx: CommandContext): boolean {
  void ctx;
  return useHistoryStore.getState().future.length > 0;
}

/**
 * Comandos registrados uma única vez — o keymap e os menus os invocam
 * pelo mesmo id (docs/architecture.md §7.2).
 */
export function registerAppCommands(): void {
  // --- globais ------------------------------------------------------------
  registerCommand({
    id: "global.undo",
    scope: "global",
    label: "Desfazer",
    keys: ["Ctrl+Z"],
    when: undoable,
    run: () => void useDomainStore.getState().undo(),
  });

  registerCommand({
    id: "global.redo",
    scope: "global",
    label: "Refazer",
    keys: ["Ctrl+Y", "Ctrl+Shift+Z"],
    when: redoable,
    run: () => void useDomainStore.getState().redo(),
  });

  registerCommand({
    id: "global.toggleFocus",
    scope: "global",
    label: "Alternar foco entre Task Sheet e Gantt",
    keys: ["F6"],
    run: () => {
      const ui = useUiStore.getState();
      ui.setFocus(ui.focus === "grid" ? "gantt" : "grid");
    },
  });

  registerCommand({
    id: "global.toggleDetails",
    scope: "global",
    label: "Abrir/fechar os detalhes da tarefa",
    keys: ["F4"],
    priority: 10,
    run: () => {
      const ui = useUiStore.getState();
      ui.setPanel("details", !ui.panels.details);
    },
  });

  registerCommand({
    id: "global.showShortcuts",
    scope: "global",
    label: "Mostrar atalhos de teclado",
    keys: ["?"],
    priority: 20,
    run: () => useUiStore.getState().setShortcutsOpen(true),
  });

  registerCommand({
    id: "global.closeOverlay",
    scope: "global",
    label: "Fechar painel sobreposto",
    keys: ["Escape"],
    priority: 30,
    when: () => useUiStore.getState().shortcutsOpen,
    run: () => useUiStore.getState().setShortcutsOpen(false),
  });

  // --- Task Sheet ---------------------------------------------------------
  registerCommand({
    id: "grid.indent",
    scope: "grid",
    label: "Indentar (virar subtarefa)",
    keys: ["Ctrl+Shift+Right"],
    priority: 10,
    when: () => selectedIds().length > 0,
    run: () => void useDomainStore.getState().indentTasks(selectedIds()),
  });

  registerCommand({
    id: "grid.outdent",
    scope: "grid",
    label: "Outdentar (promover um nível)",
    keys: ["Ctrl+Shift+Left"],
    priority: 10,
    when: () => selectedIds().length > 0,
    run: () => void useDomainStore.getState().outdentTasks(selectedIds()),
  });

  registerCommand({
    id: "grid.expandAll",
    scope: "grid",
    label: "Expandir toda a hierarquia",
    keys: ["Ctrl+*"],
    priority: 10,
    run: () => useUiStore.getState().expandAll(),
  });

  registerCommand({
    id: "grid.collapseSubtree",
    scope: "grid",
    label: "Recolher toda a subárvore",
    keys: ["Ctrl+-"],
    priority: 10,
    when: () => selectedIds().length > 0,
    run: () => {
      const ui = useUiStore.getState();
      const root = ui.selection.activeRow ?? ui.selection.rows[0];
      if (!root) return;
      for (const id of [root, ...subtreeIds(root)]) ui.setCollapsed(id, true);
    },
  });

  registerCommand({
    id: "grid.expandSubtree",
    scope: "grid",
    label: "Expandir toda a subárvore",
    keys: ["Ctrl++"],
    priority: 10,
    when: () => selectedIds().length > 0,
    run: () => {
      const ui = useUiStore.getState();
      const root = ui.selection.activeRow ?? ui.selection.rows[0];
      if (!root) return;
      for (const id of [root, ...subtreeIds(root)]) ui.setCollapsed(id, false);
    },
  });

  registerCommand({
    id: "grid.toggleCollapse",
    scope: "grid",
    label: "Recolher/expandir o nó selecionado",
    keys: ["+", "-"],
    priority: 10,
    when: () => selectedIds().length > 0,
    run: () => {
      const ui = useUiStore.getState();
      const id = ui.selection.activeRow ?? ui.selection.rows[0];
      if (id) ui.toggleCollapsed(id);
    },
  });

  // --- inserção por teclado (specs/task-sheet — "Estrutura por teclado na
  // grade": Insert e Ctrl+Insert com o mesmo resultado do comando) ---------
  registerCommand({
    id: "grid.insertTask",
    scope: "grid",
    label: "Inserir tarefa",
    keys: ["Insert"],
    run: () => {
      const state = useDomainStore.getState();
      if (!state.projectId) return;
      const task = createTask(state.projectId, { name: "Nova tarefa" });
      state.addTask(task, state.taskOrder.length);
      useUiStore.getState().setSelection({
        rows: [task.id],
        activeRow: task.id,
        activeColumn: "name",
      });
    },
  });

  registerCommand({
    id: "grid.insertSubtask",
    scope: "grid",
    label: "Inserir subtarefa",
    keys: ["Ctrl+Insert"],
    run: () => {
      const state = useDomainStore.getState();
      if (!state.projectId) return;
      const parentId = useUiStore.getState().selection.activeRow;
      const parent = parentId ? state.tasks[parentId] : undefined;

      if (!parent) {
        // sem seleção, equivale a inserir uma tarefa comum
        const task = createTask(state.projectId, { name: "Nova tarefa" });
        state.addTask(task, state.taskOrder.length);
        useUiStore.getState().setSelection({
          rows: [task.id],
          activeRow: task.id,
          activeColumn: "name",
        });
        return;
      }

      // entra como última filha, logo após a subárvore do pai (pré-ordem)
      const order = state.taskOrder;
      const isDescendantOfParent = (id: string): boolean => {
        let current = state.tasks[id]?.parentId ?? null;
        while (current !== null) {
          if (current === parent.id) return true;
          current = state.tasks[current]?.parentId ?? null;
        }
        return false;
      };
      let position = order.indexOf(parent.id) + 1;
      while (position < order.length && isDescendantOfParent(order[position]!)) position += 1;

      const task = createTask(state.projectId, {
        name: "Nova subtarefa",
        parentId: parent.id,
        outlineLevel: parent.outlineLevel + 1,
      });
      state.addTask(task, position);
      useUiStore.getState().setSelection({
        rows: [task.id],
        activeRow: task.id,
        activeColumn: "name",
      });
    },
  });

  // --- ordenação e exclusão (specs/task-structure — "Ordenação de tarefas";
  // expostos pela ribbon da barra de comandos) ------------------------------
  registerCommand({
    id: "grid.moveUp",
    scope: "grid",
    label: "Mover para cima",
    keys: ["Alt+Up"],
    when: () => selectedIds().length > 0,
    run: () => {
      const ids = useUiStore.getState().selection.rows;
      if (ids.length > 0) useDomainStore.getState().moveTasks(ids, "up");
    },
  });

  registerCommand({
    id: "grid.moveDown",
    scope: "grid",
    label: "Mover para baixo",
    keys: ["Alt+Down"],
    when: () => selectedIds().length > 0,
    run: () => {
      const ids = useUiStore.getState().selection.rows;
      if (ids.length > 0) useDomainStore.getState().moveTasks(ids, "down");
    },
  });

  registerCommand({
    id: "grid.deleteTask",
    scope: "grid",
    label: "Excluir tarefas selecionadas",
    // sem tecla: no Gantt a tecla Delete remove vínculos
    // (specs/task-dependencies — "Remoção de vínculo")
    when: () => selectedIds().length > 0,
    run: () => {
      const ids = [...useUiStore.getState().selection.rows];
      if (ids.length === 0) return;
      if (useDomainStore.getState().removeTasks(ids)) {
        useUiStore.getState().clearSelection();
      }
    },
  });

  // --- Gantt --------------------------------------------------------------
  registerCommand({
    id: "gantt.zoomIn",
    scope: "gantt",
    label: "Ampliar",
    keys: ["+"],
    priority: 10,
    run: () => {
      const ui = useUiStore.getState();
      ui.setZoom({ pxPerDay: Math.min(4000, ui.zoom.pxPerDay * 1.4) });
    },
  });

  registerCommand({
    id: "gantt.zoomOut",
    scope: "gantt",
    label: "Reduzir",
    keys: ["-"],
    priority: 10,
    run: () => {
      const ui = useUiStore.getState();
      ui.setZoom({ pxPerDay: Math.max(1.5, ui.zoom.pxPerDay / 1.4) });
    },
  });

  registerCommand({
    id: "gantt.fitProject",
    scope: "gantt",
    label: "Ajustar ao projeto",
    keys: ["Ctrl+0"],
    priority: 10,
    run: () => {
      const api = getGanttApi();
      if (api) api.fit("project");
      else useUiStore.getState().setZoom({ pxPerDay: 26, preset: "fit-project", forcedUnit: null });
    },
  });

  registerCommand({
    id: "gantt.fitSelection",
    scope: "gantt",
    label: "Ajustar à seleção",
    keys: ["Ctrl+1"],
    priority: 10,
    run: () => {
      const api = getGanttApi();
      if (api) api.fit("selection");
      else useUiStore.getState().setZoom({ pxPerDay: 26, preset: "fit-selection", forcedUnit: null });
    },
  });
}
