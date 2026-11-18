import "./helpers/dom";

import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyAppearance,
  ROW_HEIGHTS,
  resolveTheme,
  type DensityName,
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
    const resolved = applyAppearance(root, { theme: "light", density: "compact" });

    expect(resolved).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.style.getPropertyValue("--row-height")).toBe("24px");
  });

  it("muda a variável de altura de linha ao trocar a densidade", () => {
    const root = makeRoot();

    applyAppearance(root, { theme: "dark", density: "compact" });
    expect(root.style.getPropertyValue("--row-height")).toBe("24px");

    applyAppearance(root, { theme: "dark", density: "comfortable" });
    expect(root.style.getPropertyValue("--row-height")).toBe("28px");

    applyAppearance(root, { theme: "dark", density: "wide" });
    expect(root.style.getPropertyValue("--row-height")).toBe("34px");
    expect(root.getAttribute("data-density")).toBe("wide");
  });

  it("muda o tema de claro para escuro sem recarregar", () => {
    const root = makeRoot();

    applyAppearance(root, { theme: "light", density: "comfortable" });
    expect(root.getAttribute("data-theme")).toBe("light");

    applyAppearance(root, { theme: "dark", density: "comfortable" });
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("resolve o tema auto conforme a preferência do sistema", () => {
    const root = makeRoot();

    setPrefersDark(true);
    expect(applyAppearance(root, { theme: "auto", density: "comfortable" })).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");

    setPrefersDark(false);
    expect(applyAppearance(root, { theme: "auto", density: "comfortable" })).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
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
