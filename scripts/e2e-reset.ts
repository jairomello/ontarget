import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Apaga o banco do E2E antes de subir o servidor (specs/user-auth — o
 * primeiro acesso precisa começar de um banco vazio).
 *
 * Caminho cruzado por plataforma: nada de `rm -f` no script npm.
 */
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const dbPath = path.resolve(REPO_ROOT, process.env.DATABASE_PATH ?? "data/e2e.db");

for (const suffix of ["", "-shm", "-wal"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

console.log(`[e2e] banco removido: ${dbPath}`);
