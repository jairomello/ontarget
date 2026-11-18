import { useEffect, useRef } from "react";
import styles from "./ContextMenu.module.css";

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Menu de contexto posicionado (usado pelo Gantt e pelas grades). */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-testid="context-menu"]')) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  const node = ref.current;
  const left = node && x + node.offsetWidth > window.innerWidth - 8 ? x - node.offsetWidth : x;
  const top = node && y + node.offsetHeight > window.innerHeight - 8 ? y - node.offsetHeight : y;

  return (
    <div
      ref={ref}
      className={styles.menu}
      data-testid="context-menu"
      role="menu"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-testid={`menu-${item.id}`}
          disabled={item.disabled}
          className={item.danger ? `${styles.item} ${styles.danger}` : styles.item}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && <kbd className={styles.shortcut}>{item.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}
