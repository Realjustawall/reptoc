#!/usr/bin/env node
/**
 * Idempotent SQL migration runner for Reptoc.
 *
 * Applies every migrations/*.sql file exactly once, in lexical order,
 * recording each success in the schema_migrations table. Designed for
 * managed PostgreSQL providers where the application role may not own
 * every table: it never runs ALTER/CREATE at application runtime.
 *
 * Usage:
 *   node scripts/run-migrations.mjs                 # apply pending migrations
 *   node scripts/run-migrations.mjs --status        # list applied/pending
 *
 * Connection: DATABASE_URL or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

// The server loads .env through dotenv; this script must do the same or the
// connection falls back to an undefined password and fails with
// "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string".
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

function connectionConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: /sslmode=require|ssl=true/i.test(process.env.DATABASE_URL)
        ? { rejectUnauthorized: false }
        : process.env.PGSSLMODE === "require" || process.env.PGSSL === "true"
          ? { rejectUnauthorized: false }
          : undefined,
    };
  }
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSLMODE === "require" || process.env.PGSSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
  };
}

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedSet(client) {
  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  return new Set(rows.map((row) => row.filename));
}

async function main() {
  const statusOnly = process.argv.includes("--status");
  const pool = new pg.Pool(connectionConfig());
  try {
    await ensureTrackingTable(pool);
    const applied = await appliedSet(pool);
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b, "en"));

    // Numeric-prefixed files first, then dated ones, both lexically.
    files.sort((a, b) => {
      const numeric = /^[0-9]+_/.test(a) === /^[0-9]+_/.test(b) ? 0 : /^[0-9]+_/.test(a) ? -1 : 1;
      return numeric !== 0 ? numeric : a.localeCompare(b, "en");
    });

    const pending = files.filter((name) => !applied.has(name));
    console.log(`[migrations] ${applied.size} applied, ${pending.length} pending.`);

    if (statusOnly) {
      for (const name of files) {
        console.log(`${applied.has(name) ? "[x]" : "[ ]"} ${name}`);
      }
      return;
    }

    for (const name of pending) {
      const sqlText = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sqlText);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [name]);
        await client.query("COMMIT");
        console.log(`[migrations] applied ${name}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`[migrations] FAILED ${name}: ${error.message}`);
        console.error("[migrations] Stop. Fix or remove the failing file, then re-run.");
        process.exitCode = 1;
        break;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrations] fatal:", error.message);
  process.exitCode = 1;
});
