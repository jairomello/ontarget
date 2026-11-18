/**
 * Aparência da aplicação: tema (claro/escuro/auto) e densidade de linhas.
 * Aplica os atributos no elemento raiz e a variável de altura de linha,
 * de modo que todo o CSS responda sem recarregar a página.
 *
 * Fonte: docs/Design.md §2 e PRD RF-P04.
 */

export type ThemeName = "light" | "dark" | "auto";
export type DensityName = "compact" | "comfortable" | "wide";
export type ResolvedTheme = "light" | "dark";

export const DENSITIES: readonly DensityName[] = ["compact", "comfortable", "wide"];
export const THEMES: readonly ThemeName[] = ["light", "dark", "auto"];

/** Alturas de linha por densidade (px), espelhadas em tokens.css. */
export const ROW_HEIGHTS: Record<DensityName, number> = {
  compact: 24,
  comfortable: 28,
  wide: 34,
};

export interface Appearance {
  theme: ThemeName;
  density: DensityName;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "auto",
  density: "comfortable",
};

/** Resolve o tema efetivo a partir da preferência do sistema. */
export function resolveTheme(theme: ThemeName, prefersDark: boolean): ResolvedTheme {
  if (theme === "auto") return prefersDark ? "dark" : "light";
  return theme;
}

/**
 * Aplica tema e densidade ao elemento raiz, definindo `data-theme`,
 * `data-density` e a variável `--row-height`.
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): ResolvedTheme {
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  const resolved = resolveTheme(appearance.theme, prefersDark);
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-density", appearance.density);
  root.style.setProperty("--row-height", `${ROW_HEIGHTS[appearance.density]}px`);
  return resolved;
}
