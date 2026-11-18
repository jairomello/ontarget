import type { Task } from "../../store/types";
import { parseCell } from "./cells";
import { createTask } from "../../store/taskFactory";
import type { ColumnDef } from "./columns";

export interface PasteUpdate {
  id: string;
  patch: Partial<Task>;
}

export interface PastePlan {
  updates: PasteUpdate[];
  creates: Task[];
}

/** Divide o texto colado em linhas/células (suporta aspas do TSV do Excel). */
export function parseTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  // descarta a linha final vazia (comum ao copiar do Excel)
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();

  return lines.map(parseLine);
}

/** Parser TSV: respeita aspas, inclusive quando contêm tabulações. */
function parseLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === "\t") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export interface PlanPasteInput {
  projectId: string;
  lines: string[][];
  /** Tarefa ativa (âncora da colagem). */
  anchor: Task;
  /** Posição da âncora em `taskOrder`. */
  anchorIndex: number;
  /** Colunas editáveis visíveis, na ordem exibida. */
  columns: ColumnDef[];
  /** Rótulos das colunas, para reconhecer cabeçalho colado do Excel. */
  labels: string[];
}

/**
 * Monta o plano de colagem (specs/task-sheet — "Colar em lote").
 *
 *  - 1 linha → atualiza a tarefa âncora;
 *  - várias linhas → cria novas tarefas a partir da âncora;
 *  - primeira linha igual aos rótulos das colunas → tratada como cabeçalho.
 */
export function planPaste(input: PlanPasteInput): PastePlan {
  const { projectId, lines, anchor, anchorIndex, columns, labels } = input;

  const rows = lines.filter((line) => line.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) return { updates: [], creates: [] };

  const editable = columns.filter((column) => column.type && column.apply);
  if (editable.length === 0) return { updates: [], creates: [] };

  const first = rows[0]!.map((cell) => cell.trim().toLowerCase());
  const header = labels.map((label) => label.trim().toLowerCase());
  const isHeader =
    first.length > 0 && first.every((cell, index) => cell === (header[index] ?? cell));
  const data = isHeader ? rows.slice(1) : rows;

  if (data.length === 0) return { updates: [], creates: [] };

  const applyLine = (task: Task, line: string[]): Partial<Task> => {
    const patch: Partial<Task> = {};
    editable.forEach((column, index) => {
      const raw = line[index];
      if (raw === undefined || raw.trim() === "" || !column.type || !column.apply) return;
      const parsed = parseCell(column.type, raw);
      if (parsed.ok) Object.assign(patch, column.apply(task, parsed.value));
    });
    return patch;
  };

  // Colagem de uma linha (sem cabeçalho): atualiza a âncora.
  if (lines.length === 1) {
    return {
      updates: [{ id: anchor.id, patch: applyLine(anchor, data[0]!) }],
      creates: [],
    };
  }

  // Colagem de várias linhas: cria uma tarefa por linha, após a âncora.
  // Linhas em branco são ignoradas.
  const creates: Task[] = data.map((line, offset) => {
    const task = createTask(projectId, {
      name: line[0]?.trim() || "Nova tarefa",
      sortOrder: anchorIndex + 1 + offset,
    });
    Object.assign(task, applyLine(task, line));
    return task;
  });

  return { updates: [], creates };
}
