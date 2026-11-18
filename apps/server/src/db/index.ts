import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

/** Raiz do repositório, independente do diretório de trabalho. */
export const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
export const MIGRATIONS_FOLDER = path.resolve(import.meta.dir, "../../drizzle");

export type Db = BunSQLiteDatabase<typeof schema>;

export function defaultDbPath(): string {
  return process.env.DATABASE_PATH ?? path.join(REPO_ROOT, "data", "ontarget.db");
}

/**
 * Abre (ou cria) o banco e aplica as migrações pendentes.
 * `migrate` é idempotente: roda apenas o que ainda não foi aplicado.
 */
export function createDb(filePath: string = defaultDbPath()): Db {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const db: Db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/** Lista as tabelas existentes no banco (exclui objetos internos do SQLite). */
export function listTables(db: Db): string[] {
  const rows = db.all<{ name: string }>(
    `SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  );
  return rows.map((r) => r.name);
}
