import { useParams } from "react-router";
import styles from "./WorkspacePage.module.css";

/**
 * Área de trabalho do projeto: Task Sheet + Gantt + formulário de detalhes.
 * Estrutura criada aqui; os painéis são implementados nas tarefas 4.x e 5.x.
 */
export function WorkspacePage() {
  const { projectId } = useParams();

  return (
    <div className={styles.workspace} data-testid="workspace" data-project-id={projectId}>
      <section className={styles.sheet} data-testid="task-sheet-slot" aria-label="Task Sheet">
        <p className={styles.placeholder}>Task Sheet</p>
      </section>
      <section className={styles.gantt} data-testid="gantt-slot" aria-label="Gantt Chart">
        <p className={styles.placeholder}>Gantt Chart</p>
      </section>
    </div>
  );
}
