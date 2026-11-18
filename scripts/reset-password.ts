import { randomBytes } from "node:crypto";
import {
  AccountsError,
  getUserByEmail,
  hashPassword,
  normalizeEmail,
  updateUserPassword,
} from "../apps/server/src/services/accounts";
import { createDb } from "../apps/server/src/db/index";

/**
 * Redefine a senha de uma conta direto no SQLite local (design.md — "Senha
 * esquecida sem e-mail de recuperação").
 *
 *   bun run auth:reset                    # lista as contas
 *   bun run auth:reset <e-mail>           # gera e imprime uma nova senha
 *   bun run auth:reset <e-mail> <senha>   # usa a senha fornecida
 *
 * O caminho do banco vem de `DATABASE_PATH` (padrão: data/ontarget.db).
 */

const [, , emailArg, passwordArg] = process.argv;

const db = createDb();

if (!emailArg) {
  const users = db.all<{ email: string; name: string }>(
    "SELECT email, name FROM users ORDER BY email",
  );
  if (users.length === 0) {
    console.log("Nenhuma conta cadastrada nesta instalação.");
    process.exit(0);
  }
  console.log("Contas desta instalação:");
  for (const user of users) console.log(`  ${user.email}  (${user.name})`);
  console.log("\nUse: bun run auth:reset <e-mail> [senha]");
  process.exit(0);
}

const email = normalizeEmail(emailArg);
const password = passwordArg ?? `redefinida-${randomBytes(9).toString("base64url")}`;

const user = getUserByEmail(db, email);
if (!user) {
  console.error(`Conta não encontrada: ${email}`);
  console.error("Rode `bun run auth:reset` sem argumentos para listar as contas.");
  process.exit(1);
}

try {
  const hash = await hashPassword(password);
  updateUserPassword(db, user.id, hash);
} catch (error) {
  if (error instanceof AccountsError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

console.log(`Senha redefinida para ${email}.`);
console.log(`Nova senha: ${password}`);
console.log("Guarde-a: ela não é exibida de novo.");
