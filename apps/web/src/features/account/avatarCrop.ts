/**
 * Recorte quadrado da foto de perfil (specs/user-profile — "Foto com
 * recorte"). A geometria é pura e testável sem canvas; o desenho usa o
 * `canvas` do navegador.
 */

export interface CropInput {
  naturalWidth: number;
  naturalHeight: number;
  /** 1 = imagem inteira no quadrado; acima disso, zoom. */
  zoom: number;
  /** Deslocamento do centro da imagem em pixels do original. */
  offsetX: number;
  offsetY: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  /** Lado do quadrado de origem, em pixels do original. */
  size: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Retângulo quadrado de origem, sempre dentro da imagem. O zoom nunca deixa
 * o lado maior que a menor dimensão (a imagem inteira cabe no quadrado).
 */
export function computeCropRect(input: CropInput): CropRect {
  const { naturalWidth, naturalHeight, zoom, offsetX, offsetY } = input;

  const base = Math.max(1, Math.min(naturalWidth, naturalHeight));
  const safeZoom = Math.max(1, zoom);
  const size = clamp(base / safeZoom, 1, base);

  const centerX = naturalWidth / 2 + offsetX;
  const centerY = naturalHeight / 2 + offsetY;

  const sx = clamp(centerX - size / 2, 0, Math.max(0, naturalWidth - size));
  const sy = clamp(centerY - size / 2, 0, Math.max(0, naturalHeight - size));

  return { sx, sy, size };
}

/** Desenha o recorte num canvas quadrado e devolve WebP. */
export async function cropToBlob(
  image: CanvasImageSource,
  rect: CropRect,
  outputSize = 256,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas indisponível");

  context.drawImage(image, rect.sx, rect.sy, rect.size, rect.size, 0, 0, outputSize, outputSize);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  );
  if (!blob) throw new Error("não foi possível gerar a imagem");
  return blob;
}
