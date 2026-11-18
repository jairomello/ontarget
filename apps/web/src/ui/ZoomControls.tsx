import { getGanttApi } from "../features/gantt/ganttApi";
import { useUiStore } from "../store/uiStore";
import styles from "./ZoomControls.module.css";

/** Presets de escala (docs/Design.md §7.2). */
const PRESETS: Array<{ value: string; label: string; pxPerDay: number }> = [
  { value: "hours", label: "Horas", pxPerDay: 500 },
  { value: "days", label: "Dias", pxPerDay: 150 },
  { value: "weeks", label: "Semanas", pxPerDay: 40 },
  { value: "months", label: "Meses", pxPerDay: 12 },
  { value: "quarters", label: "Trimestres", pxPerDay: 5 },
  { value: "years", label: "Anos", pxPerDay: 2 },
];

/** Slider logarítmico: 1,5 a 4.000 px/dia (docs/Design.md §7.1). */
const LOG_MIN = Math.log(1.5);
const LOG_MAX = Math.log(4000);

function toSlider(pxPerDay: number): number {
  return Math.round(((Math.log(pxPerDay) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000) / 10;
}

function fromSlider(value: number): number {
  return Math.exp(LOG_MIN + (value / 1000) * (LOG_MAX - LOG_MIN));
}

/** Controles de escala: presets, slider e ajustes — na barra de status. */
export function ZoomControls() {
  const zoom = useUiStore((state) => state.zoom);
  const setZoom = useUiStore((state) => state.setZoom);

  return (
    <span className={styles.zoom}>
      <label className={styles.group}>
        <span className={styles.label}>Escala</span>
        <select
          data-testid="zoom-preset"
          value={zoom.preset ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "") return;
            if (value === "fit-project" || value === "fit-selection") {
              setZoom({ preset: value, forcedUnit: null });
              getGanttApi()?.fit(value === "fit-project" ? "project" : "selection");
              return;
            }
            const preset = PRESETS.find((candidate) => candidate.value === value);
            if (preset) {
              setZoom({ preset: preset.value, pxPerDay: preset.pxPerDay, forcedUnit: preset.value });
            }
          }}
        >
          <option value="">Personalizado</option>
          {PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="fit-project">Ajustar ao projeto</option>
          <option value="fit-selection">Ajustar à seleção</option>
        </select>
      </label>

      <input
        className={styles.slider}
        data-testid="zoom-slider"
        type="range"
        min={0}
        max={1000}
        step={1}
        value={toSlider(zoom.pxPerDay)}
        aria-label="Zoom da escala de tempo"
        onChange={(event) => {
          setZoom({ pxPerDay: fromSlider(Number(event.target.value)), preset: null, forcedUnit: null });
        }}
      />

      <span className={styles.value} data-testid="zoom-value">
        {Math.round(zoom.pxPerDay)} px/dia
      </span>
    </span>
  );
}
