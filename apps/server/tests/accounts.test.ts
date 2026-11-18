import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createDb, type Db } from "../src/db/index";
import {
  AccountsError,
  createUser,
  deleteUser,
  getUserById,
  hashPassword,
  isPasswordAcceptable,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  normalizeName,
  updateUserProfile,
  updateUserPreferences,
  verifyPassword,
} from "../src/services/accounts";
import { issueApiKey } from "../src/services/apiKeys";
import { issueSession, resolveSession, revokeSessionByToken } from "../src/services/sessions";

const TEST_ROOT = "/tmp/opencode/ontarget-tests";
mkdirSync(TEST_ROOT, { recursive: true });

const dir = mkdtempSync(path.join(TEST_ROOT, "accounts-"));
const db: Db = createDb(path.join(dir, "accounts.db"));

function countTable(name: "sessions" | "api_keys" | "users"): number {
  return db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${name}`)[0]?.n ?? 0;
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("normalizeEmail", () => {
  it("remove espaços e baixa as letras", () => {
    expect(normalizeEmail("  Jairo.Silva@Example.COM ")).toBe("jairo.silva@example.com");
  });
});

describe("política de senha", () => {
  it("exige o mínimo de caracteres", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(isPasswordAcceptable("a".repeat(9))).toBe(false);
    expect(isPasswordAcceptable("a".repeat(10))).toBe(true);
  });

  it("hashPassword recusa senha curta antes de calcular", async () => {
    const error = await hashPassword("curta").catch((caught) => caught);
    expect(error).toBeInstanceOf(AccountsError);
    expect((error as AccountsError).code).toBe("password_too_short");
  });

  it("verifica a senha contra o hash e rejeita a errada", async () => {
    const hash = await hashPassword("uma-senha-longa");
    expect(await verifyPassword("uma-senha-longa", hash)).toBe(true);
    expect(await verifyPassword("outra-senha-larga", hash)).toBe(false);
  });
});

describe("normalizeName", () => {
  it("recorta espaços das pontas", () => {
    expect(normalizeName("  Jairo  ")).toBe("Jairo");
  });

  it("updateUserProfile rejeita nome vazio", () => {
    expect(() => updateUserProfile(db, "inexistente", "   ")).toThrow(AccountsError);
  });
});

describe("createUser", () => {
  it("grava o e-mail normalizado e devolve a conta", async () => {
    const user = await createUser(db, {
      email: " Ana.Pereira@Exemplo.org ",
      name: "Ana Pereira",
      password: "senha-bem-longa",
    });
    expect(user.email).toBe("ana.pereira@exemplo.org");
    expect(user.name).toBe("Ana Pereira");
    expect(user.palette).toBe("indigo");
    expect(user.passwordHash).not.toContain("senha-bem-longa");
  });

  it("recusa e-mail duplicado mesmo com caixa ou espaços diferentes", async () => {
    await expect(
      createUser(db, {
        email: "ANA.PEREIRA@exemplo.org",
        name: "Outra Ana",
        password: "senha-bem-longa",
      }),
    ).rejects.toMatchObject({ code: "email_taken" });
  });

  it("aplica os padrões de aparência quando não há preferência", async () => {
    const user = await createUser(db, {
      email: "padroes@exemplo.org",
      name: "Padrões",
      password: "senha-bem-longa",
    });
    expect(user.theme).toBe("auto");
    expect(user.density).toBe("comfortable");
    expect(user.palette).toBe("indigo");
  });
});

describe("updateUserPreferences", () => {
  it("atualiza só os campos enviados", async () => {
    const user = await createUser(db, {
      email: "tema@exemplo.org",
      name: "Tema",
      password: "senha-bem-longa",
    });
    const updated = updateUserPreferences(db, user.id, { palette: "violet" });
    expect(updated?.palette).toBe("violet");
    expect(updated?.theme).toBe("auto");
    expect(updated?.density).toBe("comfortable");
  });
});

describe("integridade referencial das contas", () => {
  it("apagar a conta derruba sessões e chaves em cascata", async () => {
    const user = await createUser(db, {
      email: "cascata@exemplo.org",
      name: "Cascata",
      password: "senha-bem-longa",
    });
    const { token } = issueSession(db, user.id);
    issueApiKey(db, user.id, "Chave da cascata");

    const sessionsBefore = countTable("sessions");
    const keysBefore = countTable("api_keys");

    deleteUser(db, user.id);

    expect(resolveSession(db, token)).toBeNull();
    expect(countTable("sessions")).toBe(sessionsBefore - 1);
    expect(countTable("api_keys")).toBe(keysBefore - 1);
    expect(getUserById(db, user.id)).toBeUndefined();
  });

  it("sessão revogada deixa de resolver", async () => {
    const user = await createUser(db, {
      email: "revogada@exemplo.org",
      name: "Revogada",
      password: "senha-bem-longa",
    });
    const { token } = issueSession(db, user.id);
    expect(resolveSession(db, token)).not.toBeNull();

    expect(revokeSessionByToken(db, token)).toBe(true);
    expect(resolveSession(db, token)).toBeNull();
  });
});
