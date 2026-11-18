import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { computeCropRect, cropToBlob } from "./avatarCrop";
import styles from "./account.module.css";

/** Lado do quadro de recorte, em pixels na tela. */
const STAGE = 260;

export interface CropDialogProps {
  imageSrc: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

/**
 * Recorte quadrado antes do envio (specs/user-profile — "Foto com recorte"):
 * arrastar move a imagem, o controle amplia. O quadro mostrado é exatamente
 * o que será enviado.
 */
export function CropDialog({ imageSrc, saving, onCancel, onConfirm }: CropDialogProps) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  const rect = natural
    ? computeCropRect({
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        zoom,
        offsetX: offset.x,
        offsetY: offset.y,
      })
    : null;

  const scale = natural && rect ? STAGE / rect.size : 1;

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: drag.offsetX + (event.clientX - drag.x),
      y: drag.offsetY + (event.clientY - drag.y),
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function confirm() {
    const image = imgRef.current;
    if (!image || !rect) return;
    onConfirm(await cropToBlob(image, rect));
  }

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.dialog} role="dialog" aria-label="Recortar foto">
        <h3>Recortar foto</h3>
        <p className={styles.sectionHint}>Arraste para ajustar e use o controle para ampliar.</p>

        <div
          className={styles.cropStage}
          data-testid="crop-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <img
            ref={imgRef}
            data-testid="crop-image"
            className={styles.cropImage}
            src={imageSrc}
            alt=""
            draggable={false}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            style={
              natural && rect
                ? {
                    width: natural.width * scale,
                    height: natural.height * scale,
                    left: -rect.sx * scale,
                    top: -rect.sy * scale,
                  }
                : { visibility: "hidden" }
            }
          />
        </div>

        <label className={styles.field} htmlFor="crop-zoom">
          Zoom
          <input
            id="crop-zoom"
            data-testid="crop-zoom"
            className={styles.cropRange}
            type="range"
            min={1}
            max={4}
            step={0.1}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>

        <div className={styles.dialogActions}>
          <button
            type="button"
            data-testid="crop-cancel"
            className={styles.button}
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="crop-confirm"
            className={styles.buttonPrimary}
            onClick={() => void confirm()}
            disabled={saving || !natural}
          >
            {saving ? "Salvando…" : "Usar foto"}
          </button>
        </div>
      </div>
    </div>
  );
}
