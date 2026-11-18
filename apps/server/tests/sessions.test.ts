import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../src/db/index";
import * as schema from "../src/db/schema";
import { createUser } from "../src/services/accounts";
import {
  createToken,
  hashToken,
  issueSession,
  revokeOtherSessions,
  revokeSessionByToken,
  resolveSession,
  SESSION_RENEW_INTERVAL_MS,
  SESSION_TTL_MS,
} from "../src/services/sessions";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "sessions-"));
const db: Db = createDb(path.join(dir, "sessions.db"));
let userId: string;

beforeAll(async () => {
  const user = await createUser(db, {
    email: "sessao@exemplo.org",
    name: "Sessão",
    password: "senha-bem-longa",
  });
  userId = user.id;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("issueSession / resolveSession", () => {
  it("guarda só o hash e devolve o usuário da sessão", () => {
    const { token, session } = issueSession(db, userId);
    const stored = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, session.id))
      .get();

    expect(stored?.tokenHash).toBe(hashToken(token));
    expect(stored?.tokenHash).not.toBe(token);

    const resolved = resolveSession(db, token);
    expect(resolved?.user.id).toBe(userId);
    expect(resolved?.session.id).toBe(session.id);
  });

  it("devolve null para token desconhecido ou vazio", () => {
    expect(resolveSession(db, createToken())).toBeNull();
    expect(resolveSession(db, "")).toBeNull();
  });

  it("apaga e recusa a sessão expirada", () => {
    const { token, session } = issueSession(db, userId);
    const past = Date.now() - SESSION_TTL_MS - 1;
    db.update(schema.sessions)
      .set({ expiresAt: past })
      .where(eq(schema.sessions.id, session.id))
      .run();

    expect(resolveSession(db, token)).toBeNull();
    const gone = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, session.id))
      .get();
    expect(gone).toBeUndefined();
  });

  it("renova o prazo no máximo uma vez por dia", () => {
    const { token, session } = issueSession(db, userId);
    const initial = session.expiresAt;

    // Logo após emitir: não renova.
    const soon = issueSession(db, userId);
    const immediate = resolveSession(db, soon.token, soon.session.createdAt + 60_000);
    expect(immediate?.session.expiresAt).toBe(soon.session.expiresAt);

    // Passou o intervalo de um dia: prazo estendido.
    const later = session.lastSeenAt + SESSION_RENEW_INTERVAL_MS;
    const renewed = resolveSession(db, token, later);
    expect(renewed?.session.expiresAt).toBe(later + SESSION_TTL_MS);
    expect(renewed!.session.expiresAt).toBeGreaterThan(initial);
  });
});

describe("revogação", () => {
  it("logout por token invalida a sessão imediatamente", () => {
    const { token } = issueSession(db, userId);
    expect(revokeSessionByToken(db, token)).toBe(true);
    expect(resolveSession(db, token)).toBeNull();
    expect(revokeSessionByToken(db, token)).toBe(false);
  });

  it("revokeOtherSessions mantém só a sessão atual", () => {
    const current = issueSession(db, userId);
    const other1 = issueSession(db, userId);
    const other2 = issueSession(db, userId);

    revokeOtherSessions(db, userId, current.session.id);

    expect(resolveSession(db, current.token)).not.toBeNull();
    expect(resolveSession(db, other1.token)).toBeNull();
    expect(resolveSession(db, other2.token)).toBeNull();
  });
});
