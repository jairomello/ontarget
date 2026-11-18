import { DAY_MS, durationBetween, type Calendar } from "@ontarget/core";
import { useMemo, useRef, useState } from "react";
import { formatDuration } from "../../lib/format";
import { useOverallocation } from "../shared/overallocation";
import { selectActiveCalendar, toCoreCalendar, useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import type { Assignment, Resource, Task } from "../../store/types";
import styles from "./TeamPanel.module.css";

/** Espelha a origem do Gantt (3 dias de margem) para manter a mesma escala. */
const MARGIN_DAYS = 3;

interface Bar {
  assignment: Assignment;
  task: Task;
  left: number;
  width: number;
}

interface Segment {
  start: number;
  end: number;
  demand: number;
  capacity: number;
  ratio: number;
}

/**
 * Painel de equipe (specs/resources — "Painel de equipe", "Ociosidade de
 * trabalho" e "Reatribuição no painel"): para cada pessoa, uma faixa no mesmo
 * zoom do Gantt com as tarefas atribuídas, os períodos superalocados com a
 * razão demanda/capacidade e a possibilidade de reatribuir por arrastar.
 */
export function TeamPanel() {
  const open = useUiStore((state) => state.panels.team);
  const setPanel = useUiStore((state) => state.setPanel);
  const pxPerDay = useUiStore((state) => state.zoom.pxPerDay);
  const tasks = useDomainStore((state) => state.tasks);
  const assignments = useDomainStore((state) => state.assignments);
  const resources = useDomainStore((state) => state.resources);
  const calendars = useDomainStore((state) => state.calendars);
  const exceptions = useDomainStore((state) => state.calendarExceptions);
  const active = useDomainStore(selectActiveCalendar);
  const overallocation = useOverallocation();

  const [drag, setDrag] = useState<{ assignmentId: string; dx: number } | null>(null);
  const dragRef = useRef<{ assignmentId: string; startX: number; resourceId: string } | null>(
    null,
  );

  // janela e origem iguais às do Gantt (mesma escala)
  const bounds = useMemo(() => {
    const dated = Object.values(tasks).filter(
      (task) => task.start !== null && task.finish !== null,
    );
    if (dated.length === 0) return null;
    const min = Math.min(...dated.map((task) => task.start as number));
    const max = Math.max(...dated.map((task) => task.finish as number));
    return { min, max, origin: min - MARGIN_DAYS * DAY_MS, end: max + MARGIN_DAYS * DAY_MS };
  }, [tasks]);

  const calendar = useMemo<Calendar | null>(() => {
    if (!active) return null;
    return toCoreCalendar(useDomainStore.getState(), active.id);
    // calendários/exceções invalidam o cache: o calendário muda com eles
  }, [active, calendars, exceptions]);

  if (!open) return null;

  const close = () => setPanel("team", false);
  const px = (date: number) => ((date - (bounds?.origin ?? 0)) / DAY_MS) * pxPerDay;
  const stripWidth = bounds ? Math.max(120, px(bounds.end)) : 120;

  const people = Object.values(resources)
    .filter((resource) => resource.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  const barsOf = (resourceId: string): Bar[] =>
    Object.values(assignments)
      .filter((assignment) => assignment.resourceId === resourceId)
      .map((assignment) => ({ assignment, task: tasks[assignment.taskId] }))
      .filter(
        (entry) =>
          entry.task !== undefined &&
          !entry.task.isInactive &&
          entry.task.start !== null &&
          entry.task.finish !== null,
      )
      .map((entry) => ({
        assignment: entry.assignment,
        task: entry.task as Task,
        left: px((entry.task as Task).start as number),
        width: Math.max(
          6,
          px(((entry.task as Task).finish as number) + DAY_MS) -
            px((entry.task as Task).start as number),
        ),
      }));

  const segmentsOf = (resourceId: string): Segment[] => {
    const out: Segment[] = [];
    const list = (overallocation?.days ?? []).filter((day) => day.resourceId === resourceId);
    for (const day of list) {
      const last = out[out.length - 1];
      if (last && last.end + DAY_MS === day.date && last.demand === day.demand) {
        last.end = day.date;
      } else {
        out.push({
          start: day.date,
          end: day.date,
          demand: day.demand,
          capacity: day.capacity,
          ratio: day.ratio,
        });
      }
    }
    return out;
  };

  const assignedWorkOf = (resourceId: string): number =>
    Object.values(assignments)
      .filter((assignment) => assignment.resourceId === resourceId)
      .reduce((sum, assignment) => {
        const task = tasks[assignment.taskId];
        return sum + (assignment.work ?? (task?.duration ?? 0) * assignment.units);
      }, 0);

  const beginDrag = (
    event: React.PointerEvent,
    assignmentId: string,
    resourceId: string,
  ) => {
    event.preventDefault();
    dragRef.current = { assignmentId, startX: event.clientX, resourceId };
    setDrag({ assignmentId, dx: 0 });

    const onMove = (moveEvent: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      setDrag({ assignmentId, dx: moveEvent.clientX - current.startX });
    };
    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      dragRef.current = null;

      const element = document
        .elementFromPoint(upEvent.clientX, upEvent.clientY)
        ?.closest("[data-resource-id]") as HTMLElement | null;
      const target = element?.dataset.resourceId;
      if (target && target !== resourceId) {
        useDomainStore.getState().updateAssignment(assignmentId, { resourceId: target });
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className={styles.backdrop}
      data-testid="team-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Equipe"
        data-testid="team-panel"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Equipe</h2>
          <span className={styles.legend}>
            <span className={styles.legendSwatch} aria-hidden="true" /> superalocado
          </span>
          <button
            type="button"
            className={styles.close}
            data-testid="team-close"
            onClick={close}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          {people.length === 0 ? (
            <p className={styles.empty} data-testid="team-people-empty">
              Nenhuma pessoa cadastrada — use o painel Recursos.
            </p>
          ) : (
            people.map((resource: Resource) => {
              const bars = barsOf(resource.id);
              const segments = segmentsOf(resource.id);
              const assigned = assignedWorkOf(resource.id);
              const capacity = bounds
                ? durationBetween(calendar ?? defaultCalendarFallback(), bounds.min, bounds.max + DAY_MS) *
                  resource.maxUnits
                : 0;
              const idle = Math.max(capacity - assigned, 0);

              return (
                <div
                  key={resource.id}
                  className={styles.personRow}
                  data-testid="team-person-row"
                  data-resource-id={resource.id}
                >
                  <div className={styles.personInfo}>
                    <span
                      className={styles.avatar}
                      style={{ background: resource.color }}
                      aria-hidden="true"
                    >
                      {resource.initials ?? resource.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className={styles.personTexts}>
                      <span className={styles.personName}>{resource.name}</span>
                      <span className={styles.personSummary} data-testid="person-summary">
                        {formatDuration(assigned)} atribuídas · capacidade{" "}
                        {formatDuration(capacity)} · ocioso {formatDuration(idle)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.strip} style={{ width: stripWidth }}>
                    {bars.map((bar) => (
                      <div
                        key={bar.assignment.id}
                        className={styles.bar}
                        data-testid="team-assignment-bar"
                        data-assignment-id={bar.assignment.id}
                        data-task-id={bar.task.id}
                        title={`${bar.task.name} — arraste para reatribuir`}
                        style={{
                          left: bar.left,
                          width: bar.width,
                          background: resource.color,
                          transform:
                            drag?.assignmentId === bar.assignment.id
                              ? `translateX(${drag.dx}px)`
                              : undefined,
                          zIndex: drag?.assignmentId === bar.assignment.id ? 3 : 1,
                        }}
                        onPointerDown={(event) =>
                          beginDrag(event, bar.assignment.id, resource.id)
                        }
                      >
                        <span className={styles.barLabel}>{bar.task.name}</span>
                      </div>
                    ))}

                    {segments.map((segment) => (
                      <div
                        key={`${segment.start}-${segment.end}`}
                        className={styles.conflict}
                        data-testid="overallocation"
                        data-demand={segment.demand}
                        data-capacity={segment.capacity}
                        data-ratio={segment.ratio}
                        data-start={segment.start}
                        data-end={segment.end}
                        title={`Superalocação: ${segment.demand} de ${segment.capacity} unidades`}
                        style={{
                          left: px(segment.start),
                          width: Math.max(6, px(segment.end + DAY_MS) - px(segment.start)),
                          zIndex: 2,
                          pointerEvents: "none",
                        }}
                      >
                        <span className={styles.conflictLabel}>
                          {segment.ratio.toFixed(1).replace(".", ",")}×
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** Fallback quando ainda não há calendário carregado (evita divisão por zero). */
function defaultCalendarFallback(): Calendar {
  return {
    id: "",
    name: "",
    weeklyMask: 0b00011111,
    workingHoursStart: "09:00",
    workingHoursEnd: "18:00",
    exceptions: [],
  };
}
