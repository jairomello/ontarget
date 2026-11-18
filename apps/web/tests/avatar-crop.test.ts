import { describe, expect, it } from "bun:test";
import { computeCropRect } from "../src/features/account/avatarCrop";

describe("computeCropRect", () => {
  it("com zoom 1 pega o quadrado central da imagem", () => {
    const rect = computeCropRect({
      naturalWidth: 400,
      naturalHeight: 300,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    });

    expect(rect.size).toBe(300);
    expect(rect.sx).toBe(50);
    expect(rect.sy).toBe(0);
  });

  it("ampliar reduz o lado do recorte pela metade", () => {
    const rect = computeCropRect({
      naturalWidth: 400,
      naturalHeight: 400,
      zoom: 2,
      offsetX: 0,
      offsetY: 0,
    });

    expect(rect.size).toBe(200);
    expect(rect.sx).toBe(100);
    expect(rect.sy).toBe(100);
  });

  it("deslocamento move o centro e o recorte continua dentro da imagem", () => {
    const rect = computeCropRect({
      naturalWidth: 400,
      naturalHeight: 400,
      zoom: 2,
      offsetX: 500,
      offsetY: -500,
    });

    expect(rect.sx + rect.size).toBeLessThanOrEqual(400);
    expect(rect.sx).toBeGreaterThanOrEqual(0);
    expect(rect.sy).toBe(0);
  });

  it("nunca ultrapassa as bordas com zoom mínimo e deslocamento extremo", () => {
    for (const zoom of [1, 1.5, 3]) {
      for (const offset of [-1000, -120, 0, 120, 1000]) {
        const rect = computeCropRect({
          naturalWidth: 640,
          naturalHeight: 480,
          zoom,
          offsetX: offset,
          offsetY: offset,
        });
        expect(rect.sx).toBeGreaterThanOrEqual(0);
        expect(rect.sy).toBeGreaterThanOrEqual(0);
        expect(rect.sx + rect.size).toBeLessThanOrEqual(640);
        expect(rect.sy + rect.size).toBeLessThanOrEqual(480);
      }
    }
  });

  it("zoom abaixo de 1 é tratado como 1", () => {
    const rect = computeCropRect({
      naturalWidth: 200,
      naturalHeight: 200,
      zoom: 0.2,
      offsetX: 0,
      offsetY: 0,
    });
    expect(rect.size).toBe(200);
  });

  it("imagens pequenas não geram recorte de zero", () => {
    const rect = computeCropRect({
      naturalWidth: 1,
      naturalHeight: 1,
      zoom: 4,
      offsetX: 10,
      offsetY: 10,
    });
    expect(rect.size).toBeGreaterThanOrEqual(1);
    expect(rect.sx).toBe(0);
    expect(rect.sy).toBe(0);
  });
});
