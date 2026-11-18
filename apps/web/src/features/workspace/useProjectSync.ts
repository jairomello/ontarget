import { useEffect } from "react";
import { api, type SyncBatch } from "../../lib/api";
import { SyncQueue } from "../../lib/syncQueue";
import { onDirty } from "../../store/dirty";
import { useUiStore } from "../../store/uiStore";

/**
 * Liga o barramento de alterações do domínio à fila de sincronização
 * (specs/persistence — gravação automática em lote, debounce de 800 ms).
 *
 * Enquanto houver alteração pendente, o indicador de salvamento na barra
 * de aplicação reflete o estado real (specs/ui-shell).
 */
export function useProjectSync(projectId: string | undefined): void {
  useEffect(() => {
    if (!projectId) return;

    const setSaveState = useUiStore.getState().setSaveState;
    const queue = new SyncQueue({
      projectId,
      send: async (id, batch) => {
        await api.sync(id, batch as SyncBatch);
        setSaveState("saved");
      },
      onError: () => setSaveState("error"),
    });

    const off = onDirty((event) => {
      if (event.kind === "delete") queue.markDelete(event.entity, event.key);
      else if (event.row) queue.markUpsert(event.entity, event.key, event.row);
      setSaveState("saving");
    });

    return () => {
      off();
      void queue.flush();
    };
  }, [projectId]);
}
