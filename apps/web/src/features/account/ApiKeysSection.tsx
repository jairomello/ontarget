import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, api, formatDate, type ApiKeyInfo } from "../../lib/api";
import styles from "./account.module.css";

type Message = { kind: "ok" | "error"; text: string };

/**
 * Chaves de API para agentes (specs/api-keys): gerar, listar e revogar.
 * O valor completo aparece uma única vez, na criação.
 */
export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  /** Formulário aberto (não deve desabilitar o botão de criar). */
  const [showForm, setShowForm] = useState(false);
  /** Envio em andamento. */
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ value: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(async () => {
    try {
      const { keys: list } = await api.listApiKeys();
      setKeys(list);
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Não foi possível carregar as chaves",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      setMessage({ kind: "error", text: "Informe um nome de 1 a 100 caracteres" });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const { key, value } = await api.createApiKey(trimmed);
      setCreated({ value, name: key.name });
      setName("");
      setShowForm(false);
      await load();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Não foi possível criar a chave",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    try {
      await api.revokeApiKey(revokeTarget.id);
      setRevokeTarget(null);
      setMessage({ kind: "ok", text: "Chave revogada" });
      await load();
    } catch (error) {
      setRevokeTarget(null);
      setMessage({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Não foi possível revogar a chave",
      });
    }
  }

  async function copyCreated() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.value);
      setMessage({ kind: "ok", text: "Chave copiada" });
    } catch {
      setMessage({ kind: "error", text: "Não foi possível copiar: selecione o valor manualmente" });
    }
  }

  return (
    <section className={styles.section} id="chaves" aria-labelledby="conta-chaves">
      <h2 id="conta-chaves">Chaves de API (MCP)</h2>
      <p className={styles.sectionHint} data-testid="api-keys-guide">
        A chave é a credencial que um agente MCP usa para falar com esta instalação. Ela é
        exibida uma única vez na criação; guarde em seguida. O servidor MCP será entregue em
        outra entrega.
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          data-testid="api-key-new"
          className={styles.buttonPrimary}
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Fechar" : "Nova chave"}
        </button>
      </div>

      {showForm && (
        <form className={styles.row} onSubmit={(event) => void handleCreate(event)}>
          <label className={styles.field} htmlFor="api-key-name">
            Nome da chave
            <input
              id="api-key-name"
              data-testid="api-key-name"
              className={styles.input}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="agente-de-teste"
              autoFocus
            />
          </label>
          <div className={styles.actions}>
            <button
              type="submit"
              data-testid="api-key-create"
              className={styles.buttonPrimary}
              disabled={submitting}
            >
              {submitting ? "Criando…" : "Criar chave"}
            </button>
          </div>
        </form>
      )}

      {loading && <p className={styles.empty}>Carregando…</p>}

      {!loading && keys.length === 0 && (
        <p className={styles.empty} data-testid="api-keys-empty">
          Nenhuma chave criada ainda.
        </p>
      )}

      {!loading && keys.length > 0 && (
        <div className={styles.keyList} data-testid="api-keys-list">
          {keys.map((key) => (
            <div key={key.id} className={styles.keyItem} data-testid="api-key-item">
              <span className={styles.keyInfo}>
                <strong className={styles.keyName}>{key.name}</strong>
                <span className={styles.keyMeta}>
                  criada em {formatDate(key.createdAt)} ·{" "}
                  {key.lastUsedAt
                    ? `último uso ${formatDate(key.lastUsedAt)}`
                    : "nunca usada"}
                </span>
              </span>
              <button
                type="button"
                data-testid="api-key-revoke"
                className={styles.buttonDanger}
                onClick={() => setRevokeTarget(key)}
              >
                Revogar
              </button>
            </div>
          ))}
        </div>
      )}

      {message && (
        <p
          data-testid={message.kind === "error" ? "api-keys-error" : "api-keys-success"}
          className={message.kind === "error" ? styles.messageError : styles.messageOk}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}

      {created && (
        <div className={styles.overlay} role="presentation">
          <div className={styles.dialog} role="dialog" aria-label="Chave criada">
            <h3>Chave criada</h3>
            <p className={styles.sectionHint}>
              Este é o único momento em que o valor aparece. Copie e guarde.
            </p>
            <code className={styles.code} data-testid="api-key-created-value">
              {created.value}
            </code>
            <div className={styles.dialogActions}>
              <button type="button" data-testid="api-key-copy" className={styles.button} onClick={() => void copyCreated()}>
                Copiar
              </button>
              <button
                type="button"
                data-testid="api-key-created-close"
                className={styles.buttonPrimary}
                onClick={() => setCreated(null)}
              >
                Guardei
              </button>
            </div>
          </div>
        </div>
      )}

      {revokeTarget && (
        <div className={styles.overlay} role="presentation">
          <div className={styles.dialog} role="dialog" aria-label="Revogar chave">
            <h3>Revogar chave</h3>
            <p className={styles.sectionHint}>
              A chave <strong>{revokeTarget.name}</strong> para de funcionar imediatamente.
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                data-testid="api-key-revoke-cancel"
                className={styles.button}
                onClick={() => setRevokeTarget(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="api-key-revoke-confirm"
                className={styles.buttonDanger}
                onClick={() => void handleRevoke()}
              >
                Revogar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
