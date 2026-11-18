import { useEffect } from "react";
import {
  applyAppearance,
  PALETTES,
  type Appearance,
  type DensityName,
  type PaletteName,
  type ThemeName,
} from "./theme";
import { useUiStore } from "../store/uiStore";

const STORAGE_KEY = "ontarget.appearance";
/** Chave anterior ao rename; lida como fallback para não perder a preferência. */
const LEGACY_STORAGE_KEY = "e-project.appearance";

function isPalette(value: unknown): value is PaletteName {
  return typeof value === "string" && (PALETTES as readonly string[]).includes(value);
}

function readStored(): Appearance {
  if (typeof localStorage === "undefined") return { theme: "auto", density: "comfortable", palette: "indigo" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { theme: "auto", density: "comfortable", palette: "indigo" };
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme: parsed.theme ?? "auto",
      density: parsed.density ?? "comfortable",
      palette: isPalette(parsed.palette) ? parsed.palette : "indigo",
    };
  } catch {
    return { theme: "auto", density: "comfortable", palette: "indigo" };
  }
}

/**
 * Mantém tema, densidade e paleta (guardados no `uiStore`) aplicados ao
 * documento e persistidos localmente. O cache local dá o boot instantâneo;
 * a preferência da conta vem do servidor pelo `AuthProvider`
 * (specs/user-profile — "Aparência guardada na conta").
 */
export function useAppearance() {
  const theme = useUiStore((state) => state.theme);
  const density = useUiStore((state) => state.density);
  const palette = useUiStore((state) => state.palette);
  const setTheme = useUiStore((state) => state.setTheme);
  const setDensity = useUiStore((state) => state.setDensity);
  const setPalette = useUiStore((state) => state.setPalette);

  // Restaura a preferência salva uma única vez.
  useEffect(() => {
    const stored = readStored();
    const current = useUiStore.getState();
    if (stored.theme !== current.theme) current.setTheme(stored.theme);
    if (stored.density !== current.density) current.setDensity(stored.density);
    if (stored.palette !== current.palette) current.setPalette(stored.palette);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyAppearance(document.documentElement, { theme, density, palette });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, density, palette }));
    } catch {
      // armazenamento indisponível: a sessão continua funcionando
    }
  }, [theme, density, palette]);

  const appearance: Appearance = { theme, density, palette };

  return {
    appearance,
    setTheme: (next: ThemeName) => setTheme(next),
    setDensity: (next: DensityName) => setDensity(next),
    setPalette: (next: PaletteName) => setPalette(next),
  };
}
