import dotenv from "dotenv";
import pg from "pg";
dotenv.config();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined });
await c.connect();
console.log((await c.query("SELECT version()")).rows[0].version);
await c.end();
