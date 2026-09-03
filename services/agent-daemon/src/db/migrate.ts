import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPool } from "./pool.js";

const __filename = typeof import.meta.url !== "undefined" ? fileURLToPath(import.meta.url) : "";
const __dirname = __filename ? dirname(__filename) : process.cwd();
const MIGRATIONS_DIR = resolve(__dirname, "migrations");

interface Migration {
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const files = readFileSync(join(MIGRATIONS_DIR, "manifest.txt"), "utf-8")
    .split("\n")
    .filter(Boolean);

  return files.map((file) => ({
    name: file.replace(".sql", ""),
    sql: readFileSync(join(MIGRATIONS_DIR, file), "utf-8"),
  }));
}

async function ensureMigrationsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(pool: pg.Pool): Promise<Set<string>> {
  const result = await pool.query("SELECT name FROM _migrations ORDER BY name");
  return new Set(result.rows.map((r) => r.name));
}

export async function migrate(): Promise<void> {
  const pool = getPool();

  try {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedMigrations(pool);
    const migrations = loadMigrations();
    console.log(`Found ${migrations.length} migrations, ${applied.size} already applied`);

    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        continue;
      }
      console.log(`Applying migration: ${migration.name}`);
      await pool.query("BEGIN");
      try {
        await pool.query(migration.sql);
        await pool.query(
          "INSERT INTO _migrations (name) VALUES ($1)",
          [migration.name],
        );
        await pool.query("COMMIT");
        console.log(`✅ ${migration.name}`);
      } catch (err) {
        await pool.query("ROLLBACK");
        console.error(`❌ ${migration.name} failed`);
        throw err;
      }
    }

    console.log("✅ All migrations applied");
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
