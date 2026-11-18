import "./helpers/dom";

import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyAppearance,
  PALETTES,
  ROW_HEIGHTS,
  resolveTheme,
  type DensityName,
  type PaletteName,
  type ThemeName,
} from "../src/ui/theme";

const tokensCss = readFileSync(path.resolve(import.meta.dir, "../src/styles/tokens.css"), "utf8");

function makeRoot(): HTMLElement {
  return document.createElement("div");
}

function setPrefersDark(value: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-color-scheme: dark") && value,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  setPrefersDark(false);
});

describe("applyAppearance", () => {
  it("aplica tema claro e densidade compacta nos atributos e na variável", () => {
    const root = makeRoot();
    const resolved = applyAppearance(root, { theme: "light", density: "compact", palette: "indigo" });

    expect(resolved).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.style.getPropertyValue("--row-height")).toBe("24px");
  });

  it("muda a variável de altura de linha ao trocar a densidade", () => {
    const root = makeRoot();

    applyAppearance(root, { theme: "dark", density: "compact", palette: "indigo" });
    expect(root.style.getPropertyValue("--row-height")).toBe("24px");

    applyAppearance(root, { theme: "dark", density: "comfortable", palette: "indigo" });
    expect(root.style.getPropertyValue("--row-height")).toBe("28px");

    applyAppearance(root, { theme: "dark", density: "wide", palette: "indigo" });
    expect(root.style.getPropertyValue("--row-height")).toBe("34px");
    expect(root.getAttribute("data-density")).toBe("wide");
  });

  it("muda o tema de claro para escuro sem recarregar", () => {
    const root = makeRoot();

    applyAppearance(root, { theme: "light", density: "comfortable", palette: "indigo" });
    expect(root.getAttribute("data-theme")).toBe("light");

    applyAppearance(root, { theme: "dark", density: "comfortable", palette: "indigo" });
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("aplica a paleta no atributo data-palette", () => {
    const root = makeRoot();

    applyAppearance(root, { theme: "light", density: "comfortable", palette: "emerald" });
    expect(root.getAttribute("data-palette")).toBe("emerald");

    applyAppearance(root, { theme: "light", density: "comfortable", palette: "violet" });
    expect(root.getAttribute("data-palette")).toBe("violet");
  });

  it("resolve o tema auto conforme a preferência do sistema", () => {
    const root = makeRoot();

    setPrefersDark(true);
    expect(applyAppearance(root, { theme: "auto", density: "comfortable", palette: "indigo" })).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");

    setPrefersDark(false);
    expect(applyAppearance(root, { theme: "auto", density: "comfortable", palette: "indigo" })).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
  });
});

/** Declarações de um bloco `[data-palette][data-theme]` do tokens.css. */
function paletteBlock(palette: string, theme: string): Record<string, string> {
  const pattern = new RegExp(
    `\\[data-palette="${palette}"\\]\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`,
  );
  const match = tokensCss.match(pattern);
  expect(match, `bloco ${palette}/${theme} ausente do tokens.css`).not.toBeNull();

  const declarations: Record<string, string> = {};
  for (const declaration of (match?.[1] ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const name = declaration.slice(0, separator).trim();
    if (!name.startsWith("--")) continue;
    declarations[name] = declaration.slice(separator + 1).trim();
  }
  return declarations;
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("paletas de cor", () => {
  const themes: ThemeName[] = ["light", "dark"];

  it("todas as paletas declaram o mesmo conjunto de tokens nos dois temas", () => {
    const reference = new Set(Object.keys(paletteBlock("indigo", "light")));

    for (const palette of PALETTES) {
      for (const theme of themes) {
        const names = Object.keys(paletteBlock(palette, theme));
        expect(names.sort(), `tokens de ${palette}/${theme}`).toEqual([...reference].sort());
      }
    }
  });

  it("--accent-fg sobre --accent mantém ao menos 4,5:1 em todas as paletas", () => {
    for (const palette of PALETTES) {
      for (const theme of themes) {
        const block = paletteBlock(palette, theme);
        const ratio = contrastRatio(block["--accent-fg"]!, block["--accent"]!);
        expect(
          Math.round(ratio * 100) / 100,
          `${palette}/${theme}: ${block["--accent-fg"]} sobre ${block["--accent"]}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("os tokens de identidade do tema base continuam válidos no contraste", () => {
    const light = tokensCss.match(/\[data-theme="light"\][^}]*--accent: (#[0-9a-f]{6})/i);
    const lightFg = tokensCss.match(/\[data-theme="light"\][^}]*--accent-fg: (#[0-9a-f]{6})/i);
    expect(light).not.toBeNull();
    expect(lightFg).not.toBeNull();
    expect(contrastRatio(lightFg![1]!, light![1]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("resolveTheme", () => {
  it("mantém o tema explícito independentemente do sistema", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("tokens.css", () => {
  const densities: DensityName[] = ["compact", "comfortable", "wide"];

  it("define as mesmas alturas de linha espelhadas em ROW_HEIGHTS", () => {
    for (const density of densities) {
      const rule = new RegExp(`\\[data-density="${density}"\\][^}]*--row-height:\\s*(\\d+)px`);
      const match = tokensCss.match(rule);
      expect(match, `regra de densidade ${density} ausente`).not.toBeNull();
      expect(Number(match?.[1])).toBe(ROW_HEIGHTS[density]);
    }
  });

  it("declara os dois temas com esquema de cor correspondente", () => {
    expect(tokensCss).toContain('[data-theme="light"]');
    expect(tokensCss).toContain('[data-theme="dark"]');
    expect(tokensCss).toContain("color-scheme: light");
    expect(tokensCss).toContain("color-scheme: dark");
  });

  it("desativa movimento quando o sistema pede reduced-motion", () => {
    expect(tokensCss).toContain("prefers-reduced-motion: reduce");
    expect(tokensCss).toContain("--duration-base: 0ms");
  });
});
