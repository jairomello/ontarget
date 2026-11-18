import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  registerAppCommands,
  resetCommands,
} from "../src/commands";
import { buildShortcutsMarkdown } from "../src/commands/shortcutsDoc";
import { buildJsonPlan, TEMPLATE_CSV } from "../src/features/import/importing";

/**
 * Documentação publicada (tarefa 11.5): `docs/atalhos.md` é gerado do
 * keymap registrado, o template documentado em `docs/importacao.md` é o
 * mesmo que o download entrega e o exemplo JSON do doc é importável.
 */

const docsDir = path.resolve(import.meta.dir, "../../../docs");

function readDoc(name: string): string {
  return readFileSync(path.join(docsDir, name), "utf-8");
}

describe("docs/atalhos.md", () => {
  it("bate exatamente com o keymap registrado", () => {
    resetCommands();
    registerAppCommands();

    const expected = buildShortcutsMarkdown();
    expect(readDoc("atalhos.md")).toBe(expected);
  });

  it("documenta os atalhos críticos com as teclas corretas", () => {
    const doc = readDoc("atalhos.md");
    expect(doc).toContain("| Indentar (virar subtarefa) | `Ctrl+Shift+Right` |");
    expect(doc).toContain("| Inserir tarefa | `Insert` |");
    expect(doc).toContain("| Inserir subtarefa | `Ctrl+Insert` |");
    expect(doc).toContain("| Ajustar ao projeto | `Ctrl+0` |");
    expect(doc).toContain("| Mostrar atalhos de teclado | `?` |");
  });
});

describe("docs/importacao.md", () => {
  it("o template documentado é exatamente o template do código", () => {
    const doc = readDoc("importacao.md");
    const match = doc.match(/```csv\n([\s\S]*?)```/);
    expect(match, "bloco csv no doc").not.toBeNull();
    expect(match![1]!.replace(/\n$/, "")).toBe(TEMPLATE_CSV);
  });

  it("o exemplo JSON do doc é aceito pela importação", () => {
    const doc = readDoc("importacao.md");
    const match = doc.match(/```json\n([\s\S]*?)```/);
    expect(match, "bloco json no doc").not.toBeNull();

    const plan = buildJsonPlan(match![1]!, "replace");
    expect(plan.fatal).toBeUndefined();
    expect(plan.errors).toHaveLength(0);
    expect(plan.totalRows).toBe(2);
    expect(plan.tasks.map((task) => task.name)).toEqual([
      "Planejamento",
      "Levantamento",
    ]);
  });

  it("documenta o limite e os modos reais", () => {
    const doc = readDoc("importacao.md");
    expect(doc).toContain("50.000 linhas");
    expect(doc).toContain("**Substituir**");
    expect(doc).toContain("**Mesclar**");
  });
});

describe("docs/guia-de-uso.md", () => {
  it("referencia os documentos vizinhos", () => {
    const guide = readDoc("guia-de-uso.md");
    expect(guide).toContain("[atalhos.md](atalhos.md)");
    expect(guide).toContain("[importacao.md](importacao.md)");
  });
});
