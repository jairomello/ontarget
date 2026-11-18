import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { PALETTE_SWATCH, PALETTES } from "../../ui/theme";
import { useAuth } from "./AuthContext";
import { useAccountAppearance } from "./useAccountAppearance";
import styles from "./ProfileMenu.module.css";

/** Iniciais do nome de exibição (fallback quando não há foto). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Menu de perfil no canto direito da barra (specs/user-profile — "Menu de
 * perfil na barra do aplicativo"): avatar, identidade e atalhos.
 */
export function ProfileMenu() {
  const { user, logout } = useAuth();
  const { appearance, persist } = useAccountAppearance();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // `Esc` fecha e devolve o foco ao botão.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Ao abrir, o foco vai para a primeira ação: a navegação por setas começa
  // direto, sem precisar tabular para dentro do painel.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => focusItem(0));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    if (items.length === 0) return;
    const bounded = ((index % items.length) + items.length) % items.length;
    items[bounded]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const target = event.target as HTMLElement | null;
    const current = items.findIndex((item) => item === target);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(current <= 0 ? items.length - 1 : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(items.length - 1);
    }
  };

  if (!user) return null;

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <button
        ref={buttonRef}
        type="button"
        data-testid="profile-menu"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Perfil de ${user.name}`}
        onClick={() => setOpen((value) => !value)}
      >
        {user.hasAvatar ? (
          <img data-testid="profile-avatar" className={styles.avatar} src="/api/users/me/avatar" alt="" />
        ) : (
          <span data-testid="profile-initials" className={styles.initials} aria-hidden="true">
            {initialsOf(user.name)}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="profile-menu-panel"
          className={styles.panel}
          role="menu"
          aria-label="Perfil do usuário"
          onKeyDown={(event) => onMenuKeyDown(event)}
        >
          <div className={styles.identity}>
            <strong data-testid="profile-menu-name">{user.name}</strong>
            <span data-testid="profile-menu-email">{user.email}</span>
          </div>

          <div className={styles.separator} role="separator" />

          <div className={styles.appearance}>
            <label className={styles.quickField}>
              <span>Tema</span>
              <select
                data-testid="theme-select"
                value={appearance.theme}
                onChange={(event) => void persist({ theme: event.target.value })}
              >
                <option value="auto">Automático</option>
                <option value="light">Claro</option>
                <option value="dark">Escuro</option>
              </select>
            </label>

            <label className={styles.quickField}>
              <span>Densidade</span>
              <select
                data-testid="density-select"
                value={appearance.density}
                onChange={(event) => void persist({ density: event.target.value })}
              >
                <option value="compact">Compacta</option>
                <option value="comfortable">Confortável</option>
                <option value="wide">Ampla</option>
              </select>
            </label>

            <div className={styles.quickPalettes} role="radiogroup" aria-label="Paleta de cor">
              {PALETTES.map((palette) => (
                <button
                  key={palette}
                  type="button"
                  role="radio"
                  aria-checked={appearance.palette === palette}
                  aria-label={palette}
                  data-testid={`palette-${palette}`}
                  className={
                    appearance.palette === palette ? styles.quickPaletteActive : styles.quickPalette
                  }
                  style={{ background: PALETTE_SWATCH[palette] }}
                  onClick={() => void persist({ palette })}
                />
              ))}
            </div>
          </div>

          <div className={styles.separator} role="separator" />

          <button
            ref={(node) => {
              itemRefs.current[0] = node;
            }}
            type="button"
            role="menuitem"
            data-testid="profile-menu-account"
            className={styles.item}
            onClick={() => go("/conta")}
          >
            Conta e preferências
          </button>

          <button
            ref={(node) => {
              itemRefs.current[1] = node;
            }}
            type="button"
            role="menuitem"
            data-testid="profile-menu-keys"
            className={styles.item}
            onClick={() => go("/conta#chaves")}
          >
            Chaves de API (MCP)
          </button>

          <div className={styles.separator} role="separator" />

          <button
            ref={(node) => {
              itemRefs.current[2] = node;
            }}
            type="button"
            role="menuitem"
            data-testid="profile-menu-logout"
            className={styles.item}
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
