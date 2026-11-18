import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError } from "../../lib/api";
import { useAuth } from "./AuthContext";
import styles from "./auth.module.css";

/**
 * Entrada (specs/user-auth — "Entrada com e-mail e senha").
 * A mensagem de falha vem do servidor e é genérica para qualquer credencial.
 */
export function LoginPage() {
  const { login, status, needsSetup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = new URLSearchParams(location.search).get("next") ?? "/";

  useEffect(() => {
    if (status === "authenticated") navigate(next, { replace: true });
    else if (status === "anonymous" && needsSetup) navigate("/primeiro-acesso", { replace: true });
  }, [status, needsSetup, next, navigate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (email.trim() === "" || password === "") {
      setError("Informe e-mail e senha");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Não foi possível entrar. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <h1 id="login-title" className={styles.title}>
          Entrar no ontarget
        </h1>
        <p className={styles.hint}>Use a conta local desta instalação.</p>

        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <label className={styles.field} htmlFor="login-email">
            E-mail
            <input
              id="login-email"
              data-testid="login-email"
              className={styles.input}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className={styles.field} htmlFor="login-password">
            Senha
            <input
              id="login-password"
              data-testid="login-password"
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error && (
            <p data-testid="login-error" className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button data-testid="login-submit" className={styles.submit} type="submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className={styles.hint}>
          Sem conta nesta instalação? <Link to="/primeiro-acesso">Criar a primeira conta</Link>
        </p>
      </section>
    </main>
  );
}
