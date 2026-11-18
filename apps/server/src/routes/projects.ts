import { Hono } from "hono";
import type { Db } from "../db/index";
import * as svc from "../services/projects";
import {
  createSnapshot,
  maybeSnapshot,
  openProjectSafe,
  recoverFromSnapshot,
} from "../services/snapshot";
import { applySync, SyncError, type SyncBatch } from "../services/sync";
import { importProjectData, type ImportPayload } from "../services/import";

function badRequest(message: string) {
  return { error: { code: "invalid_body", message } } as const;
}

function notFound() {
  return { error: { code: "not_found", message: "Projeto não encontrado" } } as const;
}

/**
 * API de projetos (specs/portfolio).
 * Recebe uma fábrica de `Db` para que os testes usem um banco próprio.
 */
export function projectsRoutes(getDb: () => Db) {
  const app = new Hono();

  /** Lista o portfólio; `?archived=true` devolve os arquivados. */
  app.get("/", (c) => {
    const archived = c.req.query("archived") === "true";
    return c.json({ projects: svc.listProjects(getDb(), { archived }) });
  });

  /** Cria um projeto (com calendário padrão e tarefas do template). */
  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      color?: string;
      start?: number;
      templateKey?: string;
    } | null;

    if (!body || typeof body.name !== "string" || body.name.trim() === "") {
      return c.json(badRequest("Informe um nome para o projeto"), 400);
    }

    const created = svc.createProject(getDb(), {
      name: body.name.trim(),
      color: body.color,
      start: body.start ?? null,
      templateKey: body.templateKey ?? null,
    });

    return c.json({ project: created.project, summary: created.summary }, 201);
  });

  /** Abre um projeto (aggregate); sinaliza dados corrompidos com os snapshots. */
  app.get("/:id", (c) => {
    const id = c.req.param("id");
    if (!svc.getProjectRow(getDb(), id)) return c.json(notFound(), 404);

    const opened = openProjectSafe(getDb(), id);
    if (!opened.ok) {
      return c.json(
        {
          error: {
            code: "project_corrupt",
            message: opened.reason,
            snapshots: opened.snapshots,
          },
        },
        409,
      );
    }

    const found = svc.getProjectDetail(getDb(), id);
    if (!found) return c.json(notFound(), 404);
    return c.json(found);
  });

  /** Altera metadados (inclusive arquivar/desarquivar via `archived`). */
  app.patch("/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as svc.UpdateProjectInput | null;
    if (!body || typeof body !== "object") {
      return c.json(badRequest("Corpo ausente ou inválido"), 400);
    }

    const updated = svc.updateProject(getDb(), c.req.param("id"), body);
    if (!updated) return c.json(notFound(), 404);
    return c.json(updated);
  });

  /** Arquiva ou desarquiva. */
  app.post("/:id/archive", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { archived?: boolean } | null;
    if (!body || typeof body.archived !== "boolean") {
      return c.json(badRequest("Informe `archived` como booleano"), 400);
    }

    const updated = svc.updateProject(getDb(), c.req.param("id"), {
      archived: body.archived,
    });
    if (!updated) return c.json(notFound(), 404);
    return c.json(updated);
  });

  /** Duplica o projeto com todos os dados. */
  app.post("/:id/duplicate", (c) => {
    const copy = svc.duplicateProject(getDb(), c.req.param("id"));
    if (!copy) return c.json(notFound(), 404);
    return c.json(copy, 201);
  });

  /**
   * Sincronização em lote: upserts e deletes por chave primária.
   * Idempotente — reenviar o mesmo lote não altera o resultado.
   */
  app.post("/:id/sync", async (c) => {
    const id = c.req.param("id");
    if (!svc.getProjectRow(getDb(), id)) return c.json(notFound(), 404);

    const body = (await c.req.json().catch(() => null)) as SyncBatch | null;
    if (!body || typeof body !== "object") {
      return c.json(badRequest("Corpo ausente ou inválido"), 400);
    }

    try {
      const result = applySync(getDb(), id, {
        upserts: body.upserts ?? {},
        deletes: body.deletes ?? {},
      });
      // Snapshot periódico: no máximo um a cada 5 minutos em uso contínuo.
      maybeSnapshot(getDb(), id);
      return c.json(result);
    } catch (err) {
      if (err instanceof SyncError) {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      throw err;
    }
  });

  /** Cria um snapshot de recuperação sob demanda. */
  app.post("/:id/snapshot", (c) => {
    const info = createSnapshot(getDb(), c.req.param("id"));
    if (!info) return c.json(notFound(), 404);
    return c.json({ snapshot: info }, 201);
  });

  /**
   * Importação transacional (specs/import-export — "Importação
   * transacional"): substitui ou mescla dados em uma única transação;
   * qualquer falha desfaz tudo (nada de estado parcial).
   */
  app.post("/:id/import", async (c) => {
    const id = c.req.param("id");
    if (!svc.getProjectRow(getDb(), id)) return c.json(notFound(), 404);

    const body = (await c.req.json().catch(() => null)) as ImportPayload | null;
    if (!body || typeof body !== "object") {
      return c.json(badRequest("Corpo ausente ou inválido"), 400);
    }
    if (body.mode !== "replace" && body.mode !== "merge") {
      return c.json(badRequest("`mode` deve ser “replace” ou “merge”"), 400);
    }
    if (!body.upserts || typeof body.upserts !== "object" || Array.isArray(body.upserts)) {
      return c.json(badRequest("Informe `upserts`"), 400);
    }
    if (body.mode === "replace" && !Array.isArray(body.replaceEntities)) {
      return c.json(badRequest("Informe `replaceEntities` na substituição"), 400);
    }
    const replaceEntities = Array.isArray(body.replaceEntities)
      ? body.replaceEntities.filter((entity): entity is string => typeof entity === "string")
      : [];

    try {
      const result = importProjectData(getDb(), id, {
        mode: body.mode,
        replaceEntities,
        upserts: body.upserts,
      });
      // Snapshot periódico: mesmo ritmo do sync.
      maybeSnapshot(getDb(), id);
      return c.json(result);
    } catch (err) {
      if (err instanceof SyncError) {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      // Violação de restrição/FK: a transação já desfez tudo.
      return c.json(
        {
          error: {
            code: "import_failed",
            message: "Falha ao aplicar a importação — nada foi alterado.",
          },
        },
        400,
      );
    }
  });

  /** Recupera os dados do projeto a partir de um snapshot. */
  app.post("/:id/recover", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as { snapshotId?: string } | null;
    if (!body?.snapshotId) {
      return c.json(badRequest("Informe `snapshotId`"), 400);
    }

    const recovered = recoverFromSnapshot(getDb(), id, body.snapshotId);
    if (!recovered) {
      return c.json(
        { error: { code: "not_found", message: "Snapshot não encontrado" } },
        404,
      );
    }
    return c.json(svc.getProject(getDb(), id));
  });

  /** Exclui definitivamente (cascata); guarda cópia por 10 s para desfazer. */
  app.delete("/:id", (c) => {
    const removed = svc.deleteProject(getDb(), c.req.param("id"));
    if (!removed) return c.json(notFound(), 404);
    return c.body(null, 204);
  });

  /** Desfaz uma exclusão recente. */
  app.post("/:id/restore", (c) => {
    const restored = svc.restoreProject(getDb(), c.req.param("id"));
    if (!restored) {
      return c.json(
        { error: { code: "not_found", message: "Nenhuma exclusão recente para desfazer" } },
        404,
      );
    }
    return c.json(restored, 201);
  });

  return app;
}
