/**
 * Códigos de estrutura (specs/custom-fields — "Códigos de estrutura (WBS)"):
 * formatação do número WBS por máscara personalizada (ex.: `A.00.00.00`) e
 * validação de duplicidade de códigos digitados.
 *
 * Segmentos da máscara (separados por `.`):
 *  - `000…` → número com zero à esquerda (largura = quantidade de zeros);
 *  - `AAA…` → letra (1 = A, 26 = Z, 27 = AA …);
 *  - qualquer outro → texto literal.
 *
 * Funções puras — sem I/O, sem DOM.
 */

export interface CodeValidation {
  ok: boolean;
  reason?: string;
}

function toAlpha(value: number): string {
  let number = Math.max(1, Math.trunc(value));
  let text = "";
  while (number > 0) {
    number -= 1;
    text = String.fromCharCode(65 + (number % 26)) + text;
    number = Math.floor(number / 26);
  }
  return text || "A";
}

function applySegment(template: string, value: number): string {
  if (/^0+$/.test(template)) return String(Math.trunc(value)).padStart(template.length, "0");
  if (/^A+$/i.test(template)) {
    const alpha = toAlpha(value);
    return alpha.length >= template.length ? alpha : alpha.padStart(template.length, "0");
  }
  return template;
}

/** Código WBS pela máscara para um caminho `[1, 2, 3]` (níveis). */
export function formatWbsCode(mask: string, path: readonly number[]): string {
  const segments = mask.split(".");
  if (segments.length === 0 || path.length === 0) return path.join(".");

  const parts: string[] = [];
  for (let level = 0; level < path.length; level += 1) {
    const template = segments[level] ?? segments[segments.length - 1] ?? "";
    parts.push(applySegment(template, path[level] ?? 1));
  }
  return parts.join(".");
}

/** Converte um número WBS (`1.2.3`) em caminho de níveis. */
export function wbsPath(outlineNumber: string): number[] {
  return outlineNumber
    .split(".")
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/**
 * Valida um código WBS digitado: obrigatório e único (contra outros códigos
 * personalizados e contra os números WBS gerados).
 */
export function validateCustomCode(
  code: string,
  tasks: ReadonlyArray<{ id: string; wbsCode?: string | null; outlineNumber?: string }>,
  excludeId: string,
): CodeValidation {
  const trimmed = code.trim();
  if (trimmed === "") return { ok: false, reason: "Informe o código." };

  const duplicate = tasks.find(
    (task) =>
      task.id !== excludeId &&
      ((task.wbsCode ?? "") === trimmed || (task.outlineNumber ?? "") === trimmed),
  );
  if (duplicate) {
    return { ok: false, reason: `Código já usado por outra tarefa: ${trimmed}` };
  }
  return { ok: true };
}
