import { useEffect } from "react";
import { handleKeyDown, contextFromUi } from "../commands";
import { useUiStore } from "../store/uiStore";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/**
 * Conecta o keymap global da aplicação.
 * Nenhum atalho roda durante edição de célula ou digitação em campos
 * (specs/task-sheet — "Nenhum atalho durante edição de célula").
 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const ui = useUiStore.getState();
      const handled = handleKeyDown(event, contextFromUi(ui));

      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
