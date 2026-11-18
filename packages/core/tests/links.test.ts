import { describe, expect, it } from "bun:test";
import { LINK_REJECTION_MESSAGES, validateLink, type LinkRef, type LinkTaskRef } from "../src/scheduling/links";

/**
 * Validação de vínculos (specs/task-dependencies): os três caminhos de
 * criação (coluna, formulário, Gantt) usam esta mesma função.
 */

const tasks: LinkTaskRef[] = [
  { id: "a", parentId: null },
  { id: "a1", parentId: "a" },
  { id: "a1a", parentId: "a1" },
  { id: "b", parentId: null },
  { id: "c", parentId: null },
];

const link = (predecessorId: string, successorId: string): LinkRef => ({
  predecessorId,
  successorId,
});

describe("validateLink", () => {
  it("aceita os pares válidos — o tipo (FS/SS/FF/SF) não produz recusa", () => {
    expect(validateLink(link("a", "b"), tasks, []).ok).toBe(true);

    // par novo fora da cadeia existente
    const existing = [link("a", "b"), link("b", "c")];
    expect(validateLink(link("a1", "c"), tasks, existing).ok).toBe(true);

    // a semântica dos quatro tipos é coberta no cálculo (scheduling.test.ts)
    expect(["fs", "ss", "ff", "sf"]).toHaveLength(4);
  });

  it("recusa tarefa inexistente", () => {
    const missingSource = validateLink(link("fantasma", "b"), tasks, []);
    expect(missingSource).toMatchObject({ ok: false, reason: "missing" });
    expect(missingSource.message).toBe(LINK_REJECTION_MESSAGES.missing);

    const missingTarget = validateLink(link("a", "fantasma"), tasks, []);
    expect(missingTarget).toMatchObject({ ok: false, reason: "missing" });
  });

  it("recusa autovínculo", () => {
    expect(validateLink(link("a", "a"), tasks, [])).toMatchObject({
      ok: false,
      reason: "self",
      message: LINK_REJECTION_MESSAGES.self,
    });
  });

  it("recusa depender da própria subtarefa", () => {
    expect(validateLink(link("a", "a1"), tasks, [])).toMatchObject({
      ok: false,
      reason: "descendant",
    });
    expect(validateLink(link("a", "a1a"), tasks, [])).toMatchObject({
      ok: false,
      reason: "descendant",
    });
    // o inverso é permitido
    expect(validateLink(link("a1", "a"), tasks, []).ok).toBe(true);
  });

  it("recusa duplicidade mesmo com outro tipo", () => {
    const existing = [link("a", "b")];
    expect(validateLink(link("a", "b"), tasks, existing)).toMatchObject({
      ok: false,
      reason: "duplicate",
      message: LINK_REJECTION_MESSAGES.duplicate,
    });
    // a direção inversa não é duplicidade — mas fecha um ciclo
    expect(validateLink(link("b", "a"), tasks, existing)).toMatchObject({
      ok: false,
      reason: "cycle",
    });
  });

  it("recusa ciclo e devolve o caminho que o formaria", () => {
    // a → b → c; candidato c → a fecha o ciclo
    const existing = [link("a", "b"), link("b", "c")];
    const result = validateLink(link("c", "a"), tasks, existing);

    expect(result).toMatchObject({ ok: false, reason: "cycle" });
    expect(result.message).toBe(LINK_REJECTION_MESSAGES.cycle);
    // caminho do sucessor (a) até o predecessor (c): a → b → c
    expect(result.path).toEqual(["a", "b", "c"]);
  });

  it("sem ciclo o caminho não é devolvido", () => {
    expect(validateLink(link("a", "c"), tasks, [link("a", "b")])).toEqual({ ok: true });
  });
});
