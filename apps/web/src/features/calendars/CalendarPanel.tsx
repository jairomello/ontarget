import { newId } from "@ontarget/shared";
import { useState } from "react";
import { formatDate } from "../../lib/api";
import { selectActiveCalendar, useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import type { CalendarException } from "../../store/types";
import styles from "./CalendarPanel.module.css";

/** Dias na ordem dos bits da máscara (bit 0 = segunda-feira). */
const WEEKDAYS = [
  { key: "seg", label: "Segunda" },
  { key: "ter", label: "Terça" },
  { key: "qua", label: "Quarta" },
  { key: "qui", label: "Quinta" },
  { key: "sex", label: "Sexta" },
  { key: "sab", label: "Sábado" },
  { key: "dom", label: "Domingo" },
] as const;

/** Epoch ms UTC-naive a partir de um valor `yyyy-mm-dd` de `<input type=date>`. */
function isoToUtcDay(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function utcDayToIso(value: number): string {
  const date = new Date(value);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Interface de calendários (specs/calendars): dias úteis por dia da semana,
 * turno com início/fim e exceções pontuais (feriado ou dia útil especial).
 * Toda alteração é aplicada imediatamente e reagenda as tarefas afetadas.
 */
export function CalendarPanel() {
  const open = useUiStore((state) => state.panels.calendars);
  const setPanel = useUiStore((state) => state.setPanel);
  const calendars = useDomainStore((state) => state.calendars);
  const active = useDomainStore(selectActiveCalendar);
  const exceptions = useDomainStore((state) => state.calendarExceptions);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dateValue, setDateValue] = useState("");
  const [nature, setNature] = useState<"holiday" | "workday">("holiday");
  const [name, setName] = useState("");
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const calendar = (selectedId ? calendars[selectedId] : undefined) ?? active;
  const close = () => setPanel("calendars", false);

  /** Cria um calendário novo (ou cópia do atual) e o seleciona. */
  const createCalendar = (sourceId?: string) => {
    const domain = useDomainStore.getState();
    const count = Object.keys(domain.calendars).length + 1;
    const id = domain.createCalendar(
      sourceId !== undefined
        ? `Cópia de ${domain.calendars[sourceId]?.name ?? "calendário"}`
        : `Calendário ${count}`,
      sourceId,
    );
    setSelectedId(id);
    setNameDraft(null);
    setError(null);
  };

  const deleteCalendar = () => {
    if (!calendar) return;
    const result = useDomainStore.getState().removeCalendar(calendar.id);
    if (result.ok) {
      setSelectedId(null);
      setNameDraft(null);
      setError(null);
    } else {
      setError(result.reason ?? "Não foi possível excluir o calendário.");
    }
  };

  const calendarExceptions = calendar
    ? Object.values(exceptions)
        .filter((exception) => exception.calendarId === calendar.id)
        .sort((a, b) => a.date - b.date)
    : [];

  return (
    <div
      className={styles.backdrop}
      data-testid="calendars-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Calendários"
        data-testid="calendars-panel"
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
          <h2 className={styles.title}>Calendários</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="calendars-close"
            onClick={close}
          >
            Esc
          </button>
        </header>

        {calendar && (
          <div className={styles.body}>
            {Object.keys(calendars).length > 1 && (
              <label className={styles.field}>
                <span>Calendário</span>
                <select
                  data-testid="calendar-select"
                  value={calendar.id}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  {Object.values(calendars).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.isDefault ? " (padrão)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Gerenciamento</h3>

              <label className={styles.field}>
                <span>Nome</span>
                <input
                  type="text"
                  data-testid="calendar-name"
                  value={nameDraft ?? calendar.name}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={() => {
                    const next = nameDraft?.trim();
                    if (next && next !== calendar.name) {
                      useDomainStore.getState().updateCalendar(calendar.id, { name: next });
                    }
                    setNameDraft(null);
                  }}
                />
              </label>

              <div className={styles.manageButtons}>
                <button
                  type="button"
                  className={styles.addButton}
                  data-testid="calendar-create"
                  onClick={() => createCalendar()}
                >
                  Novo
                </button>
                <button
                  type="button"
                  className={styles.addButton}
                  data-testid="calendar-duplicate"
                  onClick={() => createCalendar(calendar.id)}
                >
                  Duplicar
                </button>
                <button
                  type="button"
                  className={styles.removeButton}
                  data-testid="calendar-delete"
                  onClick={deleteCalendar}
                >
                  Excluir
                </button>
              </div>

              {error && (
                <p className={styles.error} data-testid="calendar-error">
                  {error}
                </p>
              )}
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Dias úteis e turno</h3>

              <div className={styles.weekdays} role="group" aria-label="Dias da semana">
                {WEEKDAYS.map((day, index) => {
                  const bit = 1 << index;
                  const checked = (calendar.weeklyMask & bit) !== 0;
                  return (
                    <label key={day.key} className={styles.weekday}>
                      <input
                        type="checkbox"
                        data-testid={`weekday-${day.key}`}
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? calendar.weeklyMask & ~bit
                            : calendar.weeklyMask | bit;
                          useDomainStore.getState().updateCalendar(calendar.id, {
                            weeklyMask: next,
                          });
                        }}
                      />
                      <span>{day.label}</span>
                    </label>
                  );
                })}
              </div>

              <div className={styles.shift}>
                <label className={styles.field}>
                  <span>Início do turno</span>
                  <input
                    type="time"
                    data-testid="workday-start"
                    value={calendar.workingHoursStart}
                    onChange={(event) => {
                      if (event.target.value)
                        useDomainStore.getState().updateCalendar(calendar.id, {
                          workingHoursStart: event.target.value,
                        });
                    }}
                  />
                </label>
                <label className={styles.field}>
                  <span>Fim do turno</span>
                  <input
                    type="time"
                    data-testid="workday-end"
                    value={calendar.workingHoursEnd}
                    onChange={(event) => {
                      if (event.target.value)
                        useDomainStore.getState().updateCalendar(calendar.id, {
                          workingHoursEnd: event.target.value,
                        });
                    }}
                  />
                </label>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Exceções</h3>

              <div className={styles.addRow}>
                <label className={styles.field}>
                  <span>Data</span>
                  <input
                    type="date"
                    data-testid="exception-date"
                    value={dateValue}
                    onChange={(event) => setDateValue(event.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span>Natureza</span>
                  <select
                    data-testid="exception-nature"
                    value={nature}
                    onChange={(event) =>
                      setNature(event.target.value as "holiday" | "workday")
                    }
                  >
                    <option value="holiday">Feriado (não útil)</option>
                    <option value="workday">Dia útil especial</option>
                  </select>
                </label>

                <label className={styles.field}>
                  <span>Nome</span>
                  <input
                    type="text"
                    data-testid="exception-name"
                    value={name}
                    placeholder={nature === "holiday" ? "Feriado" : "Compensação"}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>

                <button
                  type="button"
                  className={styles.addButton}
                  data-testid="exception-add"
                  onClick={() => {
                    const date = isoToUtcDay(dateValue);
                    if (date === null) return;

                    const isWorking = nature === "workday";
                    const exception: CalendarException = {
                      id: newId(),
                      calendarId: calendar.id,
                      date,
                      isWorking,
                      name: name.trim() || (isWorking ? "Dia útil especial" : "Feriado"),
                      startTime: null,
                      endTime: null,
                    };

                    useDomainStore.getState().addCalendarException(exception);
                    setDateValue("");
                    setName("");
                  }}
                >
                  Adicionar
                </button>
              </div>

              {calendarExceptions.length === 0 ? (
                <p className={styles.empty} data-testid="exceptions-empty">
                  Nenhuma exceção cadastrada.
                </p>
              ) : (
                <ul className={styles.list}>
                  {calendarExceptions.map((exception) => (
                    <li
                      key={exception.id}
                      className={styles.exceptionRow}
                      data-testid="exception-row"
                      data-date={exception.date}
                    >
                      <span className={styles.exceptionDate}>
                        {formatDate(exception.date)}
                      </span>
                      <span
                        className={
                          exception.isWorking ? styles.badgeWork : styles.badgeHoliday
                        }
                      >
                        {exception.isWorking ? "Dia útil" : "Feriado"}
                      </span>
                      <span className={styles.exceptionName}>
                        {exception.name ?? "—"}
                      </span>
                      <button
                        type="button"
                        className={styles.removeButton}
                        data-testid="exception-remove"
                        aria-label={`Remover exceção de ${formatDate(exception.date)}`}
                        onClick={() =>
                          useDomainStore.getState().removeCalendarException(exception.id)
                        }
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className={styles.hint}>
                Feriados deixam o dia sem tempo útil: as tarefas afetadas são
                reagendadas e a coluna aparece sombreada no Gantt.
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
