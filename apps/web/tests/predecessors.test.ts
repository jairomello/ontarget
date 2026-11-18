import { beforeEach, describe, expect, it } from "bun:test";
import { DAY_MS } from "@ontarget/core";
import { resetDirtyListeners } from "../src/store/dirty";
import { useDomainStore } from "../src/store/domainStore";
import { useHistoryStore } from "../src/store/historyStore";
import { useUiStore } from "../src/store/uiStore";
import type { ProjectData } from "../src/store/types";
import {
  applyPredecessors,
  formatPredecessorRef,
  parsePredecessorToken,
  predecessorsText,
} from "../src/features/shared/predecessors";
import { makeTask } from "./helpers/task";

/**
 * Árvore simples:
 *   A (1)  B (2)  C (3)  D (4)
 * Sem vínculos — cada teste cria os seus.
 */
function loadGraph(): void {
  const data: ProjectData = {
    tasks: [
      makeTask("A", "A", { sortOrder: 0, outlineNumber: "1" }),
      makeTask("B", "B", { sortOrder: 1, outlineNumber: "2" }),
      makeTask("C", "C", { sortOrder: 2, outlineNumber: "3" }),
      makeTask("D", "D", { sortOrder: 3, outlineNumber: "4" }),
    ],
    taskLinks: [],
    resources: [],
    assignments: [],
  };
  useDomainStore.getState().load("p1", data);
}

const links = () => Object.values(useDomainStore.getState().taskLinks);

beforeEach(() => {
  resetDirtyListeners();
  useHistoryStore.getState().clear();
  useUiStore.getState().clearSelection();
  loadGraph();
});

describe("parsePredecessorToken", () => {
  it("só o código WBS vira Término-Início sem latência", () => {
    expect(parsePredecessorToken("1.1")).toEqual({ wbs: "1.1", type: "fs", lagMs: 0 });
  });

  it("reconhece os quatro tipos de predecessão", () => {
    expect(parsePredecessorToken("2.3SS")).toEqual({ wbs: "2.3", type: "ss", lagMs: 0 });
    expect(parsePredecessorToken("2.3FF")).toEqual({ wbs: "2.3", type: "ff", lagMs: 0 });
    expect(parsePredecessorToken("1.1SF")).toEqual({ wbs: "1.1", type: "sf", lagMs: 0 });
    expect(parsePredecessorToken("4.4FS")).toEqual({ wbs: "4.4", type: "fs", lagMs: 0 });
  });

  it("lê latência e antecipação (lead)", () => {
    expect(parsePredecessorToken("4.4+2d").lagMs).toBe(2 * DAY_MS);
    expect(parsePredecessorToken("1.1SS-1d")).toEqual({
      wbs: "1.1",
      type: "ss",
      lagMs: -DAY_MS,
    });
  });

  it("a ordem das partes é wbs, tipo, latência", () => {
    expect(parsePredecessorToken("2.3FF+1d")).toEqual({
      wbs: "2.3",
      type: "ff",
      lagMs: DAY_MS,
    });
  });
});

describe("formatPredecessorRef", () => {
  const task = makeTask("A", "A", { outlineNumber: "1.1" });

  it("omite o tipo padrão e a latência zero", () => {
    expect(formatPredecessorRef(task, { type: "fs", lagMs: 0 })).toBe("1.1");
  });

  it("mostra o tipo em maiúsculas e a latência com sinal", () => {
    expect(formatPredecessorRef(task, { type: "ss", lagMs: 0 })).toBe("1.1SS");
    expect(formatPredecessorRef(task, { type: "ff", lagMs: 2 * DAY_MS })).toBe("1.1FF+2d");
    expect(formatPredecessorRef(task, { type: "sf", lagMs: -DAY_MS })).toBe("1.1SF-1d");
  });
});

describe("applyPredecessors", () => {
  it("cria um vínculo Término-Início pelo código WBS", () => {
    expect(applyPredecessors("B", "1").errors).toEqual([]);

    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({
      id: "link:A:B:fs",
      predecessorId: "A",
      successorId: "B",
      type: "fs",
      lagMs: 0,
    });
  });

  it("cria vínculo Início-Início com latência", () => {
    expect(applyPredecessors("B", "1SS+2d").errors).toEqual([]);

    expect(links()[0]).toMatchObject({ id: "link:A:B:ss", type: "ss", lagMs: 2 * DAY_MS });
    expect(predecessorsText("B")).toBe("1SS+2d");
  });

  it("trocar o tipo recria o vínculo (o id inclui o tipo)", () => {
    applyPredecessors("B", "1");
    expect(applyPredecessors("B", "1FF").errors).toEqual([]);

    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({ id: "link:A:B:ff", type: "ff" });
    expect(predecessorsText("B")).toBe("1FF");
  });

  it("mantém os múltiplos predecessores na ordem da árvore", () => {
    expect(applyPredecessors("D", "1, 2").errors).toEqual([]);

    expect(links()).toHaveLength(2);
    expect(predecessorsText("D")).toBe("1, 2");
  });

  it("misturar tipos no mesmo campo funciona", () => {
    expect(applyPredecessors("D", "1SS, 2FF+1d").errors).toEqual([]);

    const types = links().map((link) => `${link.predecessorId}:${link.type}`);
    expect(types.sort()).toEqual(["A:ss", "B:ff"]);
    expect(predecessorsText("D")).toBe("1SS, 2FF+1d");
  });

  it("remover um predecessor do campo remove o vínculo", () => {
    applyPredecessors("D", "1, 2");
    expect(applyPredecessors("D", "1").errors).toEqual([]);

    expect(links()).toHaveLength(1);
    expect(links()[0]!.predecessorId).toBe("A");
  });

  it("tipo inválido é recusado sem alterar nada", () => {
    applyPredecessors("B", "1");
    const result = applyPredecessors("B", "1XX");

    expect(result.errors[0]).toContain("Tipo de vínculo inválido");
    expect(links()).toHaveLength(1);
    expect(links()[0]!.type).toBe("fs");
  });

  it("predecessor inexistente é recusado", () => {
    expect(applyPredecessors("B", "9").errors[0]).toContain("Predecessor não encontrado");
    expect(links()).toHaveLength(0);
  });

  it("código WBS personalizado que termina em letras não é lido como tipo", () => {
    useDomainStore.getState().updateTask("C", { wbsCode: "ENG-SS" });

    expect(applyPredecessors("D", "ENG-SS").errors).toEqual([]);
    expect(links()[0]).toMatchObject({ predecessorId: "C", type: "fs" });
  });
});
