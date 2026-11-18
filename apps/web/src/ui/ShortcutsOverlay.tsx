import { useMemo } from "react";
import { buildShortcutGroups } from "../commands/shortcuts";
import { useUiStore } from "../store/uiStore";
import styles from "./ShortcutsOverlay.module.css";

/**
 * Overlay de atalhos (`?`): lista gerada diretamente do keymap registrado,
 * agrupada por escopo. Fecha com `Escape` ou clique fora.
 */
export function ShortcutsOverlay() {
  const open = useUiStore((state) => state.shortcutsOpen);
  const setOpen = useUiStore((state) => state.setShortcutsOpen);
  const groups = useMemo(() => buildShortcutGroups(), []);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      data-testid="shortcuts-overlay"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Atalhos de teclado"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Atalhos de teclado</h2>
          <button
            type="button"
            className={styles.close}
            data-testid="shortcuts-close"
            aria-label="Fechar"
            onClick={() => setOpen(false)}
          >
            Esc
          </button>
        </header>

        <div className={styles.body}>
          {groups.map((group) => (
            <section key={group.scope} className={styles.group}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              <ul className={styles.list}>
                {group.items.map((item) => (
                  <li key={item.id} className={styles.row} data-testid="shortcut-row">
                    <span className={styles.label}>{item.label}</span>
                    <span className={styles.keys}>
                      {item.keys.map((binding) => (
                        <kbd key={binding} className={styles.kbd}>
                          {binding.split("+").join(" + ")}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
