import { Outlet } from "react-router";
import { useAppearance } from "../ui/useAppearance";
import { DENSITIES, THEMES } from "../ui/theme";
import styles from "./Shell.module.css";

const COMMAND_TABS = ["Tarefa", "Recurso", "Projeto", "Ver", "Formatar"] as const;

/**
 * Invólucro da aplicação (docs/Design.md §3):
 * barra de aplicação, barra de comandos, conteúdo e barra de status.
 */
export function Shell() {
  const { appearance, setTheme, setDensity } = useAppearance();

  return (
    <div className={styles.shell} data-app-shell="root" data-testid="app-shell">
      <header className={styles.appBar} data-testid="app-bar">
        <div className={styles.brandGroup}>
          <a className={styles.brand} href="/" data-testid="brand">
            e-project
          </a>
          <span className={styles.brandHint}>planejamento de projetos</span>
        </div>

        <div className={styles.appActions}>
          <button
            type="button"
            className={styles.ghostButton}
            data-testid="undo"
            disabled
            title="Desfazer (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            data-testid="redo"
            disabled
            title="Refazer (Ctrl+Y)"
          >
            ↷
          </button>

          <label className={styles.selectLabel}>
            <span>Tema</span>
            <select
              data-testid="theme-select"
              value={appearance.theme}
              onChange={(e) => setTheme(e.target.value as (typeof THEMES)[number])}
            >
              {THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {theme === "auto" ? "Automático" : theme === "dark" ? "Escuro" : "Claro"}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.selectLabel}>
            <span>Densidade</span>
            <select
              data-testid="density-select"
              value={appearance.density}
              onChange={(e) => setDensity(e.target.value as (typeof DENSITIES)[number])}
            >
              <option value="compact">Compacta</option>
              <option value="comfortable">Confortável</option>
              <option value="wide">Ampla</option>
            </select>
          </label>
        </div>
      </header>

      <nav className={styles.commandBar} data-testid="command-bar" aria-label="Comandos">
        {COMMAND_TABS.map((tab, index) => (
          <button
            key={tab}
            type="button"
            className={index === 0 ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            aria-current={index === 0 ? "page" : undefined}
          >
            {tab}
          </button>
        ))}
      </nav>

      <main className={styles.content} data-testid="content">
        <Outlet />
      </main>

      <footer className={styles.statusBar} data-testid="status-bar">
        <span data-testid="status-focus">Foco: Task Sheet</span>
        <span className={styles.statusSpacer} />
        <span data-testid="status-save">Salvo</span>
      </footer>
    </div>
  );
}
