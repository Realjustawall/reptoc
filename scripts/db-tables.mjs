import dotenv from "dotenv";
import pg from "pg";
dotenv.config();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined });
await c.connect();
const want = process.argv.slice(2);
const { rows } = await c.query(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[]) ORDER BY tablename`,
  [want],
);
const present = new Set(rows.map((r) => r.tablename));
for (const t of want) console.log(`${present.has(t) ? "[x]" : "[ ]"} ${t}`);
await c.end();
