import { newId } from "@ontarget/shared";
import { useState } from "react";
import { useDomainStore } from "../../store/domainStore";
import { useUiStore } from "../../store/uiStore";
import type { Resource } from "../../store/types";
import styles from "./ResourcesPanel.module.css";

/**
 * Cadastro de pessoas e equipes (specs/resources — "Cadastro de recursos em
 * equipes"): equipes nomeadas/coloridas e pessoas com iniciais, unidades
 * máximas, taxa padrão, calendário e equipe. Toda pessoa criada aqui fica
 * disponível para atribuição em qualquer tarefa do projeto.
 */
export function ResourcesPanel() {
  const open = useUiStore((state) => state.panels.resources);
  const setPanel = useUiStore((state) => state.setPanel);
  const teams = useDomainStore((state) => state.teams);
  const resources = useDomainStore((state) => state.resources);
  const calendars = useDomainStore((state) => state.calendars);
  const projectId = useDomainStore((state) => state.projectId);

  const [teamName, setTeamName] = useState("");
  const [teamColor, setTeamColor] = useState("#0ea5e9");
  const [personName, setPersonName] = useState("");
  const [personInitials, setPersonInitials] = useState("");
  const [personColor, setPersonColor] = useState("#6366f1");
  const [personUnits, setPersonUnits] = useState("1");
  const [personRate, setPersonRate] = useState("0");
  const [personTeam, setPersonTeam] = useState("");
  const [personCalendar, setPersonCalendar] = useState("");

  if (!open) return null;

  const close = () => setPanel("resources", false);

  const addTeam = () => {
    const name = teamName.trim();
    if (!name) return;
    useDomainStore.getState().addTeam({
      id: newId(),
      name,
      color: teamColor,
      sortOrder: Object.keys(teams).length,
    });
    setTeamName("");
  };

  const addPerson = () => {
    const name = personName.trim();
    if (!name || !projectId) return;

    const resource: Resource = {
      id: newId(),
      projectId,
      teamId: personTeam || null,
      name,
      initials: personInitials.trim() || null,
      color: personColor,
      type: "work",
      maxUnits: Number(personUnits) || 1,
      standardRate: Number(personRate) || 0,
      costPerUse: 0,
      calendarId: personCalendar || null,
      email: null,
      active: true,
      notes: null,
    };

    useDomainStore.getState().addResource(resource);
    setPersonName("");
    setPersonInitials("");
  };

  const teamList = Object.values(teams).sort((a, b) => a.sortOrder - b.sortOrder);
  const people = Object.values(resources).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      className={styles.backdrop}
      data-testid="resources-backdrop"
      onClick={close}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Recursos"
        data-testid="resources-panel"
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
          <h2 className={styles.title}>Recursos</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="resources-close"
            onClick={close}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Equipes</h3>

            <div className={styles.addRow}>
              <input
                type="text"
                className={styles.field}
                data-testid="team-name"
                placeholder="Nome da equipe"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
              />
              <input
                type="color"
                className={styles.colorField}
                data-testid="team-color"
                aria-label="Cor da equipe"
                value={teamColor}
                onChange={(event) => setTeamColor(event.target.value)}
              />
              <button
                type="button"
                className={styles.addButton}
                data-testid="team-add"
                onClick={addTeam}
              >
                Adicionar equipe
              </button>
            </div>

            {teamList.length === 0 ? (
              <p className={styles.empty} data-testid="teams-empty">
                Nenhuma equipe cadastrada.
              </p>
            ) : (
              <ul className={styles.list}>
                {teamList.map((team) => (
                  <li key={team.id} className={styles.row} data-testid="team-row">
                    <span
                      className={styles.dot}
                      style={{ background: team.color }}
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      className={styles.field}
                      data-testid="team-row-name"
                      defaultValue={team.name}
                      key={`${team.id}-${team.name}`}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (next && next !== team.name) {
                          useDomainStore.getState().updateTeam(team.id, { name: next });
                        }
                      }}
                    />
                    <input
                      type="color"
                      className={styles.colorField}
                      data-testid="team-row-color"
                      aria-label={`Cor de ${team.name}`}
                      value={team.color}
                      onChange={(event) =>
                        useDomainStore.getState().updateTeam(team.id, { color: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      className={styles.removeButton}
                      data-testid="team-remove"
                      onClick={() => useDomainStore.getState().removeTeam(team.id)}
                    >
                      Excluir
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Pessoas</h3>

            <div className={styles.addRow}>
              <input
                type="text"
                className={styles.field}
                data-testid="person-name"
                placeholder="Nome"
                value={personName}
                onChange={(event) => setPersonName(event.target.value)}
              />
              <input
                type="text"
                className={styles.initialsField}
                data-testid="person-initials"
                placeholder="Iniciais"
                maxLength={4}
                value={personInitials}
                onChange={(event) => setPersonInitials(event.target.value)}
              />
              <input
                type="color"
                className={styles.colorField}
                data-testid="person-color"
                aria-label="Cor da pessoa"
                value={personColor}
                onChange={(event) => setPersonColor(event.target.value)}
              />
              <input
                type="number"
                className={styles.numberField}
                data-testid="person-units"
                aria-label="Unidades máximas"
                min="0"
                step="0.1"
                value={personUnits}
                onChange={(event) => setPersonUnits(event.target.value)}
              />
              <input
                type="number"
                className={styles.numberField}
                data-testid="person-rate"
                aria-label="Taxa padrão"
                min="0"
                step="0.01"
                value={personRate}
                onChange={(event) => setPersonRate(event.target.value)}
              />
              <select
                className={styles.selectField}
                data-testid="person-team"
                aria-label="Equipe"
                value={personTeam}
                onChange={(event) => setPersonTeam(event.target.value)}
              >
                <option value="">Sem equipe</option>
                {teamList.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <select
                className={styles.selectField}
                data-testid="person-calendar"
                aria-label="Calendário"
                value={personCalendar}
                onChange={(event) => setPersonCalendar(event.target.value)}
              >
                <option value="">Padrão do projeto</option>
                {Object.values(calendars).map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.addButton}
                data-testid="person-add"
                onClick={addPerson}
              >
                Adicionar pessoa
              </button>
            </div>

            {people.length === 0 ? (
              <p className={styles.empty} data-testid="people-empty">
                Nenhuma pessoa cadastrada.
              </p>
            ) : (
              <ul className={styles.list}>
                {people.map((resource) => (
                  <li key={resource.id} className={styles.row} data-testid="person-row">
                    <span
                      className={styles.initialsBadge}
                      style={{ background: resource.color }}
                      aria-hidden="true"
                    >
                      {resource.initials ?? resource.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className={styles.personName}>{resource.name}</span>
                    <span className={styles.meta}>
                      {teams[resource.teamId ?? ""]?.name ?? "Sem equipe"}
                    </span>
                    <span className={styles.meta}>
                      {resource.maxUnits} un · R$ {resource.standardRate}/h
                    </span>
                    <button
                      type="button"
                      className={styles.removeButton}
                      data-testid="person-remove"
                      onClick={() => useDomainStore.getState().removeResource(resource.id)}
                    >
                      Excluir
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
