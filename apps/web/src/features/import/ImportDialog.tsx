import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useDomainStore } from "../../store/domainStore";
import { buildImportPayload } from "./commitImport";
import {
  CSV_FIELDS,
  IMPORT_ROW_LIMIT,
  TEMPLATE_CSV,
  buildCsvPlan,
  buildErrorReport,
  buildJsonPlan,
  decodeImport,
  detectDelimiter,
  detectSource,
  parseCsv,
  suggestMapping,
  templateJson,
  type ImportMode,
  type ImportPlan,
} from "./importing";
import styles from "./ImportDialog.module.css";

type Step = "form" | "limit" | "mapping" | "report" | "done";

interface PendingFile {
  text: string;
  source: "csv" | "json";
  header: string[];
  rows: ReturnType<typeof parseCsv>["rows"];
  count: number;
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Importação JSON/CSV (specs/import-export): leitura com detecção de
 * formato/codificação/delimitador, etapa de mapeamento para CSV,
 * pré-validação com relatório de erros e commit transacional via
 * `/api/import` (substituir ou mesclar).
 */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectId = useDomainStore((state) => state.projectId);

  const [step, setStep] = useState<Step>("form");
  const [mode, setMode] = useState<ImportMode>("replace");
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [mapping, setMapping] = useState<Array<string | null>>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // limpa o diálogo ao reabrir
  useEffect(() => {
    if (open) {
      setStep("form");
      setPending(null);
      setPlan(null);
      setError("");
      setMode("replace");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open]);

  if (!open) return null;

  const resetToForm = () => {
    setStep("form");
    setPending(null);
    setPlan(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const proceed = (file: PendingFile) => {
    setPending(file);
    if (file.source === "json") {
      const built = buildJsonPlan(file.text, mode);
      if (built.fatal) {
        setError(built.fatal);
        resetToForm();
        return;
      }
      setPlan(built);
      setStep("report");
      return;
    }
    setMapping(suggestMapping(file.header));
    setStep("mapping");
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setError("");

    try {
      const { text } = decodeImport(await file.arrayBuffer());
      const source = detectSource(text);

      if (source === "csv") {
        const parsed = parseCsv(text, detectDelimiter(text));
        const next: PendingFile = {
          text,
          source,
          header: parsed.header,
          rows: parsed.rows,
          count: parsed.rows.length,
        };
        if (next.count > IMPORT_ROW_LIMIT) {
          setPending(next);
          setStep("limit");
          return;
        }
        proceed(next);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setError("JSON inválido: o arquivo não pôde ser lido.");
        input.value = "";
        return;
      }
      const tasks = (parsed as { data?: { tasks?: unknown } })?.data?.tasks;
      if (!Array.isArray(tasks)) {
        setError("JSON sem a lista de tarefas (data.tasks).");
        input.value = "";
        return;
      }
      const next: PendingFile = { text, source, header: [], rows: [], count: tasks.length };
      if (next.count > IMPORT_ROW_LIMIT) {
        setPending(next);
        setStep("limit");
        return;
      }
      proceed(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ler o arquivo.");
      input.value = "";
    }
  };

  const confirmMapping = () => {
    if (!pending) return;
    const built = buildCsvPlan(pending.rows, mapping, mode);
    setPlan(built);
    setStep("report");
  };

  const commit = async () => {
    if (!plan || !projectId || plan.validRows === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      const state = useDomainStore.getState();
      const payload = buildImportPayload({ ...plan, mode }, {
        projectId,
        tasks: Object.values(state.tasks),
        taskLinks: Object.values(state.taskLinks),
        resources: Object.values(state.resources),
        assignments: Object.values(state.assignments),
        baselines: Object.values(state.baselines),
        customFields: Object.values(state.customFields),
        calendarIds: Object.values(state.calendars).map((calendar) => calendar.id),
        teamIds: Object.values(state.teams).map((team) => team.id),
      });
      await api.importProject(projectId, payload);

      // recarrega o projeto já com o resultado aplicado
      const detail = await api.getProject(projectId);
      state.load(projectId, detail.data, detail.project);
      setStep("done");
    } catch (err) {
      // a transação do servidor desfaz tudo: o plano continua válido
      setError(err instanceof Error ? err.message : "Falha ao importar.");
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------------------------- render */

  const replaceHint =
    plan?.source === "json"
      ? "Substituir apaga tarefas, recursos, campos personalizados e baselines do projeto antes de gravar o arquivo."
      : "Substituir apaga as tarefas do projeto (vinculações e atribuições vão junto) antes de gravar o arquivo.";

  return (
    <div
      className={styles.backdrop}
      data-testid="import-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Importar projeto"
        data-testid="import-dialog"
        data-step={step}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Importar</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="import-close"
            onClick={onClose}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          {error && (
            <p className={styles.error} role="alert" data-testid="import-error">
              {error}
            </p>
          )}

          {step === "form" && (
            <>
              <label className={styles.modeRow}>
                <span>Modo</span>
                <select
                  data-testid="import-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as ImportMode)}
                >
                  <option value="replace">Substituir dados existentes</option>
                  <option value="merge">Mesclar com o projeto</option>
                </select>
              </label>

              <label className={styles.fileRow}>
                <span>Arquivo</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  data-testid="import-file"
                  accept=".csv,.json,.txt,application/json,text/csv"
                  onChange={(event) => void handleFile(event)}
                />
              </label>

              <p className={styles.hint}>
                Formatos aceitos: CSV (codificação e delimitador detectados automaticamente) e
                JSON no formato do produto (versão 1). Até {IMPORT_ROW_LIMIT.toLocaleString("pt-BR")}
                linhas por importação.
              </p>

              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  data-testid="import-template-csv"
                  onClick={() => download("template-importacao.csv", `\uFEFF${TEMPLATE_CSV}`, "text/csv;charset=utf-8")}
                >
                  Baixar template CSV
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  data-testid="import-template-json"
                  onClick={() =>
                    download("exemplo-importacao.json", templateJson(), "application/json")
                  }
                >
                  Baixar exemplo JSON
                </button>
              </div>
            </>
          )}

          {step === "limit" && pending && (
            <>
              <p className={styles.warning} data-testid="import-limit">
                O arquivo tem {pending.count.toLocaleString("pt-BR")} linhas — acima do limite de{" "}
                {IMPORT_ROW_LIMIT.toLocaleString("pt-BR")}. Importar mesmo assim?
              </p>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  data-testid="import-limit-confirm"
                  onClick={() => proceed(pending)}
                >
                  Processar assim mesmo
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  data-testid="import-limit-cancel"
                  onClick={resetToForm}
                >
                  Cancelar
                </button>
              </div>
            </>
          )}

          {step === "mapping" && pending && (
            <>
              <p className={styles.hint}>
                Confira o mapeamento entre as colunas do arquivo e os campos do produto.
              </p>
              <div className={styles.mapping}>
                {pending.header.map((column, index) => (
                  <div key={`${column}-${index}`} className={styles.mappingRow} data-testid="import-map-row">
                    <span className={styles.mappingColumn}>{column || `Coluna ${index + 1}`}</span>
                    <select
                      className={styles.mappingSelect}
                      data-testid="import-map-select"
                      aria-label={`Campo para ${column}`}
                      value={mapping[index] ?? ""}
                      onChange={(event) =>
                        setMapping((current) =>
                          current.map((field, position) =>
                            position === index ? (event.target.value || null) : field,
                          ),
                        )
                      }
                    >
                      <option value="">(ignorar)</option>
                      {CSV_FIELDS.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  data-testid="import-validate"
                  onClick={confirmMapping}
                >
                  Validar arquivo
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  data-testid="import-back"
                  onClick={resetToForm}
                >
                  Voltar
                </button>
              </div>
            </>
          )}

          {step === "report" && plan && (
            <>
              <div className={styles.counts} data-testid="import-report">
                <span data-testid="import-valid-count">{plan.validRows} linhas válidas</span>
                <span data-testid="import-error-count">{plan.invalidRows} linhas com erro</span>
                <span className={styles.hint}>
                  {mode === "replace" ? "Substituição" : "Mesclagem"}
                </span>
              </div>
              <p className={styles.hint}>{replaceHint}</p>

              {plan.errors.length > 0 && (
                <div className={styles.errorList}>
                  {plan.errors.slice(0, 200).map((rowError, index) => (
                    <div
                      key={`${rowError.line}-${index}`}
                      className={styles.errorRow}
                      data-testid="import-error-row"
                      data-line={rowError.line}
                      data-reason={rowError.reason}
                    >
                      <span className={styles.errorLine}>Linha {rowError.line}</span>
                      <span className={styles.errorReason}>{rowError.reason}</span>
                    </div>
                  ))}
                  {plan.errors.length > 200 && (
                    <p className={styles.hint}>
                      … e mais {plan.errors.length - 200} erros no relatório exportável.
                    </p>
                  )}
                </div>
              )}

              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  data-testid="import-commit"
                  disabled={plan.validRows === 0 || busy}
                  onClick={() => void commit()}
                >
                  {busy
                    ? "Importando…"
                    : plan.errors.length > 0
                      ? `Importar ${plan.validRows} válida${plan.validRows === 1 ? "" : "s"}`
                      : `Importar ${plan.validRows} tarefa${plan.validRows === 1 ? "" : "s"}`}
                </button>
                {plan.errors.length > 0 && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    data-testid="import-report-download"
                    onClick={() =>
                      download(
                        "relatorio-importacao.csv",
                        `\uFEFF${buildErrorReport(plan.errors)}`,
                        "text/csv;charset=utf-8",
                      )
                    }
                  >
                    Exportar relatório
                  </button>
                )}
                <button
                  type="button"
                  className={styles.secondaryButton}
                  data-testid="import-back"
                  onClick={resetToForm}
                >
                  Voltar
                </button>
              </div>
            </>
          )}

          {step === "done" && plan && (
            <>
              <p className={styles.success} data-testid="import-done">
                Importação concluída: {plan.validRows} tarefa
                {plan.validRows === 1 ? "" : "s"} aplicada{plan.validRows === 1 ? "" : "s"} em
                uma única transação.
              </p>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  data-testid="import-done-close"
                  onClick={onClose}
                >
                  Fechar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
