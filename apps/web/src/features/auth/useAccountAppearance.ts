import { useCallback, useRef } from "react";
import { api, type AuthUser } from "../../lib/api";
import { useAppearance } from "../../ui/useAppearance";
import { useAuth } from "./AuthContext";

export interface AppearancePatch {
  theme?: string;
  density?: string;
  palette?: string;
}

/**
 * Aparência aplicada na hora e gravada na conta (specs/user-profile —
 * "Aparência guardada na conta"). Compartilhada pelo menu de perfil e pela
 * página de conta para os dois locais agirem igual.
 *
 * A verdade local é aplicada de imediato e a resposta do servidor não é
 * aplicada por cima: trocar tema e densidade em sequência gera dois PATCH,
 * e a resposta atrasada do primeiro revertia a segunda escolha.
 */
export function useAccountAppearance() {
  const { user, applyUser } = useAuth();
  const { appearance, setTheme, setDensity, setPalette } = useAppearance();
  /** Última preferência escolhida localmente, aplicada sobre qualquer resposta. */
  const localRef = useRef<AppearancePatch>({});

  const persist = useCallback(
    async (patch: AppearancePatch) => {
      const previousUser = user;
      const previousAppearance = { ...appearance };

      localRef.current = { ...localRef.current, ...patch };

      if (patch.theme !== undefined) setTheme(patch.theme as typeof appearance.theme);
      if (patch.density !== undefined) setDensity(patch.density as typeof appearance.density);
      if (patch.palette !== undefined) setPalette(patch.palette as typeof appearance.palette);
      if (previousUser) {
        applyUser({ ...previousUser, ...patch } as AuthUser);
      }

      try {
        await api.updateProfile(patch);
        return true;
      } catch {
        // Falha ao salvar: devolve tudo para não divergir do servidor.
        for (const key of Object.keys(patch) as Array<keyof AppearancePatch>) {
          delete localRef.current[key];
        }
        setTheme(previousAppearance.theme);
        setDensity(previousAppearance.density);
        setPalette(previousAppearance.palette);
        if (previousUser) applyUser(previousUser);
        return false;
      }
    },
    [appearance, applyUser, setDensity, setPalette, setTheme, user],
  );

  return { appearance, persist };
}
