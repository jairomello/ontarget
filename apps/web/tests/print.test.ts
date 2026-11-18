import { describe, expect, it } from "bun:test";
import {
  PRINT_LEGEND_MM,
  PRINT_ROW_MM,
  PRINT_TABLE_HEADER_MM,
  pageMetrics,
  paginateWithLegend,
  type PrintBlock,
  type PrintSection,
} from "../src/features/print/pagination";

/**
 * Paginação da impressão (specs/printing): dimensões das páginas, corte de
 * linhas por página, cabeçalho repetido por página da listagem e legenda
 * reservada na última página.
 */

const M = pageMetrics({ w: 210, h: 297 }, "landscape", 15); // A4 paisagem, 15 mm

function blockHeight(block: PrintBlock, gantt?: { headerMm: number; rowMm: number }): number {
  switch (block.kind) {
    case "timeline":
      return 18;
    case "details":
      return 100;
    case "table":
      return PRINT_TABLE_HEADER_MM + (block.to - block.from) * PRINT_ROW_MM;
    case "gantt":
      return gantt!.headerMm + (block.to - block.from) * gantt!.rowMm;
    case "legend":
      return PRINT_LEGEND_MM;
  }
}

function contentHeight(page: { blocks: PrintBlock[] }, gantt?: { headerMm: number; rowMm: number }) {
  return page.blocks
    .filter((block) => block.kind !== "legend")
    .reduce((sum, block) => sum + blockHeight(block, gantt), 0);
}

describe("pageMetrics", () => {
  it("A4 paisagem troca as dimensões e reserva cabeçalho, rodapé e margens", () => {
    expect(M.pageW).toBe(297);
    expect(M.pageH).toBe(210);
    expect(M.bodyW).toBe(297 - 30);
    expect(M.bodyH).toBe(210 - 30 - M.header - M.footer);
  });

  it("retrato mantém o formato", () => {
    const portrait = pageMetrics({ w: 210, h: 297 }, "portrait", 10);
    expect(portrait.pageW).toBe(210);
    expect(portrait.pageH).toBe(297);
    expect(portrait.bodyW).toBe(190);
  });
});

describe("paginateWithLegend", () => {
  it("uma listagem pequena ocupa uma página com o cabeçalho só uma vez", () => {
    const sections: PrintSection[] = [{ kind: "table", rows: 5 }];
    const pages = paginateWithLegend(sections, M);

    const tables = pages.flatMap((page) => page.blocks.filter((b) => b.kind === "table"));
    expect(tables).toHaveLength(1); // cabeçalho de colunas impresso uma vez
    expect(pages[pages.length - 1]!.blocks.some((b) => b.kind === "legend")).toBe(true);
    expect(contentHeight(pages[0]!)).toBeLessThanOrEqual(M.bodyH - PRINT_LEGEND_MM);
  });

  it("listagem multi-página repete o cabeçalho em cada página da tabela", () => {
    const sections: PrintSection[] = [{ kind: "table", rows: 60 }];
    const pages = paginateWithLegend(sections, M);

    const tablePages = pages.filter((page) =>
      page.blocks.some((block) => block.kind === "table"),
    );
    expect(tablePages.length).toBeGreaterThan(1);
    for (const page of tablePages) {
      expect(page.blocks.filter((block) => block.kind === "table")).toHaveLength(1);
      expect(contentHeight(page)).toBeLessThanOrEqual(M.bodyH);
    }
    expect(pages[pages.length - 1]!.blocks.some((b) => b.kind === "legend")).toBe(true);
  });

  it("a legenda aparece exatamente uma vez, na última página", () => {
    const sections: PrintSection[] = [
      { kind: "timeline", height: 18 },
      { kind: "table", rows: 40 },
      { kind: "details", height: 100 },
    ];
    const pages = paginateWithLegend(sections, M);

    const legends = pages.flatMap((page) => page.blocks.filter((b) => b.kind === "legend"));
    expect(legends).toHaveLength(1);
    expect(pages[pages.length - 1]!.blocks.at(-1)?.kind).toBe("legend");
    // a última página reserva espaço para a legenda
    expect(contentHeight(pages[pages.length - 1]!)).toBeLessThanOrEqual(
      M.bodyH - PRINT_LEGEND_MM,
    );
  });

  it("timeline e tabela dividem a primeira página", () => {
    const sections: PrintSection[] = [
      { kind: "timeline", height: 18 },
      { kind: "table", rows: 10 },
    ];
    const pages = paginateWithLegend(sections, M);

    expect(pages[0]!.blocks[0]!.kind).toBe("timeline");
    expect(pages[0]!.blocks[1]!.kind).toBe("table");
    expect(pages).toHaveLength(1);
  });

  it("seções de Gantt respeitam cabeçalho, altura de linha e fatias", () => {
    const gantt = { headerMm: 12, rowMm: PRINT_ROW_MM, slices: 1, freshPage: true };
    const sections: PrintSection[] = [{ kind: "gantt", rows: 20, ...gantt }];
    const pages = paginateWithLegend(sections, M);

    const ganttBlocks = pages.flatMap((page) =>
      page.blocks.filter((block) => block.kind === "gantt"),
    );
    expect(ganttBlocks).toHaveLength(1);
    for (const page of pages) {
      expect(contentHeight(page, { headerMm: 12, rowMm: PRINT_ROW_MM })).toBeLessThanOrEqual(
        M.bodyH,
      );
    }
  });

  it("escala fixa gera uma página por fatia horizontal", () => {
    const sections: PrintSection[] = [
      { kind: "gantt", rows: 5, rowMm: PRINT_ROW_MM, headerMm: 12, slices: 3, freshPage: true },
    ];
    const pages = paginateWithLegend(sections, M);

    const ganttBlocks = pages.flatMap((page) =>
      page.blocks.filter((block) => block.kind === "gantt"),
    );
    expect(ganttBlocks.map((block) => (block.kind === "gantt" ? block.slice : -1))).toEqual([
      0, 1, 2,
    ]);
  });

  it("sem conteúdo, devolve uma página só com a legenda", () => {
    const pages = paginateWithLegend([], M);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.blocks).toEqual([{ kind: "legend" }]);
  });
});
