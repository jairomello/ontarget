import { useAuth } from "../auth/AuthContext";
import { useAccountAppearance } from "../auth/useAccountAppearance";
import { DENSITIES, PALETTE_SWATCH, PALETTES, THEMES } from "../../ui/theme";
import styles from "./account.module.css";

const THEME_LABELS: Record<string, string> = {
  light: "Claro",
  dark: "Escuro",
  auto: "Automático",
};

const DENSITY_LABELS: Record<string, string> = {
  compact: "Compacta",
  comfortable: "Confortável",
  wide: "Ampla",
};

/**
 * Tema, densidade e paleta (specs/user-profile — "Aparência guardada na
 * conta"): aplica na hora e grava na conta; se o servidor recusar, restaura.
 */
export function AppearanceSection() {
  const { user } = useAuth();
  const { appearance, persist } = useAccountAppearance();

  return (
    <section className={styles.section} aria-labelledby="conta-aparencia">
      <h2 id="conta-aparencia">Aparência</h2>
      <p className={styles.sectionHint}>
        Vale para a conta: a preferência é aplicada em qualquer navegador.
      </p>

      <div className={styles.optionGroup}>
        <span className={styles.optionLabel} id="tema-label">
          Tema
        </span>
        <div className={styles.segmented} role="group" aria-labelledby="tema-label">
          {THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              data-testid={`appearance-theme-${theme}`}
              className={appearance.theme === theme ? styles.segmentActive : styles.segment}
              aria-pressed={appearance.theme === theme}
              onClick={() => void persist({ theme })}
            >
              {THEME_LABELS[theme] ?? theme}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.optionGroup}>
        <span className={styles.optionLabel} id="densidade-label">
          Densidade
        </span>
        <div className={styles.segmented} role="group" aria-labelledby="densidade-label">
          {DENSITIES.map((density) => (
            <button
              key={density}
              type="button"
              data-testid={`appearance-density-${density}`}
              className={appearance.density === density ? styles.segmentActive : styles.segment}
              aria-pressed={appearance.density === density}
              onClick={() => void persist({ density })}
            >
              {DENSITY_LABELS[density] ?? density}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.optionGroup}>
        <span className={styles.optionLabel} id="paleta-label">
          Paleta de cor
        </span>
        <div className={styles.palettes} role="radiogroup" aria-labelledby="paleta-label">
          {PALETTES.map((palette) => (
            <button
              key={palette}
              type="button"
              role="radio"
              aria-checked={appearance.palette === palette}
              data-testid={`appearance-palette-${palette}`}
              className={appearance.palette === palette ? styles.paletteActive : styles.palette}
              onClick={() => void persist({ palette })}
            >
              <span className={styles.swatch} style={{ background: PALETTE_SWATCH[palette] }} />
              {palette}
            </button>
          ))}
        </div>
      </div>

      {user && (
        <p className={styles.sectionHint}>
          Salvo em <strong>{user.email}</strong>
        </p>
      )}
    </section>
  );
}
