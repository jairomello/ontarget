import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../../lib/api";
import { useAuth } from "./AuthContext";
import styles from "./auth.module.css";

const MIN_PASSWORD = 10;

/**
 * Primeiro acesso (specs/user-auth — "Criação da conta inicial").
 * Só existe enquanto a instalação não tem nenhuma conta; depois disso o
 * servidor responde 409 e a tela volta para o login.
 */
export function SetupPage() {
  const { setup, status, needsSetup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = new URLSearchParams(location.search).get("next") ?? "/";

  useEffect(() => {
    if (status === "authenticated") navigate(next, { replace: true });
    else if (status === "anonymous" && !needsSetup) navigate("/login", { replace: true });
  }, [status, needsSetup, next, navigate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (trimmedName === "" || trimmedName.length > 200) {
      setError("Informe o nome (de 1 a 200 caracteres)");
      return;
    }
    if (!trimmedEmail.includes("@")) {
      setError("Informe um e-mail válido");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`A senha precisa de no mínimo ${MIN_PASSWORD} caracteres`);
      return;
    }
    if (password !== confirm) {
      setError("A confirmação não confere com a senha");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await setup({
        email: trimmedEmail,
        name: trimmedName,
        password,
        confirmPassword: confirm,
      });
      navigate(next, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Não foi possível criar a conta. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="setup-title">
        <h1 id="setup-title" className={styles.title}>
          Criar a primeira conta
        </h1>
        <p className={styles.hint}>
          Esta instalação ainda não tem usuário: a conta abaixo será a de acesso.
        </p>

        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <label className={styles.field} htmlFor="setup-name">
            Nome
            <input
              id="setup-name"
              data-testid="setup-name"
              className={styles.input}
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              required
            />
          </label>

          <label className={styles.field} htmlFor="setup-email">
            E-mail
            <input
              id="setup-email"
              data-testid="setup-email"
              className={styles.input}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className={styles.field} htmlFor="setup-password">
            Senha
            <input
              id="setup-password"
              data-testid="setup-password"
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <label className={styles.field} htmlFor="setup-confirm">
            Confirmação da senha
            <input
              id="setup-confirm"
              data-testid="setup-confirm"
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </label>

          {error && (
            <p data-testid="setup-error" className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button data-testid="setup-submit" className={styles.submit} type="submit" disabled={busy}>
            {busy ? "Criando…" : "Criar conta e entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
