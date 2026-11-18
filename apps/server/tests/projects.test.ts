import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createDb } from "../src/db/index";
import * as schema from "../src/db/schema";
import { createAuthedApp } from "./helpers/auth";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "projects-"));
const dbPath = path.join(dir, "projects.db");
const db = createDb(dbPath);
const { fetch } = await createAuthedApp(db);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function json(res: Response): Promise<any> {
  return res.json();
}

async function createProject(name: string, templateKey?: string): Promise<any> {
  const res = await fetch(
    new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, templateKey }),
    }),
  );
  expect(res.status).toBe(201);
  return json(res);
}

describe("POST /api/projects", () => {
  it("cria o projeto com calendário padrão e recupera por GET", async () => {
    const { project, summary } = await createProject("Portal Institucional");

    expect(project.name).toBe("Portal Institucional");
    expect(project.archived).toBe(false);
    expect(project.calendarId).toBeTruthy();
    expect(project.templateKey).toBe("vazio");
    expect(summary.task_count).toBe(0);

    const opened = await json(
      await fetch(new Request(`http://localhost/api/projects/${project.id}`)),
    );
    expect(opened.project.id).toBe(project.id);
    expect(opened.project.name).toBe("Portal Institucional");
    expect(opened.summary.task_count).toBe(0);
  });

  it("aceita o template de entrega de software com a estrutura de tarefas", async () => {
    const { project, summary } = await createProject("Sistema de Vendas", "entrega-software");

    expect(project.templateKey).toBe("entrega-software");
    expect(summary.task_count).toBe(12);
    expect(summary.percent_complete).toBe(0);
  });

  it("rejeita criação sem nome", async () => {
    const res = await fetch(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("invalid_body");
  });
});

describe("GET /api/projects", () => {
  it("lista o portfólio com o resumo de cada projeto", async () => {
    const { project } = await createProject("Listagem Teste");
    const body = await json(await fetch(new Request("http://localhost/api/projects")));

    expect(Array.isArray(body.projects)).toBe(true);
    const found = body.projects.find((p: any) => p.project_id === project.id);
    expect(found).toBeDefined();
    expect(found.task_count).toBe(0);
    expect(typeof found.updated_at).toBe("number");
  });
});

describe("PATCH /api/projects/:id", () => {
  it("altera metadados e persiste a alteração", async () => {
    const { project } = await createProject("Nome Original");

    const patched = await json(
      await fetch(
        new Request(`http://localhost/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Nome Alterado", color: "#16a34a" }),
        }),
      ),
    );
    expect(patched.project.name).toBe("Nome Alterado");
    expect(patched.project.color).toBe("#16a34a");

    const reopened = await json(
      await fetch(new Request(`http://localhost/api/projects/${project.id}`)),
    );
    expect(reopened.project.name).toBe("Nome Alterado");
    expect(reopened.project.color).toBe("#16a34a");
  });

  it("responde 404 para projeto inexistente", async () => {
    const res = await fetch(
      new Request("http://localhost/api/projects/nao-existe", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:id/duplicate", () => {
  it("cria cópia integral sem afetar o original", async () => {
    const { project, summary } = await createProject("Original", "entrega-software");

    const copy = await json(
      await fetch(
        new Request(`http://localhost/api/projects/${project.id}/duplicate`, {
          method: "POST",
        }),
      ),
    );
    expect(copy.project.id).not.toBe(project.id);
    expect(copy.project.name).toBe("Original (cópia)");
    expect(copy.summary.task_count).toBe(summary.task_count);

    // alterar a cópia não toca no original
    await fetch(
      new Request(`http://localhost/api/projects/${copy.project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Cópia Alterada" }),
      }),
    );

    const original = await json(
      await fetch(new Request(`http://localhost/api/projects/${project.id}`)),
    );
    expect(original.project.name).toBe("Original");
    expect(original.summary.task_count).toBe(summary.task_count);
  });

  it("responde 404 ao duplicar projeto inexistente", async () => {
    const res = await fetch(
      new Request("http://localhost/api/projects/sumido/duplicate", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:id/archive", () => {
  it("move o projeto para a área de arquivados", async () => {
    const { project } = await createProject("Para Arquivar");

    await fetch(
      new Request(`http://localhost/api/projects/${project.id}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      }),
    );

    const active = await json(await fetch(new Request("http://localhost/api/projects")));
    expect(active.projects.some((p: any) => p.project_id === project.id)).toBe(false);

    const archived = await json(
      await fetch(new Request("http://localhost/api/projects?archived=true")),
    );
    expect(archived.projects.some((p: any) => p.project_id === project.id)).toBe(true);
  });
});

describe("DELETE /api/projects/:id", () => {
  it("remove o projeto e passa a responder 404", async () => {
    const { project } = await createProject("Para Excluir");

    const removed = await fetch(
      new Request(`http://localhost/api/projects/${project.id}`, { method: "DELETE" }),
    );
    expect(removed.status).toBe(204);

    const after = await fetch(new Request(`http://localhost/api/projects/${project.id}`));
    expect(after.status).toBe(404);

    const list = await json(await fetch(new Request("http://localhost/api/projects")));
    expect(list.projects.some((p: any) => p.project_id === project.id)).toBe(false);
  });

  it("responde 404 ao excluir o que não existe", async () => {
    const res = await fetch(
      new Request("http://localhost/api/projects/fantasma", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });

  it("permite desfazer a exclusão com a cópia guardada", async () => {
    const { project, summary } = await createProject("Excluível e Recuperável", "entrega-software");

    const removed = await fetch(
      new Request(`http://localhost/api/projects/${project.id}`, { method: "DELETE" }),
    );
    expect(removed.status).toBe(204);

    const restored = await json(
      await fetch(
        new Request(`http://localhost/api/projects/${project.id}/restore`, { method: "POST" }),
      ),
    );
    expect(restored.project.id).toBe(project.id);
    expect(restored.project.name).toBe("Excluível e Recuperável");
    expect(restored.summary.task_count).toBe(summary.task_count);

    // sem cópia pendente, o segundo desfazer não encontra nada
    const again = await fetch(
      new Request(`http://localhost/api/projects/${project.id}/restore`, { method: "POST" }),
    );
    expect(again.status).toBe(404);
  });
});

describe("persistência entre sessões", () => {
  it("reabrir o banco preserva os projetos gravados", async () => {
    const { project } = await createProject("Sobrevive ao Fechamento");

    const reopened = createDb(dbPath);
    const row = reopened
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id))
      .get();

    expect(row?.name).toBe("Sobrevive ao Fechamento");
  });
});
