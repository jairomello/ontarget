import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Registra o DOM do happy-dom **no carregamento do módulo** — precisa
 * acontecer antes de `@testing-library/react`, que captura `document.body`
 * ao ser importado. Importe este arquivo antes de qualquer teste de
 * componente.
 *
 * Depois do registro, os primitivos HTTP (`fetch`, `Request`, `Response`,
 * `Headers`, `FormData`, `Blob`, `File`) voltam a ser os do runtime: o
 * happy-dom filtra cabeçalhos como `Set-Cookie` (header proibido no navegador)
 * e isso derrubaria os testes de contrato do servidor quando os dois pacotes
 * rodam no mesmo processo. O DOM continua sendo o do happy-dom.
 */
const HTTP_GLOBALS = ["fetch", "Request", "Response", "Headers", "FormData", "Blob", "File"] as const;

const nativeHttp = Object.fromEntries(
  HTTP_GLOBALS.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
);

if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register();
  for (const name of HTTP_GLOBALS) {
    const native = nativeHttp[name];
    if (native !== undefined) {
      (globalThis as Record<string, unknown>)[name] = native;
    }
  }
}

// React exige esta flag para que `act()` (usado pelo Testing Library)
// aplique as atualizações de estado de forma síncrona.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Re-registra se algum teste anterior removeu o DOM. */
export function ensureDom(): void {
  if (typeof globalThis.document === "undefined") {
    GlobalRegistrator.register();
    for (const name of HTTP_GLOBALS) {
      const native = nativeHttp[name];
      if (native !== undefined) {
        (globalThis as Record<string, unknown>)[name] = native;
      }
    }
  }
}
