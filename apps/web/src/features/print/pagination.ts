/**
 * Paginação da impressão (specs/printing): divide o conteúdo em páginas de
 * tamanho real (mm), respeitando cabeçalho, rodapé, margens e a legenda
 * reservada na última página. Puro — sem DOM — para ser testável.
 *
 * Convenção: a legenda ocupa `legendMm` no pé da última página, reservados
 * durante a simulação (o último número de página é resolvido por ponto
 * fixo: reservar encolhe a última página, o que pode criar outra).
 */

export const PRINT_HEADER_MM = 10;
export const PRINT_FOOTER_MM = 7;
export const PRINT_LEGEND_MM = 15;
export const PRINT_TABLE_HEADER_MM = 7;
export const PRINT_ROW_MM = 6;
/** Menor altura de linha aceitável ao comprimir o Gantt em uma página. */
export const PRINT_MIN_ROW_MM = 2.8;

export interface PaperSize {
  w: number;
  h: number;
}

export interface PageMetrics {
  pageW: number;
  pageH: number;
  margin: number;
  header: number;
  footer: number;
  legend: number;
  bodyW: number;
  bodyH: number;
}

/** Dimensões da página (retânmorfo aplicado) e do corpo de conteúdo. */
export function pageMetrics(
  paper: PaperSize,
  orientation: "portrait" | "landscape",
  margin: number,
): PageMetrics {
  const landscape = orientation === "landscape";
  const pageW = landscape ? paper.h : paper.w;
  const pageH = landscape ? paper.w : paper.h;
  return {
    pageW,
    pageH,
    margin,
    header: PRINT_HEADER_MM,
    footer: PRINT_FOOTER_MM,
    legend: PRINT_LEGEND_MM,
    bodyW: pageW - 2 * margin,
    bodyH: pageH - 2 * margin - PRINT_HEADER_MM - PRINT_FOOTER_MM,
  };
}

export type PrintSection =
  | { kind: "timeline"; height: number }
  | { kind: "details"; height: number }
  | { kind: "table"; rows: number }
  | {
      kind: "gantt";
      rows: number;
      rowMm: number;
      headerMm: number;
      /** Fatias horizontais (escala fixa maior que a página). */
      slices: number;
      /** Começa em página nova (ajustar à página / gráfico isolado). */
      freshPage?: boolean;
    };

export type PrintBlock =
  | { kind: "timeline" }
  | { kind: "details" }
  | { kind: "table"; from: number; to: number }
  | { kind: "gantt"; from: number; to: number; slice: number }
  | { kind: "legend" };

export interface PrintPage {
  blocks: PrintBlock[];
}

/** Simula o fluxo de blocos nas páginas (sem legenda ainda). */
export function paginate(
  sections: readonly PrintSection[],
  m: PageMetrics,
  legendOnPage: number | null,
): PrintPage[] {
  const pages: PrintPage[] = [];
  const bodyHFor = (pageNumber: number): number =>
    Math.max(0, m.bodyH - (legendOnPage === pageNumber ? m.legend : 0));

  let current: PrintPage = { blocks: [] };
  let remaining = bodyHFor(1);

  const pushPage = (): void => {
    pages.push(current);
    current = { blocks: [] };
    remaining = bodyHFor(pages.length + 1);
  };

  for (const section of sections) {
    if (section.kind === "timeline" || section.kind === "details") {
      // bloco fixo: cabe na página atual ou abre outra
      if (section.height > remaining && current.blocks.length > 0) pushPage();
      current.blocks.push({ kind: section.kind });
      remaining = Math.max(0, remaining - section.height);
      continue;
    }

    if (section.kind === "table") {
      let index = 0;
      while (index < section.rows) {
        let capacity = Math.floor((remaining - PRINT_TABLE_HEADER_MM) / PRINT_ROW_MM);
        if (capacity < 1) {
          pushPage();
          capacity = Math.floor((remaining - PRINT_TABLE_HEADER_MM) / PRINT_ROW_MM);
          if (capacity < 1) capacity = 1;
        }
        const take = Math.min(capacity, section.rows - index);
        current.blocks.push({ kind: "table", from: index, to: index + take });
        remaining -= PRINT_TABLE_HEADER_MM + take * PRINT_ROW_MM;
        index += take;
      }
      continue;
    }

    // gantt
    if (section.freshPage && current.blocks.length > 0) pushPage();
    let index = 0;
    let first = true;
    while (index < section.rows) {
      if (!first) pushPage();
      let capacity = Math.floor((remaining - section.headerMm) / section.rowMm);
      if (capacity < 1) {
        if (first) {
          pushPage();
          capacity = Math.floor((remaining - section.headerMm) / section.rowMm);
        }
        if (capacity < 1) capacity = 1;
      }
      const take = Math.min(capacity, section.rows - index);
      current.blocks.push({ kind: "gantt", from: index, to: index + take, slice: 0 });
      remaining -= section.headerMm + take * section.rowMm;
      first = false;
      for (let slice = 1; slice < section.slices; slice += 1) {
        pushPage();
        current.blocks.push({ kind: "gantt", from: index, to: index + take, slice });
        remaining -= section.headerMm + take * section.rowMm;
      }
      index += take;
    }
  }

  if (current.blocks.length > 0 || pages.length === 0) pages.push(current);
  return pages;
}

/**
 * Pagina com a legenda na última página. Resolve o número da última página
 * por ponto fixo (reservar pode empurrar conteúdo para uma página a mais).
 */
export function paginateWithLegend(
  sections: readonly PrintSection[],
  m: PageMetrics,
): PrintPage[] {
  if (sections.length === 0) {
    const only: PrintPage[] = [{ blocks: [{ kind: "legend" }] }];
    return only;
  }

  let last = paginate(sections, m, null).length;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pages = paginate(sections, m, last);
    if (pages.length === last) {
      pages[pages.length - 1]!.blocks.push({ kind: "legend" });
      return pages;
    }
    last = pages.length;
  }

  // fallback (não convergiu): legenda em página própria
  const pages = paginate(sections, m, null);
  pages.push({ blocks: [{ kind: "legend" }] });
  return pages;
}
