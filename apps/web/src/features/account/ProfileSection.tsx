import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { initialsOf } from "../auth/ProfileMenu";
import { CropDialog } from "./CropDialog";
import styles from "./account.module.css";

const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp";
/** Tamanho do arquivo escolhido antes do recorte (o envio sai ≤ 512 KB). */
const MAX_PICKED_BYTES = 8 * 1024 * 1024;

type Message = { kind: "ok" | "error"; text: string };

/** Perfil: foto com recorte, nome de exibição e e-mail somente leitura. */
export function ProfileSection() {
  const { user, applyUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  if (!user) return null;

  const busy = savingName || savingPhoto || removingPhoto;

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 200) {
      setMessage({ kind: "error", text: "Nome deve ter de 1 a 200 caracteres" });
      return;
    }
    if (trimmed === user?.name) return;

    setSavingName(true);
    setMessage(null);
    try {
      const { user: updated } = await api.updateProfile({ name: trimmed });
      applyUser(updated);
      setMessage({ kind: "ok", text: "Nome salvo" });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Não foi possível salvar o nome",
      });
    } finally {
      setSavingName(false);
    }
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED.split(",").includes(file.type) || file.size > MAX_PICKED_BYTES) {
      setMessage({ kind: "error", text: "Escolha uma imagem PNG, JPEG, WebP ou GIF de até 8 MB" });
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("falha ao ler o arquivo"));
        reader.readAsDataURL(file);
      });
      setMessage(null);
      setImageSrc(dataUrl);
    } catch {
      setMessage({ kind: "error", text: "Não foi possível ler a imagem" });
    }
  }

  async function confirmCrop(blob: Blob) {
    setSavingPhoto(true);
    setMessage(null);
    try {
      const { user: updated } = await api.uploadAvatar(blob);
      applyUser(updated);
      setImageSrc(null);
      setMessage({ kind: "ok", text: "Foto atualizada" });
    } catch (error) {
      setImageSrc(null);
      setMessage({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Não foi possível enviar a foto",
      });
    } finally {
      setSavingPhoto(false);
    }
  }

  async function removePhoto() {
    setRemovingPhoto(true);
    setMessage(null);
    try {
      const { user: updated } = await api.removeAvatar();
      applyUser(updated);
      setMessage({ kind: "ok", text: "Foto removida" });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof ApiError ? error.message : "Não foi possível remover a foto",
      });
    } finally {
      setRemovingPhoto(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="conta-perfil">
      <h2 id="conta-perfil">Perfil</h2>
      <p className={styles.sectionHint}>Foto exibida no menu e nome usado na aplicação.</p>

      <div className={styles.row}>
        {user.hasAvatar ? (
          <img
            data-testid="account-avatar"
            className={styles.avatar}
            src="/api/users/me/avatar"
            alt={`Foto de ${user.name}`}
          />
        ) : (
          <span data-testid="account-initials" className={styles.avatar} aria-hidden="true">
            {initialsOf(user.name)}
          </span>
        )}

        <label className={styles.field} htmlFor="account-name">
          Nome de exibição
          <span className={styles.actions}>
            <input
              id="account-name"
              data-testid="account-name"
              className={styles.input}
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              data-testid="account-name-save"
              className={styles.buttonPrimary}
              onClick={() => void saveName()}
              disabled={busy}
            >
              {savingName ? "Salvando…" : "Salvar"}
            </button>
          </span>
        </label>

        <label className={styles.field} htmlFor="account-email">
          E-mail
          <input
            id="account-email"
            data-testid="account-email"
            className={styles.input}
            value={user.email}
            readOnly
            disabled
          />
        </label>
      </div>

      <div className={styles.actions} style={{ marginTop: "var(--sp-4)" }}>
        <button
          type="button"
          data-testid="account-photo-change"
          className={styles.button}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {savingPhoto ? "Enviando…" : "Alterar foto"}
        </button>
        {user.hasAvatar && (
          <button
            type="button"
            data-testid="account-photo-remove"
            className={styles.buttonDanger}
            disabled={busy}
            onClick={() => void removePhoto()}
          >
            {removingPhoto ? "Removendo…" : "Remover foto"}
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        data-testid="account-photo-input"
        type="file"
        accept={ACCEPTED}
        className={styles.empty}
        style={{ display: "none" }}
        onChange={(event) => void pickFile(event)}
      />

      {message && (
        <p
          data-testid={message.kind === "error" ? "account-error" : "account-success"}
          className={message.kind === "error" ? styles.messageError : styles.messageOk}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}

      {imageSrc && (
        <CropDialog
          imageSrc={imageSrc}
          saving={savingPhoto}
          onCancel={() => setImageSrc(null)}
          onConfirm={(blob) => void confirmCrop(blob)}
        />
      )}
    </section>
  );
}
