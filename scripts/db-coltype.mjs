import dotenv from "dotenv";
import pg from "pg";
dotenv.config();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined });
await c.connect();
const { rows } = await c.query(`
  SELECT table_name, column_name, data_type
    FROM information_schema.columns
   WHERE table_schema='public'
     AND ((table_name='users' AND column_name='id') OR (table_name='ai_settings'))
   ORDER BY table_name, ordinal_position`);
for (const r of rows) console.log(`${r.table_name}.${r.column_name}: ${r.data_type}`);
await c.end();
