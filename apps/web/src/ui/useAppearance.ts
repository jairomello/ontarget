import { useEffect } from "react";
import { applyAppearance, type Appearance, type DensityName, type ThemeName } from "./theme";
import { useUiStore } from "../store/uiStore";

const STORAGE_KEY = "ontarget.appearance";
/** Chave anterior ao rename; lida como fallback para não perder a preferência. */
const LEGACY_STORAGE_KEY = "e-project.appearance";

function readStored(): Appearance {
  if (typeof localStorage === "undefined") return { theme: "auto", density: "comfortable" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
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
 * Mantém tema e densidade (guardados no `uiStore`) aplicados ao documento
 * e persistidos localmente. Preferência de UI: só no navegador, nunca no
 * servidor (PRD RF-P04).
 */
export function useAppearance() {
  const theme = useUiStore((state) => state.theme);
  const density = useUiStore((state) => state.density);
  const setTheme = useUiStore((state) => state.setTheme);
  const setDensity = useUiStore((state) => state.setDensity);

  // Restaura a preferência salva uma única vez.
  useEffect(() => {
    const stored = readStored();
    const current = useUiStore.getState();
    if (stored.theme !== current.theme) current.setTheme(stored.theme);
    if (stored.density !== current.density) current.setDensity(stored.density);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyAppearance(document.documentElement, { theme, density });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, density }));
    } catch {
      // armazenamento indisponível: a sessão continua funcionando
    }
  }, [theme, density]);

  const appearance: Appearance = { theme, density };

  return {
    appearance,
    setTheme: (next: ThemeName) => setTheme(next),
    setDensity: (next: DensityName) => setDensity(next),
  };
}
