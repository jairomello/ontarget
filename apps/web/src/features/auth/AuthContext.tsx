import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError, api, setUnauthorizedHandler, type AuthUser } from "../../lib/api";
import { useUiStore } from "../../store/uiStore";
import type { DensityName, PaletteName, ThemeName } from "../../ui/theme";
import styles from "./auth.module.css";

/**
 * Sessão no cliente (specs/user-auth e user-profile).
 *
 * O boot pergunta primeiro se falta a conta inicial (`/api/auth/state`) e
 * depois quem é o usuário (`/api/auth/me`); qualquer 401 em chamada de dados
 * limpa a sessão e volta ao login preservando a rota pretendida.
 */

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** `true` quando a instalação ainda não tem nenhuma conta. */
  needsSetup: boolean;
  login: (email: string, password: string) => Promise<void>;
  setup: (input: {
    email: string;
    name: string;
    password: string;
    confirmPassword: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  /** Troca otimista do usuário (nome, aparência, foto). */
  applyUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Localização sempre atual para o handler de 401, sem recriar o efeito a
  // cada navegação (e funcionando também em `MemoryRouter` nos testes).
  const locationRef = useRef(location);
  locationRef.current = location;

  // Enquanto o boot não termina, o próprio boot decide a sessão: um 401 do
  // `/api/auth/me` atrasado não pode derrubar um login que já aconteceu.
  const bootingRef = useRef(true);
  const sessionEpoch = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const epoch = sessionEpoch.current;

    void (async () => {
      try {
        const state = await api.authState();
        if (!cancelled && epoch === sessionEpoch.current) setNeedsSetup(state.needsSetup);
      } catch {
        // Sem estado confiável, deixa `/api/auth/me` decidir.
      }

      try {
        const { user: me } = await api.me();
        if (cancelled || epoch !== sessionEpoch.current) return;
        setUser(me);
        setNeedsSetup(false);
        setStatus("authenticated");
      } catch (error) {
        if (cancelled || epoch !== sessionEpoch.current) return;
        if (error instanceof ApiError && error.status !== 401) {
          // Falha de rede/servidor: não há sessão para aproveitar.
          setUser(null);
        }
        setStatus("anonymous");
      } finally {
        if (!cancelled) bootingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (bootingRef.current) return;

      setUser(null);
      setStatus((current) => (current === "loading" ? current : "anonymous"));

      const current = locationRef.current;
      const path = `${current.pathname}${current.search}`;
      const isAuthRoute = path.startsWith("/login") || path.startsWith("/primeiro-acesso");
      if (!isAuthRoute) {
        navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
      }
    });
    return () => setUnauthorizedHandler(undefined);
  }, [navigate]);

  const login = useCallback(async (email: string, password: string) => {
    sessionEpoch.current += 1;
    const { user: logged } = await api.login({ email, password });
    setUser(logged);
    setNeedsSetup(false);
    setStatus("authenticated");
  }, []);

  const setup = useCallback(
    async (input: { email: string; name: string; password: string; confirmPassword: string }) => {
      sessionEpoch.current += 1;
      const { user: created } = await api.setup(input);
      setUser(created);
      setNeedsSetup(false);
      setStatus("authenticated");
    },
    [],
  );

  const logout = useCallback(async () => {
    sessionEpoch.current += 1;
    try {
      await api.logout();
    } finally {
      setUser(null);
      setStatus("anonymous");
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const applyUser = useCallback((next: AuthUser) => setUser(next), []);

  // Preferências vêm da conta: aplica tema, densidade e paleta no carregamento
  // (specs/user-profile — "Aparência guardada na conta"). O `localStorage` já
  // deu o boot instantâneo; aqui a verdade do servidor prevalece.
  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    const current = useUiStore.getState();
    if (current.theme !== user.theme) current.setTheme(user.theme as ThemeName);
    if (current.density !== user.density) current.setDensity(user.density as DensityName);
    if (current.palette !== user.palette) current.setPalette(user.palette as PaletteName);
  }, [status, user]);

  const value: AuthContextValue = {
    status,
    user,
    needsSetup,
    login,
    setup,
    logout,
    applyUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return context;
}

/**
 * Guarda as rotas autenticadas (specs/user-auth — "Sessão expirada").
 * Sem sessão, manda para o primeiro acesso quando a instalação ainda não tem
 * conta, ou para o login com a rota pretendida em `next`.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, needsSetup } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <p data-testid="auth-loading" className={styles.loading}>
        Carregando…
      </p>
    );
  }

  if (status === "authenticated") return <>{children}</>;

  const target = needsSetup
    ? "/primeiro-acesso"
    : `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  return <Navigate to={target} replace />;
}
