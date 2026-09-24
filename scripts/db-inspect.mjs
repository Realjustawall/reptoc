#!/usr/bin/env node
/**
 * Read-only schema inspection helper.
 *
 * Prints the connected role, migration bookkeeping, table ownership and the
 * presence of the columns the admin and challenge surfaces depend on. Used to
 * tell "pending migration" apart from "insufficient privileges".
 */
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "require" || process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
const rows = async (sql, params) => (await client.query(sql, params)).rows;

console.log("current_user:", (await rows("SELECT current_user AS u"))[0].u);

try {
  console.log("schema_migrations rows:", (await rows("SELECT count(*)::int c FROM schema_migrations"))[0].c);
} catch {
  console.log("schema_migrations: table missing");
}

const adminColumns = await rows(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users'
      AND column_name IN ('custom_role_id','is_staff','blocked','publishing_blocked')`,
);
console.log("users admin columns:", adminColumns.map((r) => r.column_name).join(", ") || "(none)");

const challengeColumns = await rows(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='daily_challenges'`,
);
console.log("daily_challenges columns:", challengeColumns.map((r) => r.column_name).join(", ") || "(table missing)");

const owners = await rows(
  `SELECT tablename, tableowner FROM pg_tables
    WHERE schemaname='public' AND tablename IN ('users','daily_challenges','reviews','user_achievements')
    ORDER BY tablename`,
);
console.log("table owners:", owners.map((r) => `${r.tablename}=${r.tableowner}`).join("  ") || "(none)");

await client.end();
