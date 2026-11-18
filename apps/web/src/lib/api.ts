/**
 * Cliente HTTP da API do ontarget.
 * Erros viram `ApiError` com o código vindo do servidor.
 */
import type {
  Assignment,
  Baseline,
  BaselineValue,
  Calendar,
  CalendarException,
  CustomField,
  CustomFieldValue,
  LibraryItem,
  Resource,
  Task,
  TaskLink,
  Team,
} from "../store/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Corpo adicional retornado pelo servidor (ex.: snapshots disponíveis). */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ProjectSummary {
  project_id: string;
  name: string;
  code: string | null;
  color: string | null;
  start: number | null;
  finish: number | null;
  archived: number;
  updated_at: number;
  task_count: number;
  resource_count: number;
  percent_complete: number;
  min_start: number | null;
  max_finish: number | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  code: string | null;
  color: string;
  start: number | null;
  finish: number | null;
  statusDate: number | null;
  statusAuto: boolean;
  calendarId: string | null;
  defaultTaskType: string;
  defaultSchedulingMode: string;
  percentComplete: number;
  budget: number | null;
  notes: string | null;
  archived: boolean;
  templateKey: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectAggregate {
  project: ProjectRecord;
  summary: ProjectSummary | undefined;
}

export interface ProjectDetail extends ProjectAggregate {
  data: {
    tasks: Task[];
    taskLinks: TaskLink[];
    resources: Resource[];
    assignments: Assignment[];
    calendars: Calendar[];
    calendarExceptions: CalendarException[];
    teams: Team[];
    baselines: Baseline[];
    baselineValues: BaselineValue[];
    customFields: CustomField[];
    customFieldValues: CustomFieldValue[];
    libraryItems: LibraryItem[];
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let code = "unknown_error";
    let message = `Falha na requisição (${response.status})`;
    let details: unknown;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; snapshots?: unknown };
      };
      details = body;
      if (body.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {
      // corpo não JSON: mantém a mensagem genérica
    }
    throw new ApiError(response.status, code, message, details);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const api = {
  listProjects: (archived = false) =>
    request<{ projects: ProjectSummary[] }>(
      `/api/projects?archived=${archived ? "true" : "false"}`,
    ),

  getProject: (id: string) =>
    request<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`),

  createProject: (input: { name: string; templateKey?: string; start?: number }) =>
    request<ProjectAggregate>("/api/projects", jsonInit("POST", input)),

  updateProject: (id: string, patch: Record<string, unknown>) =>
    request<ProjectAggregate>(`/api/projects/${encodeURIComponent(id)}`, jsonInit("PATCH", patch)),

  archiveProject: (id: string, archived: boolean) =>
    request<ProjectAggregate>(`/api/projects/${encodeURIComponent(id)}/archive`, {
      ...jsonInit("POST", { archived }),
    }),

  duplicateProject: (id: string) =>
    request<ProjectAggregate>(`/api/projects/${encodeURIComponent(id)}/duplicate`, {
      method: "POST",
    }),

  deleteProject: (id: string) =>
    request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),

  restoreProject: (id: string) =>
    request<ProjectAggregate>(`/api/projects/${encodeURIComponent(id)}/restore`, {
      method: "POST",
    }),

  /** Recupera o projeto a partir de um snapshot (dados corrompidos). */
  recoverProject: (id: string, snapshotId: string) =>
    request<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}/recover`, {
      ...jsonInit("POST", { snapshotId }),
    }),

  /** Envio em lote das alterações do domínio (idempotente). */
  sync: (id: string, batch: SyncBatch) =>
    request<{ upserted: Record<string, number>; deleted: Record<string, number> }>(
      `/api/projects/${encodeURIComponent(id)}/sync`,
      jsonInit("POST", batch),
    ),

  /** Importação transacional (substitui ou mescla em uma única transação). */
  importProject: (
    id: string,
    payload: { mode: "replace" | "merge"; replaceEntities: string[]; upserts: Record<string, unknown[]> },
  ) =>
    request<{ upserted: Record<string, number>; deleted: Record<string, number> }>(
      `/api/projects/${encodeURIComponent(id)}/import`,
      jsonInit("POST", payload),
    ),
};

export interface SyncBatch {
  upserts?: Record<string, unknown[]>;
  /** Ids simples ou tuplas da chave primária composta. */
  deletes?: Record<string, Array<string | [string, string]>>;
}

/** Datas em pt-BR sempre em UTC-naive (docs/architecture.md §8.1). */
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return dateTimeFormatter.format(new Date(value));
}
