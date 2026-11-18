import { useEffect, useState } from "react";
import { applyAppearance, type Appearance, type ThemeName, type DensityName } from "./theme";

const STORAGE_KEY = "e-project.appearance";

function readStored(): Appearance {
  if (typeof localStorage === "undefined") return { theme: "auto", density: "comfortable" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { theme: "auto", density: "comfortable" };
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme: parsed.theme ?? "auto",
      density: parsed.density ?? "comfortable",
    };
  } catch {
    return { theme: "auto", density: "comfortable" };
  }
}

/**
 * Mantém tema e densidade aplicados ao documento e persistidos.
 * Espelha o estado que depois vira parte do `uiStore` (PRD RF-P04).
 */
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(readStored);

  useEffect(() => {
    applyAppearance(document.documentElement, appearance);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // armazenamento indisponível: a aplicação segue funcionando na sessão
    }
  }, [appearance]);

  const setTheme = (theme: ThemeName) => setAppearance((a) => ({ ...a, theme }));
  const setDensity = (density: DensityName) => setAppearance((a) => ({ ...a, density }));

  return { appearance, setTheme, setDensity };
}
