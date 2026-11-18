import { parseDate, parseDuration, parsePercent } from "@ontarget/core";

/**
 * Importação JSON/CSV (specs/import-export): detecção de formato, mapeamento
 * de colunas, pré-validação com relatório e montagem do plano de gravação.
 * Puro (sem DOM) — o commit acontece no endpoint `/api/import`, que aplica
 * tudo em uma única transação.
 */

export const IMPORT_FORMAT = "ontarget";
export const IMPORT_VERSION = 1;
/**
 * Identificadores de formato aceitos na leitura além do atual: arquivos
 * exportados antes do rename `e-project` → `ontarget`.
 */
const LEGACY_IMPORT_FORMATS = new Set(["e-project"]);
/** Limite de linhas por importação (specs/import-export). */
export const IMPORT_ROW_LIMIT = 50_000;

export type ImportSource = "csv" | "json";
export type ImportMode = "replace" | "merge";

/* --------------------------------------------------------------- detecção */

/** Codificação: UTF-8 estrito; sem sucesso, Windows-1252 (legado). */
export function decodeImport(buffer: ArrayBuffer): { text: string; encoding: string } {
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      encoding: "utf-8",
    };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(buffer),
      encoding: "windows-1252",
    };
  }
}

export function detectSource(text: string): ImportSource {
  const head = text.replace(/^\uFEFF/, "").trimStart();
  return head.startsWith("{") || head.startsWith("[") ? "json" : "csv";
}

/** Escolhe o delimitador que mais aparece fora de aspas na primeira linha. */
export function detectDelimiter(text: string): string {
  const firstLine = firstPhysicalLine(text.replace(/^\uFEFF/, ""));
  const candidates = [";", ",", "\t", "|"];
  let best = ";";
  let bestCount = 0;
  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      const char = firstLine[i];
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function firstPhysicalLine(text: string): string {
  const index = text.indexOf("\n");
  return index === -1 ? text : text.slice(0, index);
}

/* ------------------------------------------------------------------- CSV */

/** Linha de dados com o número da linha no arquivo (cabeçalho = 1). */
export interface CsvRow {
  cells: string[];
  line: number;
}

/** Parser CSV com aspas, aspas escapadas e quebras dentro de campo. */
export function parseCsv(text: string, delimiter: string): { header: string[]; rows: CsvRow[] } {
  const clean = text.replace(/^\uFEFF/, "");
  const matrix: string[][] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i += 1;
      cells.push(field);
      field = "";
      matrix.push(cells);
      cells = [];
      continue;
    }
    field += char;
  }
  if (field !== "" || cells.length > 0) {
    cells.push(field);
    matrix.push(cells);
  }

  const nonEmpty = matrix
    .map((row, index) => ({ row, index }))
    .filter((entry) => entry.row.some((cell) => cell.trim() !== ""));

  const header = (nonEmpty[0]?.row ?? []).map((cell) => cell.trim());
  const rows: CsvRow[] = nonEmpty.slice(1).map((entry) => ({
    cells: entry.row.map((cell) => cell.trim()),
    line: entry.index + 1, // index físico + 1 (cabeçalho na linha 1)
  }));
  return { header, rows };
}

/* -------------------------------------------------------------- mapeamento */

/** Normaliza para comparação: minúsculas, sem acentos, espaços colapsados. */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const CSV_FIELDS: Array<{ key: string; label: string }> = [
  { key: "wbs", label: "Código WBS" },
  { key: "name", label: "Nome da tarefa" },
  { key: "start", label: "Início" },
  { key: "finish", label: "Término" },
  { key: "duration", label: "Duração" },
  { key: "percent", label: "% Concluído" },
  { key: "resources", label: "Recursos" },
  { key: "predecessors", label: "Predecessores" },
  { key: "notes", label: "Notas" },
  { key: "milestone", label: "Marco" },
];

const FIELD_ALIASES: Record<string, string[]> = {
  wbs: ["wbs", "codigo", "codigo wbs", "code", "estrutura"],
  name: ["nome", "nome da tarefa", "tarefa", "name", "task", "descricao"],
  start: ["inicio", "start", "data de inicio", "data inicio"],
  finish: ["termino", "fim", "finish", "end", "data de termino", "data termino"],
  duration: ["duracao", "duration"],
  percent: ["% concluido", "percent", "percentual", "%", "concluido", "progresso"],
  resources: ["recursos", "resources", "responsaveis", "alocado em"],
  predecessors: ["predecessores", "predecessors", "pred", "dependencias"],
  notes: ["notas", "notes", "observacoes", "comentarios"],
  milestone: ["marco", "milestone", "marcador"],
};

/** Sugere o campo do produto para cada coluna do arquivo (`null` = ignorar). */
export function suggestMapping(header: readonly string[]): Array<string | null> {
  return header.map((column) => {
    const normalized = normalizeLabel(column);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(normalized)) return field;
    }
    return null;
  });
}

/* ----------------------------------------------------------------- plano */

export interface RowError {
  /** Linha do arquivo (CSV, cabeçalho = 1) ou item do array (JSON). */
  line: number;
  reason: string;
}

export interface PlannedTask {
  /** Identificador dentro do arquivo (linha CSV ou id JSON). */
  key: string;
  /** Id do pai no arquivo; `null` = raiz. */
  parentKey: string | null;
  outlineNumber: string;
  sortOrder: number;
  name: string;
  notes: string | null;
  start: number | null;
  finish: number | null;
  duration: number | null;
  durationUnit: string | null;
  percentComplete: number;
  isMilestone: boolean;
  isInactive: boolean;
  isPlaceholder: boolean;
  work: number | null;
  cost: number | null;
  calendarId: string | null;
  wbsCode: string | null;
  schedulingMode: string;
  taskType: string;
  priority: number;
  /** Campos completos vindos do JSON (linha original preservada). */
  raw?: Record<string, unknown>;
}

export interface PlannedLink {
  predecessorKey: string;
  successorKey: string;
  type: string;
  lagMs: number;
  line: number;
  /** Linha original do JSON (preservada no round-trip). */
  raw?: Record<string, unknown>;
}

export interface PlannedResource {
  key: string;
  name: string;
  raw?: Record<string, unknown>;
}

export interface PlannedAssignment {
  taskKey: string;
  resourceKey: string;
  units: number;
  line: number;
  /** Linha original do JSON (preservada no round-trip). */
  raw?: Record<string, unknown>;
}

export interface PlannedCustomField {
  key: string;
  name: string;
  entityType: string;
  dataType: string;
  raw?: Record<string, unknown>;
}

export interface PlannedCustomValue {
  fieldKey: string;
  entityKey: string;
  valueText: string | null;
  valueNum: number | null;
  valueDate: number | null;
}

export interface PlannedBaseline {
  key: string;
  name: string;
  raw?: Record<string, unknown>;
}

export interface PlannedBaselineValue {
  baselineKey: string;
  taskKey: string;
  start: number | null;
  finish: number | null;
  duration: number | null;
  work: number | null;
  cost: number | null;
}

export interface ImportPlan {
  source: ImportSource;
  mode: ImportMode;
  tasks: PlannedTask[];
  links: PlannedLink[];
  resources: PlannedResource[];
  assignments: PlannedAssignment[];
  customFields: PlannedCustomField[];
  customFieldValues: PlannedCustomValue[];
  baselines: PlannedBaseline[];
  baselineValues: PlannedBaselineValue[];
  errors: RowError[];
  /** Total de linhas/itens de tarefa lidos. */
  totalRows: number;
  /** Linhas válidas (serão importadas). */
  validRows: number;
  /** Linhas com erro (ficam de fora). */
  invalidRows: number;
  exceedsLimit: boolean;
  /** Erro global (arquivo ilegível) — anula o plano. */
  fatal?: string;
}

export const EMPTY_PLAN: ImportPlan = {
  source: "csv",
  mode: "replace",
  tasks: [],
  links: [],
  resources: [],
  assignments: [],
  customFields: [],
  customFieldValues: [],
  baselines: [],
  baselineValues: [],
  errors: [],
  totalRows: 0,
  validRows: 0,
  invalidRows: 0,
  exceedsLimit: false,
};

/** Plano zerado com arrays próprios (o `EMPTY_PLAN` não pode ser mutado). */
function makePlan(source: ImportSource, mode: ImportMode, totalRows = 0): ImportPlan {
  return {
    source,
    mode,
    tasks: [],
    links: [],
    resources: [],
    assignments: [],
    customFields: [],
    customFieldValues: [],
    baselines: [],
    baselineValues: [],
    errors: [],
    totalRows,
    validRows: 0,
    invalidRows: 0,
    exceedsLimit: false,
  };
}

/* ------------------------------------------------------------ CSV → plano */

const TRUTHY = ["sim", "s", "true", "1", "verdadeiro", "x"];

function parseFlag(value: string): boolean {
  return TRUTHY.includes(normalizeLabel(value));
}

/** Ordena por caminho WBS com comparação numérica por segmento. */
export function compareOutline(a: string, b: string): number {
  const as = a.split(".");
  const bs = b.split(".");
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const left = as[i] ?? "";
    const right = bs[i] ?? "";
    if (left === right) continue;
    const leftNum = Number(left);
    const rightNum = Number(right);
    if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum)) return leftNum - rightNum;
    return left.localeCompare(right, "pt-BR");
  }
  return 0;
}

function errorMessage(reason: string, value: string): string {
  return `${reason}: “${value}”`;
}

export function buildCsvPlan(
  rows: readonly CsvRow[],
  mapping: ReadonlyArray<string | null>,
  mode: ImportMode,
): ImportPlan {
  const plan: ImportPlan = makePlan("csv", mode, rows.length);
  plan.exceedsLimit = rows.length > IMPORT_ROW_LIMIT;

  const indexOf = (field: string): number => mapping.indexOf(field);
  const cellOf = (cells: string[], field: string): string => {
    const index = indexOf(field);
    return index === -1 ? "" : (cells[index] ?? "").trim();
  };

  // ---- 1ª passada: valida as linhas e monta as tarefas -------------------
  const rejectedLines = new Set<number>();
  const seenOutline = new Map<string, number>();
  const drafts: Array<{
    line: number;
    key: string;
    wbs: string;
    name: string;
    task: PlannedTask;
    predecessors: string[];
    resourceNames: string[];
  }> = [];

  for (const [position, row] of rows.entries()) {
    const name = cellOf(row.cells, "name");
    const wbs = cellOf(row.cells, "wbs");
    const problems: string[] = [];

    if (name === "") problems.push("Nome da tarefa vazio");

    const rawStart = cellOf(row.cells, "start");
    const start = rawStart === "" ? null : parseDate(rawStart);
    if (rawStart !== "" && start === null) problems.push(errorMessage("Data de início inválida", rawStart));

    const rawFinish = cellOf(row.cells, "finish");
    const finish = rawFinish === "" ? null : parseDate(rawFinish);
    if (rawFinish !== "" && finish === null) problems.push(errorMessage("Data de término inválida", rawFinish));

    const rawDuration = cellOf(row.cells, "duration");
    const duration = rawDuration === "" ? null : parseDuration(rawDuration);
    if (rawDuration !== "" && duration === null) problems.push(errorMessage("Duração inválida", rawDuration));

    const rawPercent = cellOf(row.cells, "percent");
    const percent = rawPercent === "" ? 0 : parsePercent(rawPercent);
    if (rawPercent !== "" && percent === null) problems.push(errorMessage("Percentual inválido", rawPercent));

    if (wbs !== "" && seenOutline.has(wbs)) {
      problems.push(errorMessage("Código WBS duplicado", wbs));
    }

    if (problems.length > 0) {
      plan.errors.push(...problems.map((reason) => ({ line: row.line, reason })));
      rejectedLines.add(row.line);
      continue;
    }
    if (wbs !== "") seenOutline.set(wbs, row.line);

    const key = `csv:${row.line}`;
    drafts.push({
      line: row.line,
      key,
      wbs,
      name,
      predecessors: cellOf(row.cells, "predecessors")
        .split(/[,;]/)
        .map((value) => value.trim())
        .filter((value) => value !== ""),
      resourceNames: cellOf(row.cells, "resources")
        .split(/[,;]/)
        .map((value) => value.trim())
        .filter((value) => value !== ""),
      task: {
        key,
        parentKey: null,
        outlineNumber: wbs,
        sortOrder: position,
        name,
        notes: cellOf(row.cells, "notes") || null,
        start,
        finish,
        duration: duration?.ms ?? null,
        durationUnit: duration?.unit ?? (rawDuration === "" ? null : "day"),
        percentComplete: percent ?? 0,
        isMilestone: parseFlag(cellOf(row.cells, "milestone")),
        isInactive: false,
        isPlaceholder: false,
        work: null,
        cost: null,
        calendarId: null,
        wbsCode: null,
        schedulingMode: "auto",
        taskType: "fixed_duration",
        priority: 500,
      },
    });
  }

  // ---- hierarquia pelo WBS (linhas sem WBS viram raízes na ordem) --------
  const byOutline = new Map<string, (typeof drafts)[number]>();
  const byKey = new Map<string, (typeof drafts)[number]>();
  let autoCounter = 0;
  for (const draft of drafts) {
    if (draft.wbs === "") {
      // raiz sem código: numerada em sequência, pulando os explícitos
      do {
        autoCounter += 1;
      } while (byOutline.has(String(autoCounter)));
      draft.wbs = String(autoCounter);
      draft.task.outlineNumber = draft.wbs;
    }
    byOutline.set(draft.wbs, draft);
    byKey.set(draft.key, draft);
  }

  for (const draft of drafts) {
    const parts = draft.wbs.split(".");
    if (parts.length === 1) continue;
    const parentWbs = parts.slice(0, -1).join(".");
    const parent = byOutline.get(parentWbs);
    if (!parent) {
      plan.errors.push({
        line: draft.line,
        reason: errorMessage("Pai inexistente no arquivo", parentWbs),
      });
      rejectedLines.add(draft.line);
      continue;
    }
    draft.task.parentKey = parent.key;
  }

  // cascata até estabilizar: filho de linha recusada e predecessor de linha
  // recusada caem junto (tudo-ou-nada, como a coluna de predecessores)
  let cascaded = true;
  while (cascaded) {
    cascaded = false;
    for (const draft of drafts) {
      if (rejectedLines.has(draft.line)) continue;

      const parentKey = draft.task.parentKey;
      if (parentKey) {
        const parent = byKey.get(parentKey);
        if (!parent || rejectedLines.has(parent.line)) {
          plan.errors.push({ line: draft.line, reason: "Tarefa pai foi recusada; linha ignorada" });
          rejectedLines.add(draft.line);
          cascaded = true;
          continue;
        }
      }

      for (const ref of draft.predecessors) {
        const target = byOutline.get(ref);
        if (!target || rejectedLines.has(target.line)) {
          plan.errors.push({
            line: draft.line,
            reason: errorMessage("Predecessor inexistente", ref),
          });
          rejectedLines.add(draft.line);
          cascaded = true;
          break;
        }
      }
    }
  }

  const finalDrafts = drafts.filter((draft) => !rejectedLines.has(draft.line));

  finalDrafts.sort((a, b) => compareOutline(a.task.outlineNumber, b.task.outlineNumber));
  finalDrafts.forEach((draft, index) => {
    draft.task.sortOrder = index;
  });
  // `isSummary` é derivado na montagem final (commit), quando os pais já
  // têm identidade resolvida.
  for (const draft of finalDrafts) {
    draft.task.isPlaceholder =
      draft.task.start === null || draft.task.finish === null || draft.task.duration === null;
  }
  plan.tasks = finalDrafts.map((draft) => draft.task);

  // ---- links por WBS (arquivo + projeto, quando mesclar) ----------------
  for (const draft of finalDrafts) {
    for (const ref of draft.predecessors) {
      const target = byOutline.get(ref);
      if (target && finalDrafts.some((candidate) => candidate.key === target.key)) {
        plan.links.push({
          predecessorKey: target.key,
          successorKey: draft.key,
          type: "fs",
          lagMs: 0,
          line: draft.line,
        });
      } else {
        plan.errors.push({
          line: draft.line,
          reason: errorMessage("Predecessor inexistente", ref),
        });
      }
    }
  }

  // ---- recursos (nomes) e atribuições ------------------------------------
  const resourceByKey = new Map<string, PlannedResource>();
  const ensureResource = (name: string): string => {
    const key = `res:${normalizeLabel(name)}`;
    if (!resourceByKey.has(key)) {
      resourceByKey.set(key, { key, name });
    }
    return key;
  };

  for (const draft of finalDrafts) {
    for (const resourceName of draft.resourceNames) {
      plan.assignments.push({
        taskKey: draft.key,
        resourceKey: ensureResource(resourceName),
        units: 1,
        line: draft.line,
      });
    }
  }
  plan.resources = [...resourceByKey.values()];

  // ---- preditores recusados invalidam o link já criado? -----------------
  // (linhas já filtradas acima; links apontando para linhas recusadas caem
  //  no "Predecessor inexistente" da passada anterior — aqui só o caso válido)
  plan.validRows = finalDrafts.length;
  plan.invalidRows = plan.totalRows - plan.validRows;
  return plan;
}

/* ---------------------------------------------------------------- JSON */

interface JsonPayload {
  format?: unknown;
  version?: unknown;
  data?: {
    tasks?: unknown;
    taskLinks?: unknown;
    resources?: unknown;
    assignments?: unknown;
    customFields?: unknown;
    customFieldValues?: unknown;
    baselines?: unknown;
    baselineValues?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildJsonPlan(text: string, mode: ImportMode): ImportPlan {
  const plan: ImportPlan = makePlan("json", mode);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ...plan, fatal: "JSON inválido: o arquivo não pôde ser lido." };
  }
  if (!isRecord(parsed)) {
    return { ...plan, fatal: "JSON inválido: estrutura não reconhecida." };
  }
  const payload = parsed as JsonPayload;
  if (payload.format !== IMPORT_FORMAT && !LEGACY_IMPORT_FORMATS.has(String(payload.format))) {
    return { ...plan, fatal: "Formato não reconhecido (esperado “ontarget”)." };
  }
  if (typeof payload.version !== "number" || payload.version > IMPORT_VERSION) {
    return {
      ...plan,
      fatal: `Versão ${String(payload.version)} não suportada por esta aplicação.`,
    };
  }
  const data = payload.data;
  if (!data || !Array.isArray(data.tasks)) {
    return { ...plan, fatal: "JSON sem a lista de tarefas (data.tasks)." };
  }

  const seenOutline = new Map<string, number>();
  const fileIds = new Set<string>();
  const rows = data.tasks;

  plan.totalRows = rows.length;
  plan.exceedsLimit = rows.length > IMPORT_ROW_LIMIT;

  const defaults = {
    notes: null,
    start: null,
    finish: null,
    duration: null,
    durationUnit: null,
    percentComplete: 0,
    isSummary: false,
    isMilestone: false,
    isInactive: false,
    isPlaceholder: false,
    schedulingMode: "auto",
    taskType: "fixed_duration",
    effortDriven: true,
    constraintType: null,
    constraintDate: null,
    deadline: null,
    manualStart: null,
    manualFinish: null,
    manualDuration: null,
    work: null,
    cost: null,
    fixedCost: null,
    actualStart: null,
    actualFinish: null,
    actualDuration: null,
    actualWork: null,
    actualCost: null,
    physicalPercent: null,
    durationEstimated: false,
    priority: 500,
    calendarId: null,
    wbsCode: null,
    recurrence: null,
    segments: null,
  } satisfies Record<string, unknown>;

  rows.forEach((entry, index) => {
    const line = index + 1;
    if (!isRecord(entry)) {
      plan.errors.push({ line, reason: "Item não é um objeto de tarefa" });
      return;
    }
    const row = entry;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const outlineNumber =
      typeof row.outlineNumber === "string" ? row.outlineNumber.trim() : "";
    if (name === "") {
      plan.errors.push({ line, reason: "Nome da tarefa vazio" });
      return;
    }
    if (outlineNumber === "") {
      plan.errors.push({ line, reason: "Tarefa sem código WBS (outlineNumber)" });
      return;
    }
    if (seenOutline.has(outlineNumber)) {
      plan.errors.push({ line, reason: `Código WBS duplicado: “${outlineNumber}”` });
      return;
    }
    const parentId = typeof row.parentId === "string" ? row.parentId : null;
    if (parentId !== null && typeof row.id !== "string") {
      plan.errors.push({ line, reason: "Tarefa com pai mas sem id" });
      return;
    }
    seenOutline.set(outlineNumber, line);
    if (typeof row.id === "string") fileIds.add(row.id);

    const task: PlannedTask = {
      key: typeof row.id === "string" ? row.id : `json:${line}`,
      parentKey: parentId,
      outlineNumber,
      sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : index,
      name,
      notes: typeof row.notes === "string" ? row.notes : null,
      start: typeof row.start === "number" ? row.start : null,
      finish: typeof row.finish === "number" ? row.finish : null,
      duration: typeof row.duration === "number" ? row.duration : null,
      durationUnit: typeof row.durationUnit === "string" ? row.durationUnit : null,
      percentComplete:
        typeof row.percentComplete === "number"
          ? Math.max(0, Math.min(100, row.percentComplete))
          : 0,
      isMilestone: Boolean(row.isMilestone),
      isInactive: Boolean(row.isInactive),
      isPlaceholder: Boolean(row.isPlaceholder),
      work: typeof row.work === "number" ? row.work : null,
      cost: typeof row.cost === "number" ? row.cost : null,
      calendarId: typeof row.calendarId === "string" ? row.calendarId : null,
      wbsCode: typeof row.wbsCode === "string" ? row.wbsCode : null,
      schedulingMode: typeof row.schedulingMode === "string" ? row.schedulingMode : "auto",
      taskType: typeof row.taskType === "string" ? row.taskType : "fixed_duration",
      priority: typeof row.priority === "number" ? row.priority : 500,
      raw: { ...defaults, ...row },
    };
    plan.tasks.push(task);
  });

  // pais referenciados precisam existir no arquivo
  const keys = new Set(plan.tasks.map((task) => task.key));
  const orphans = plan.tasks.filter(
    (task) => task.parentKey !== null && !keys.has(task.parentKey),
  );
  if (orphans.length > 0) {
    for (const orphan of orphans) {
      plan.errors.push({
        line: plan.tasks.indexOf(orphan) + 1,
        reason: "Tarefa pai inexistente no arquivo",
      });
    }
    plan.tasks = plan.tasks.filter((task) => !orphans.includes(task));
  }

  plan.tasks.sort((a, b) => compareOutline(a.outlineNumber, b.outlineNumber));
  plan.tasks.forEach((task, index) => {
    task.sortOrder = index;
  });

  // vínculos
  const links = Array.isArray(data.taskLinks) ? data.taskLinks : [];
  links.forEach((entry, index) => {
    const line = index + 1;
    if (!isRecord(entry)) return;
    const predecessorId = typeof entry.predecessorId === "string" ? entry.predecessorId : "";
    const successorId = typeof entry.successorId === "string" ? entry.successorId : "";
    if (!keys.has(predecessorId) || !keys.has(successorId)) {
      plan.errors.push({ line, reason: "Vínculo com tarefa inexistente no arquivo" });
      return;
    }
    plan.links.push({
      predecessorKey: predecessorId,
      successorKey: successorId,
      type: typeof entry.type === "string" ? entry.type : "fs",
      lagMs: typeof entry.lagMs === "number" ? entry.lagMs : 0,
      line,
      raw: entry,
    });
  });

  // recursos
  const resources = Array.isArray(data.resources) ? data.resources : [];
  const resourceNames = new Map<string, number>();
  resources.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const line = index + 1;
    if (name === "") {
      plan.errors.push({ line, reason: "Recurso sem nome" });
      return;
    }
    const normalized = normalizeLabel(name);
    if (resourceNames.has(normalized)) {
      plan.errors.push({ line, reason: `Nome de recurso duplicado: “${name}”` });
      return;
    }
    resourceNames.set(normalized, line);
    plan.resources.push({
      key: typeof entry.id === "string" ? entry.id : `json-res:${line}`,
      name,
      raw: entry,
    });
  });

  // atribuições
  const assignments = Array.isArray(data.assignments) ? data.assignments : [];
  const resourceKeys = new Set(plan.resources.map((resource) => resource.key));
  assignments.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const taskId = typeof entry.taskId === "string" ? entry.taskId : "";
    const resourceId = typeof entry.resourceId === "string" ? entry.resourceId : "";
    const line = index + 1;
    if (!keys.has(taskId)) {
      plan.errors.push({ line, reason: "Atribuição com tarefa inexistente" });
      return;
    }
    if (!resourceKeys.has(resourceId)) {
      plan.errors.push({ line, reason: "Atribuição com recurso inexistente" });
      return;
    }
    plan.assignments.push({
      taskKey: taskId,
      resourceKey: resourceId,
      units: typeof entry.units === "number" ? entry.units : 1,
      line,
      raw: entry,
    });
  });

  // campos personalizados + valores
  const fields = Array.isArray(data.customFields) ? data.customFields : [];
  fields.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const line = index + 1;
    if (name === "") {
      plan.errors.push({ line, reason: "Campo personalizado sem nome" });
      return;
    }
    plan.customFields.push({
      key: typeof entry.id === "string" ? entry.id : `json-cf:${line}`,
      name,
      entityType: typeof entry.entityType === "string" ? entry.entityType : "task",
      dataType: typeof entry.dataType === "string" ? entry.dataType : "text",
      raw: entry,
    });
  });

  const fieldKeys = new Set(plan.customFields.map((field) => field.key));
  const values = Array.isArray(data.customFieldValues) ? data.customFieldValues : [];
  values.forEach((entry) => {
    if (!isRecord(entry)) return;
    const fieldId = typeof entry.fieldId === "string" ? entry.fieldId : "";
    const entityId = typeof entry.entityId === "string" ? entry.entityId : "";
    if (!fieldKeys.has(fieldId)) return;
    if (!keys.has(entityId) && !resourceKeys.has(entityId)) return;
    plan.customFieldValues.push({
      fieldKey: fieldId,
      entityKey: entityId,
      valueText: typeof entry.valueText === "string" ? entry.valueText : null,
      valueNum: typeof entry.valueNum === "number" ? entry.valueNum : null,
      valueDate: typeof entry.valueDate === "number" ? entry.valueDate : null,
    });
  });

  // baselines + valores
  const baselines = Array.isArray(data.baselines) ? data.baselines : [];
  baselines.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const line = index + 1;
    if (name === "") {
      plan.errors.push({ line, reason: "Baseline sem nome" });
      return;
    }
    plan.baselines.push({
      key: typeof entry.id === "string" ? entry.id : `json-bl:${line}`,
      name,
      raw: entry,
    });
  });

  const baselineKeys = new Set(plan.baselines.map((baseline) => baseline.key));
  const baselineValues = Array.isArray(data.baselineValues) ? data.baselineValues : [];
  baselineValues.forEach((entry) => {
    if (!isRecord(entry)) return;
    const baselineId = typeof entry.baselineId === "string" ? entry.baselineId : "";
    const taskId = typeof entry.taskId === "string" ? entry.taskId : "";
    if (!baselineKeys.has(baselineId) || !keys.has(taskId)) return;
    plan.baselineValues.push({
      baselineKey: baselineId,
      taskKey: taskId,
      start: typeof entry.start === "number" ? entry.start : null,
      finish: typeof entry.finish === "number" ? entry.finish : null,
      duration: typeof entry.duration === "number" ? entry.duration : null,
      work: typeof entry.work === "number" ? entry.work : null,
      cost: typeof entry.cost === "number" ? entry.cost : null,
    });
  });

  plan.validRows = plan.tasks.length;
  plan.invalidRows = plan.totalRows - plan.validRows;
  return plan;
}

/* -------------------------------------------------------------- templates */

export const TEMPLATE_CSV = [
  "WBS,Nome,Início,Término,Duração,% Concluído,Recursos,Predecessores,Notas,Marco",
  "1,Planejamento,05/01/2026,09/01/2026,5d,0,, ,Fase inicial,não",
  "1.1,Levantamento,05/01/2026,06/01/2026,2d,0,Ana,,Reuniões,não",
  "1.2,Desenvolvimento,07/01/2026,09/01/2026,3d,0,Bia,1.1,,não",
  "2,Entrega,12/01/2026,12/01/2026,1d,0,,,Marco de entrega,sim",
].join("\n");

export function templateJson(): string {
  return JSON.stringify(
    {
      format: IMPORT_FORMAT,
      version: IMPORT_VERSION,
      data: {
        tasks: [
          {
            id: "t1",
            parentId: null,
            outlineLevel: 0,
            outlineNumber: "1",
            sortOrder: 0,
            name: "Planejamento",
            start: Date.UTC(2026, 0, 5),
            finish: Date.UTC(2026, 0, 9),
            duration: 45 * 3_600_000,
            durationUnit: "day",
            percentComplete: 0,
            isSummary: false,
            isMilestone: false,
            isInactive: false,
            schedulingMode: "auto",
            taskType: "fixed_duration",
            effortDriven: true,
            priority: 500,
            notes: null,
          },
        ],
        taskLinks: [],
        resources: [
          {
            id: "r1",
            name: "Ana",
            type: "work",
            maxUnits: 1,
            standardRate: 100,
            color: "#6366f1",
          },
        ],
        assignments: [{ taskId: "t1", resourceId: "r1", units: 1 }],
        customFields: [],
        customFieldValues: [],
        baselines: [],
        baselineValues: [],
      },
    },
    null,
    2,
  );
}

/* --------------------------------------------------------------- relatório */

/** CSV do relatório de erros (com aspas e neutralização de fórmula). */
export function buildErrorReport(errors: readonly RowError[]): string {
  const escape = (value: string): string => {
    const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[";\n,]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  const lines = ["Linha,Motivo"];
  for (const error of errors) {
    lines.push(`${error.line},${escape(error.reason)}`);
  }
  return lines.join("\n");
}
