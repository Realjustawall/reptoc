import dotenv from "dotenv";
import pg from "pg";
dotenv.config();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined });
await c.connect();
const { rows } = await c.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size, current_database() AS db`);
console.log(`database ${rows[0].db}: ${rows[0].size}`);
const counts = await c.query(`
  SELECT 'users' t, count(*)::int c FROM users
  UNION ALL SELECT 'novels', count(*)::int FROM novels
  UNION ALL SELECT 'chapters', count(*)::int FROM chapters
  UNION ALL SELECT 'bookmarks', count(*)::int FROM bookmarks
  UNION ALL SELECT 'reviews', count(*)::int FROM reviews
  ORDER BY t`);
console.log(counts.rows.map(r => `${r.t}=${r.c}`).join("  "));
await c.end();
