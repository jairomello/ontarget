import { Link } from "react-router";
import styles from "./PortfolioPage.module.css";

/**
 * Portfólio de projetos (PRD RF-P01, specs/portfolio).
 * Nesta fase exibe o cabeçalho e o estado vazio; a listagem completa
 * é implementada na tarefa 2.2.
 */
export function PortfolioPage() {
  return (
    <div className={styles.page} data-testid="portfolio">
      <header className={styles.header}>
        <h1 className={styles.title}>Projetos</h1>
        <button type="button" className={styles.primaryButton} data-testid="new-project">
          Novo projeto
        </button>
      </header>

      <section className={styles.empty} data-testid="portfolio-empty">
        <p className={styles.emptyTitle}>Nenhum projeto ainda</p>
        <p className={styles.emptyHint}>
          Crie um projeto vazio, use um template ou importe um arquivo JSON/CSV para começar.
        </p>
        <Link className={styles.ghostLink} to="/" aria-disabled="true">
          Importar arquivo
        </Link>
      </section>
    </div>
  );
}
