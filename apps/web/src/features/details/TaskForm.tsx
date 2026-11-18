import { formatDateInput, parseDate, parseDuration, parsePercent } from "@ontarget/core";
import { useEffect, useRef, useState } from "react";
import { formatDuration, formatPercent } from "../../lib/format";
import { applyPredecessors, predecessorsText } from "../shared/predecessors";
import { assignResource, setAssignmentPercent } from "../shared/assignments";
import { useComputedStore } from "../../store/computedStore";
import { useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import type { Task } from "../../store/types";
import styles from "./TaskForm.module.css";

const CONSTRAINTS = [
  { value: "", label: "Sem restrição" },
  { value: "asap", label: "O mais rápido possível (ASAP)" },
  { value: "alap", label: "O mais tarde possível (ALAP)" },
  { value: "snet", label: "Começar Não Antes De" },
  { value: "snlt", label: "Começar Não Depois De" },
  { value: "fnet", label: "Terminar Não Antes De" },
  { value: "fnlt", label: "Terminar Não Depois De" },
  { value: "must_start_on", label: "Deve Começar Em" },
  { value: "must_finish_on", label: "Deve Terminar Em" },
];

const TASK_TYPES = [
  { value: "fixed_duration", label: "Duração fixa" },
  { value: "fixed_work", label: "Trabalho fixo" },
  { value: "fixed_units", label: "Unidades fixas" },
];

/**
 * Formulário de detalhes da tarefa (specs/task-sheet — "Formulário sob
 * demanda"). Abre apenas quando o usuário pede (`F4`, botão `Detalhes`);
 * toda edição reflete imediatamente na grade, sem OK/Cancelar.
 */
export function TaskForm() {
  const open = useUiStore((state) => state.panels.details);
  const setPanel = useUiStore((state) => state.setPanel);
  const activeRow = useUiStore((state) => state.selection.activeRow);
  const tasks = useDomainStore((state) => state.tasks);
  const calendars = useDomainStore((state) => state.calendars);
  const resources = useDomainStore((state) => state.resources);
  const assignments = useDomainStore((state) => state.assignments);
  const schedule = useComputedStore((state) => state.schedule);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [predError, setPredError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const task: Task | undefined = activeRow ? tasks[activeRow] : undefined;

  /** Task Inspector (specs/task-dependencies — "Cadeia condutora"). */
  const reason = schedule && task ? schedule.reasons[task.id] : undefined;
  const chainIds = schedule && task ? (schedule.chains[task.id] ?? []) : [];
  const conflicts = schedule ? schedule.conflicts : [];
  const predText = task ? predecessorsText(task.id) : "";
  const taskAssignments = task
    ? Object.values(assignments).filter((assignment) => assignment.taskId === task.id)
    : [];
  const assignedIds = new Set(taskAssignments.map((assignment) => assignment.resourceId));
  const people = Object.values(resources)
    .filter((resource) => resource.active && !assignedIds.has(resource.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    return () => {
      const target = previousFocus.current;
      if (target && typeof target.focus === "function" && document.contains(target)) {
        target.focus();
      } else {
        document.querySelector<HTMLElement>('[data-testid="task-sheet-scroll"]')?.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const update = (patch: Partial<Task>) => {
    if (!task) return;
    useDomainStore.getState().updateTask(task.id, patch);
  };

  const close = () => setPanel("details", false);

  return (
    <aside
      className={styles.form}
      data-testid="task-form"
      aria-label="Detalhes da tarefa"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Detalhes da tarefa</span>
          <strong className={styles.title} data-testid="task-form-title">
            {task ? task.name : "Nenhuma tarefa selecionada"}
          </strong>
        </div>
        <button
          type="button"
          className={styles.close}
          data-testid="task-form-close"
          onClick={close}
        >
          Esc
        </button>
      </header>

      {task && (
        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Geral</h3>

            <label className={styles.field}>
              <span>Nome</span>
              <input
                data-testid="form-name"
                value={task.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>

            <label className={styles.field}>
              <span>WBS</span>
              <input
                data-testid="form-wbs"
                value={task.wbsCode ?? task.outlineNumber}
                onChange={(event) => update({ wbsCode: event.target.value })}
              />
            </label>

            <label className={styles.field}>
              <span>Prioridade</span>
              <input
                data-testid="form-priority"
                type="number"
                min={1}
                max={1000}
                value={task.priority}
                onChange={(event) => update({ priority: Number(event.target.value) || 500 })}
              />
            </label>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Datas</h3>

            <label className={styles.field}>
              <span>Início</span>
              <input
                data-testid="form-start"
                value={task.start ? formatDateInput(task.start) : ""}
                placeholder="dd/MM/aaaa"
                onChange={(event) => {
                  const parsed = parseDate(event.target.value);
                  if (parsed !== null) update({ start: parsed, manualStart: parsed });
                }}
              />
            </label>

            <label className={styles.field}>
              <span>Término</span>
              <input
                data-testid="form-finish"
                value={task.finish ? formatDateInput(task.finish) : ""}
                placeholder="dd/MM/aaaa"
                onChange={(event) => {
                  const parsed = parseDate(event.target.value);
                  if (parsed !== null) update({ finish: parsed, manualFinish: parsed });
                }}
              />
            </label>

            <label className={styles.field}>
              <span>Duração</span>
              <input
                data-testid="form-duration"
                defaultValue={formatDuration(task.duration)}
                key={`duration-${task.duration ?? "none"}`}
                onBlur={(event) => {
                  const parsed = parseDuration(event.target.value);
                  if (parsed) update({ duration: parsed.ms, durationUnit: parsed.unit });
                  else event.target.value = formatDuration(task.duration);
                }}
              />
            </label>

            <label className={styles.field}>
              <span>Prazo (deadline)</span>
              <input
                data-testid="form-deadline"
                value={task.deadline ? formatDateInput(task.deadline) : ""}
                placeholder="dd/MM/aaaa"
                onChange={(event) => update({ deadline: parseDate(event.target.value) })}
              />
            </label>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Agendamento</h3>

            <label className={styles.field}>
              <span>Modo</span>
              <select
                data-testid="form-mode"
                value={task.schedulingMode}
                onChange={(event) =>
                  update({ schedulingMode: event.target.value as Task["schedulingMode"] })
                }
              >
                <option value="auto">Automático</option>
                <option value="manual">Manual</option>
              </select>
            </label>

            <label className={styles.field}>
              <span>Calendário</span>
              <select
                data-testid="form-calendar"
                value={task.calendarId ?? ""}
                onChange={(event) => update({ calendarId: event.target.value || null })}
              >
                <option value="">Padrão do projeto</option>
                {Object.values(calendars).map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>Tipo</span>
              <select
                data-testid="form-type"
                value={task.taskType}
                onChange={(event) => update({ taskType: event.target.value as Task["taskType"] })}
              >
                {TASK_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>Restrição</span>
              <select
                data-testid="form-constraint"
                value={task.constraintType ?? ""}
                onChange={(event) => update({ constraintType: event.target.value || null })}
              >
                {CONSTRAINTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>Predecessores</span>
              <input
                data-testid="form-predecessors"
                key={`pred-${task.id}-${predText}`}
                defaultValue={predText}
                placeholder="ex.: 1, 2.3SS, 4.4FF+2d"
                onBlur={(event) => {
                  const result = applyPredecessors(task.id, event.target.value);
                  setPredError(
                    result.errors.length > 0 ? result.errors.join("  ·  ") : null,
                  );
                  event.target.value = predecessorsText(task.id);
                }}
              />
              {predError && (
                <span className={styles.fieldError} data-testid="form-predecessors-error">
                  {predError}
                </span>
              )}
            </label>

            <label className={styles.field}>
              <span>% Concluído</span>
              <input
                data-testid="form-percent"
                defaultValue={formatPercent(task.percentComplete)}
                key={`percent-${task.percentComplete}`}
                onBlur={(event) => {
                  const parsed = parsePercent(event.target.value);
                  if (parsed !== null) update({ percentComplete: parsed });
                  else event.target.value = formatPercent(task.percentComplete);
                }}
              />
            </label>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Recursos</h3>

            {taskAssignments.length === 0 ? (
              <p className={styles.inspectorEmpty} data-testid="assignments-empty">
                Nenhuma pessoa atribuída.
              </p>
            ) : (
              taskAssignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className={styles.assignmentRow}
                  data-testid="assignment-row"
                >
                  <span className={styles.assignmentName}>
                    {resources[assignment.resourceId]?.name ?? assignment.resourceId}
                  </span>
                  <label className={styles.assignmentUnits}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="10"
                      data-testid="assignment-units"
                      defaultValue={Math.round(assignment.units * 100)}
                      key={`${assignment.id}-${assignment.units}`}
                      onBlur={(event) => {
                        const percent = Number(event.target.value);
                        if (Number.isFinite(percent) && percent >= 0) {
                          setAssignmentPercent(assignment.id, percent);
                        }
                      }}
                    />
                    <span>%</span>
                  </label>
                  <span className={styles.assignmentMeta}>
                    {formatDuration(assignment.work)} · R${" "}
                    {(assignment.cost ?? 0).toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <button
                    type="button"
                    className={styles.assignmentRemove}
                    data-testid="assignment-remove"
                    onClick={() =>
                      useDomainStore.getState().removeAssignment(assignment.id)
                    }
                  >
                    Remover
                  </button>
                </div>
              ))
            )}

            <label className={styles.field}>
              <span>Atribuir pessoa</span>
              <select
                data-testid="form-assign"
                value=""
                onChange={(event) => {
                  const resourceId = event.target.value;
                  if (!resourceId || !task) return;
                  const result = assignResource(task.id, resourceId);
                  setAssignError(result.errors.length > 0 ? result.errors.join("  ·  ") : null);
                  event.target.value = "";
                }}
              >
                <option value="">Selecione uma pessoa…</option>
                {people.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.name}
                  </option>
                ))}
              </select>
            </label>
            {assignError && (
              <span className={styles.fieldError} data-testid="form-assign-error">
                {assignError}
              </span>
            )}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Inspetor de tarefas</h3>

            {reason ? (
              <p className={styles.inspectorReason} data-testid="inspector-reason">
                {reason.text}
              </p>
            ) : (
              <p className={styles.inspectorEmpty} data-testid="inspector-reason-empty">
                Sem cálculo de agendamento para esta tarefa.
              </p>
            )}

            <div>
              <span className={styles.inspectorLabel}>Cadeia condutora</span>
              {chainIds.length === 0 ? (
                <p className={styles.inspectorEmpty} data-testid="inspector-chain-empty">
                  Nenhum predecessor determinante.
                </p>
              ) : (
                <ol className={styles.chainList} data-testid="inspector-chain">
                  {[...chainIds].reverse().map((chainId) => (
                    <li key={chainId}>
                      <button
                        type="button"
                        className={styles.chainButton}
                        data-testid="inspector-chain-item"
                        data-task-id={chainId}
                        onClick={() =>
                          useUiStore.getState().setSelection({
                            rows: [chainId],
                            activeRow: chainId,
                            activeColumn: "name",
                          })
                        }
                      >
                        {tasks[chainId]?.name ?? chainId}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div>
              <span className={styles.inspectorLabel}>Conflitos</span>
              {conflicts.length === 0 ? (
                <p className={styles.inspectorEmpty} data-testid="inspector-conflicts">
                  Nenhum conflito registrado.
                </p>
              ) : (
                <ul className={styles.conflictList} data-testid="inspector-conflicts">
                  {conflicts.map((conflict, index) => (
                    <li
                      key={`${conflict.taskId}-${conflict.code}-${index}`}
                      className={styles.conflictItem}
                      data-testid="inspector-conflict"
                    >
                      <strong>{tasks[conflict.taskId]?.name ?? conflict.taskId}</strong>
                      <span>{conflict.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Notas</h3>
            <textarea
              className={styles.notes}
              data-testid="form-notes"
              rows={4}
              value={task.notes ?? ""}
              placeholder="Observações sobre esta tarefa…"
              onChange={(event) => update({ notes: event.target.value })}
            />
          </section>
        </div>
      )}
    </aside>
  );
}
