/**
 * Identificadores UUIDv7 (ordenáveis por tempo).
 *
 * Gerados no cliente para permitir criação offline; o servidor aceita
 * o id vindo de lá. Formato: 48 bits de timestamp + aleatório, versão 7.
 */
export function newId(): string {
  const now = Date.now();
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);

  // 48 bits de timestamp em big-endian nos 6 primeiros bytes.
  view.setUint32(0, Math.floor(now / 0x10000));
  view.setUint16(4, now >>> 0);

  crypto.getRandomValues(bytes.subarray(6));

  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // versão 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
