import { describe, expect, it } from "bun:test";
import { SyncQueue, keyOf, type SyncBatch } from "../src/lib/syncQueue";

interface SenderSpy {
  send: (projectId: string, batch: SyncBatch) => Promise<unknown>;
  calls: Array<{ projectId: string; batch: SyncBatch }>;
  setFail: (value: boolean) => void;
}

function makeSender(): SenderSpy {
  const calls: Array<{ projectId: string; batch: SyncBatch }> = [];
  let fail = false;
  return {
    calls,
    setFail: (value) => {
      fail = value;
    },
    send: async (projectId, batch) => {
      calls.push({ projectId, batch });
      if (fail) throw new Error("falha de rede");
      return undefined;
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SyncQueue", () => {
  it("usa 800 ms de debounce por padrão", () => {
    const queue = new SyncQueue({ projectId: "p1", send: makeSender().send });
    expect(queue.debounceMs).toBe(800);
  });

  it("agrupa várias marcações em um único envio", async () => {
    const sender = makeSender();
    const queue = new SyncQueue({ projectId: "p1", send: sender.send, debounceMs: 30 });

    queue.markUpsert("tasks", "t1", { id: "t1", name: "Um" });
    queue.markUpsert("tasks", "t2", { id: "t2", name: "Dois" });
    queue.markUpsert("tasks", "t3", { id: "t3", name: "Três" });

    expect(queue.isDirty).toBe(true);
    await sleep(80);

    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.projectId).toBe("p1");
    expect(sender.calls[0]?.batch.upserts?.tasks).toHaveLength(3);
    expect(queue.isDirty).toBe(false);
  });

  it("mantém as alterações sujas quando o envio falha", async () => {
    const sender = makeSender();
    const queue = new SyncQueue({ projectId: "p1", send: sender.send, debounceMs: 5 });

    sender.setFail(true);
    queue.markUpsert("tasks", "t1", { id: "t1", name: "Um" });
    await queue.flush();

    expect(sender.calls).toHaveLength(1);
    expect(queue.isDirty).toBe(true);
    expect(queue.pendingCount).toBe(1);

    sender.setFail(false);
    await queue.flush();

    expect(sender.calls).toHaveLength(2);
    expect(queue.isDirty).toBe(false);
  });

  it("exclusão remove o upsert pendente da mesma chave", async () => {
    const sender = makeSender();
    const queue = new SyncQueue({ projectId: "p1", send: sender.send, debounceMs: 5 });

    queue.markUpsert("tasks", "t1", { id: "t1", name: "Um" });
    queue.markDelete("tasks", "t1");
    await queue.flush();

    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.batch.upserts?.tasks ?? []).toHaveLength(0);
    expect(sender.calls[0]?.batch.deletes?.tasks).toEqual(["t1"]);
  });

  it("não envia nada quando não há pendência", async () => {
    const sender = makeSender();
    const queue = new SyncQueue({ projectId: "p1", send: sender.send, debounceMs: 5 });

    await queue.flush();
    expect(sender.calls).toHaveLength(0);
  });

  it("preserva alteração feita durante o envio", async () => {
    const calls: SyncBatch[] = [];
    let first = true;
    const queue = new SyncQueue({
      projectId: "p1",
      debounceMs: 5,
      send: async (_projectId, batch) => {
        calls.push(batch);
        if (first) {
          first = false;
          // simula edição durante a requisição
          queue.markUpsert("tasks", "t1", { id: "t1", name: "Editada depois" });
        }
      },
    });

    queue.markUpsert("tasks", "t1", { id: "t1", name: "Original" });
    await queue.flush();

    expect(calls).toHaveLength(1);
    expect(queue.isDirty).toBe(true);
    expect(queue.pendingCount).toBe(1);
  });
});

describe("keyOf", () => {
  it("usa o id quando existe", () => {
    expect(keyOf({ id: "abc" })).toBe("abc");
  });

  it("monta chave composta para valores sem id", () => {
    expect(keyOf({ baselineId: "b1", taskId: "t1" })).toContain("b1");
    expect(keyOf({ fieldId: "f1", entityId: "e1" })).toContain("f1");
  });
});
