import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Registra o DOM do happy-dom **no carregamento do módulo** — precisa
 * acontecer antes de `@testing-library/react`, que captura `document.body`
 * ao ser importado. Importe este arquivo antes de qualquer teste de
 * componente.
 */
if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register();
}

// React exige esta flag para que `act()` (usado pelo Testing Library)
// aplique as atualizações de estado de forma síncrona.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Re-registra se algum teste anterior removeu o DOM. */
export function ensureDom(): void {
  if (typeof globalThis.document === "undefined") {
    GlobalRegistrator.register();
  }
}
