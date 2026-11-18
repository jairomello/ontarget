import { useState, type FormEvent } from "react";
import { ApiError, api } from "../../lib/api";
import styles from "./account.module.css";

const MIN_PASSWORD = 10;

type Message = { kind: "ok" | "error"; text: string };

/** Troca de senha exigindo a atual (specs/user-auth — "Política de senha"). */
export function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (next.length < MIN_PASSWORD) {
      setMessage({ kind: "error", text: `A nova senha precisa de no mínimo ${MIN_PASSWORD} caracteres` });
      return;
    }
    if (next !== confirm) {
      setMessage({ kind: "error", text: "A confirmação não confere com a senha" });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await api.changePassword({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ kind: "ok", text: "Senha alterada" });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Não foi possível alterar a senha",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="conta-senha">
      <h2 id="conta-senha">Senha</h2>
      <p className={styles.sectionHint}>
        A senha atual é exigida; as outras sessões da conta são encerradas.
      </p>

      <form className={styles.row} onSubmit={(event) => void handleSubmit(event)}>
        <label className={styles.field} htmlFor="account-password-current">
          Senha atual
          <input
            id="account-password-current"
            data-testid="account-password-current"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            disabled={busy}
            required
          />
        </label>

        <label className={styles.field} htmlFor="account-password-new">
          Nova senha
          <input
            id="account-password-new"
            data-testid="account-password-new"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            disabled={busy}
            required
          />
        </label>

        <label className={styles.field} htmlFor="account-password-confirm">
          Confirmação
          <input
            id="account-password-confirm"
            data-testid="account-password-confirm"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={busy}
            required
          />
        </label>

        <div className={styles.actions}>
          <button
            type="submit"
            data-testid="account-password-submit"
            className={styles.buttonPrimary}
            disabled={busy}
          >
            {busy ? "Alterando…" : "Alterar senha"}
          </button>
        </div>
      </form>

      <p className={styles.sectionHint}>Mínimo de {MIN_PASSWORD} caracteres.</p>

      {message && (
        <p
          data-testid={message.kind === "error" ? "account-password-error" : "account-password-success"}
          className={message.kind === "error" ? styles.messageError : styles.messageOk}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
