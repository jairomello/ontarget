/**
 * Verifica a migração inicial: lista as tabelas do banco e confirma a
 * presença das tabelas obrigatórias de docs/architecture.md §4.
 *
 * Uso: bun run scripts/list-tables.ts
 * Sai com código 1 se alguma tabela obrigatória faltar.
 */
import { createDb, defaultDbPath, listTables } from "../src/db/index";

const REQUIRED = [
  "projects",
  "tasks",
  "task_links",
  "resources",
  "assignments",
  "baselines",
  "custom_fields",
  "change_log",
] as const;

const db = createDb();
const tables = listTables(db);

console.log(`banco: ${defaultDbPath()}`);
console.log(`tabelas (${tables.length}):`);
for (const name of tables) console.log(`  - ${name}`);

const missing = REQUIRED.filter((t) => !tables.includes(t));

if (missing.length > 0) {
  console.error(`\nFALTANDO: ${missing.join(", ")}`);
  process.exit(1);
}

const view = db.get<{ name: string }>(
  `SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'v_project_summary'`,
);
if (!view) {
  console.error("\nFALTANDO: visão v_project_summary");
  process.exit(1);
}

console.log(`\nOK — ${REQUIRED.length} tabelas obrigatórias e a visão v_project_summary presentes.`);
