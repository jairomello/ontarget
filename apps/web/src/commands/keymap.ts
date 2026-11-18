import type { KeyEventLike } from "./types";

/**
 * Conversão de um evento de teclado para a forma canônica dos bindings:
 * `Ctrl+Shift+Right`, `Ctrl+Z`, `F4`, `+`, `Escape`.
 *
 * Regras:
 *  - modificadores sempre na ordem Ctrl, Alt, Shift, Meta;
 *  - teclas de uma letra vão em maiúscula (`Z`);
 *  - `ArrowRight` → `Right`;
 *  - para teclas de um caractere o Shift é ignorado, porque o próprio
 *    caractere já reflete o Shift (`+`, `?`, `*`).
 */
export function comboFromEvent(event: KeyEventLike): string {
  const parts: string[] = [];
  // Para símbolos o Shift já está embutido no caractere ("+", "?"),
  // mas para letras e dígitos ele faz parte da combinação.
  const symbol = event.key.length === 1 && !/^[a-z0-9]$/i.test(event.key);

  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey && !symbol) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");

  parts.push(normalizeKey(event.key));
  return parts.join("+");
}

/** Forma canônica de uma tecla. */
export function normalizeKey(key: string): string {
  let value = key;
  if (value.startsWith("Arrow")) value = value.slice(5);
  if (value.length === 0) return value;

  if (value.length === 1) {
    return /[a-z]/i.test(value) ? value.toUpperCase() : value;
  }

  // "right" → "Right", "ctrl" → "Ctrl", "f4" → "F4"
  if (/^[a-z]/.test(value)) return value.charAt(0).toUpperCase() + value.slice(1);
  return value;
}

const MODIFIER_NAMES = ["Ctrl", "Alt", "Shift", "Meta"] as const;

function isModifier(segment: string): boolean {
  const normalized = normalizeKey(segment);
  return (MODIFIER_NAMES as readonly string[]).includes(normalized);
}

/**
 * Normaliza uma binding escrita à mão para o formato canônico.
 * Aceita qualquer combinação de caixa e de ordem dos modificadores.
 */
export function normalizeCombo(combo: string): string {
  const raw = combo.trim();
  if (raw.length === 0) return raw;
  if (raw.length === 1) return normalizeKey(raw);

  const segments = raw.split("+");
  const modifiers = new Set<string>();
  let key = "";

  for (const segment of segments) {
    // "Ctrl++" → segmento vazio significa a própria tecla "+"
    if (segment === "") {
      key = "+";
      continue;
    }
    if (isModifier(segment)) {
      modifiers.add(normalizeKey(segment));
      continue;
    }
    key = segment;
  }

  const ordered = MODIFIER_NAMES.filter((modifier) => modifiers.has(modifier));
  return [...ordered, normalizeKey(key)].join("+");
}
