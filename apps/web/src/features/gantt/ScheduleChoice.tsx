import { useEffect, useRef } from "react";
import styles from "./ScheduleChoice.module.css";

export interface ScheduleChoiceProps {
  x: number;
  y: number;
  /** Aplicar como tarefa manual (datas fixas). */
  onManual: () => void;
  /** Manter automático e registrar a restrição de data. */
  onAuto: () => void;
  onCancel: () => void;
}

/**
 * Escolha oferecida ao mover/redimensionar uma tarefa com agendamento
 * automático (specs/gantt-view — "Arrastar tarefa automática"): nada muda
 * até o usuário decidir.
 */
export function ScheduleChoice({ x, y, onManual, onAuto, onCancel }: ScheduleChoiceProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    ref.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return (
    <div
      ref={ref}
      className={styles.choice}
      data-testid="schedule-choice"
      role="dialog"
      aria-label="Como aplicar o novo agendamento"
      tabIndex={-1}
      style={{ left: Math.min(x, window.innerWidth - 300), top: Math.min(y, window.innerHeight - 160) }}
    >
      <p className={styles.title}>Tarefa com agendamento automático</p>
      <p className={styles.hint}>Escolha como aplicar as novas datas:</p>

      <div className={styles.options}>
        <button
          type="button"
          className={styles.option}
          data-testid="choice-manual"
          onClick={onManual}
        >
          <strong>Converter para tarefa manual</strong>
          <span>As datas passam a ser fixas, definidas por você.</span>
        </button>

        <button
          type="button"
          className={styles.option}
          data-testid="choice-auto"
          onClick={onAuto}
        >
          <strong>Manter automático</strong>
          <span>Registra restrição de início e deixa o cronograma recalcular.</span>
        </button>
      </div>

      <button type="button" className={styles.cancel} data-testid="choice-cancel" onClick={onCancel}>
        Cancelar (Esc)
      </button>
    </div>
  );
}
