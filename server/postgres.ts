import dotenv from "dotenv";
import { Pool, PoolClient, QueryResult } from "pg";

dotenv.config();

type DbResult<T = any> = { data: T | null; error: any; count?: number | null };
type FilterOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "ILIKE" | "IS" | "IN";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_CONNECTION_STRING;

const pool = new Pool(
  DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10_000),
        query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 15_000),
        ssl: process.env.PGSSL === "true" || process.env.PGSSLMODE === "require"
          ? { rejectUnauthorized: false }
          : undefined,
      }
    : {
        host: process.env.PGHOST || process.env.POSTGRES_HOST || "localhost",
        port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432),
        database: process.env.PGDATABASE || process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE,
        user: process.env.PGUSER || process.env.POSTGRES_USER,
        password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD,
        connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10_000),
        query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 15_000),
        ssl: process.env.PGSSL === "true" || process.env.PGSSLMODE === "require"
          ? { rejectUnauthorized: false }
          : undefined,
      }
);

function assertIdentifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return value;
}

function quoteIdent(value: string) {
  return `"${assertIdentifier(value)}"`;
}

function normalizeError(error: any) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    code: error.code,
    detail: error.detail,
    hint: error.hint,
    schema: error.schema,
    table: error.table,
    column: error.column,
    constraint: error.constraint,
    routine: error.routine,
  };
}

function primaryKeyFor(table: string, row?: Record<string, any>, explicit?: string) {
  if (explicit) return explicit.split(",").map((x) => x.trim()).filter(Boolean);
  if (table === "settings") return ["setting_key"];
  if (table === "ads_config") return row?.location ? ["location"] : ["id"];
  if (table === "follows" && row?.follower_id && row?.target_type && row?.target_id) return ["follower_id", "target_type", "target_id"];
  if (table === "blocked_users" && row?.blocker_user_id && row?.blocked_user_id) return ["blocker_user_id", "blocked_user_id"];
  if (table === "blocked_users" && row?.username && row?.blocked_username) return ["username", "blocked_username"];
  if (table === "bookmarks" && row?.user_id && row?.novel_id) return ["user_id", "novel_id"];
  if (table === "bookmarks" && row?.username && row?.novel_id) return ["username", "novel_id"];
  if (table === "novel_likes" && row?.novel_id && row?.user_id) return ["novel_id", "user_id"];
  if (table === "forum_thread_votes" && row?.thread_id && row?.user_id) return ["thread_id", "user_id"];
  return ["id"];
}

function splitTopLevel(input: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseSelectColumns(selectSpec: string) {
  const spec = (selectSpec || "*").trim();
  if (spec === "*" || spec.includes("!inner") || /\w+\([^)]*\)/.test(spec)) return "*";
  return splitTopLevel(spec)
    .map((part) => {
      const alias = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
      if (alias) return `${quoteIdent(alias[1])} AS ${quoteIdent(alias[2])}`;
      if (part === "*") return "*";
      return quoteIdent(part);
    })
    .join(", ");
}

function addJsonCasts(row: Record<string, any>) {
  const next: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    next[key] = Array.isArray(value) || (value && typeof value === "object" && !(value instanceof Date))
      ? JSON.stringify(value)
      : value;
  }
  return next;
}

class PostgresQueryBuilder<T = any> implements PromiseLike<DbResult<T>> {
  private operation: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private selectSpec = "*";
  private selectAfterMutation = false;
  private countMode: "exact" | undefined;
  private head = false;
  private payload: any;
  private filters: Array<{ column: string; op: FilterOperator; value: any }> = [];
  private orClauses: string[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private rowLimit?: number;
  private rowOffset = 0;
  private singleRow = false;
  private conflictColumns?: string;

  constructor(private table: string) {
    assertIdentifier(table);
  }

  select(spec = "*", options?: { count?: "exact"; head?: boolean }) {
    this.selectSpec = spec;
    this.countMode = options?.count;
    this.head = !!options?.head;
    if (this.operation !== "select") this.selectAfterMutation = true;
    return this;
  }

  insert(payload: any) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: any) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: any, options?: { onConflict?: string }) {
    this.operation = "upsert";
    this.payload = payload;
    this.conflictColumns = options?.onConflict;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: any) { this.filters.push({ column, op: "=", value }); return this; }
  neq(column: string, value: any) { this.filters.push({ column, op: "!=", value }); return this; }
  gt(column: string, value: any) { this.filters.push({ column, op: ">", value }); return this; }
  gte(column: string, value: any) { this.filters.push({ column, op: ">=", value }); return this; }
  lt(column: string, value: any) { this.filters.push({ column, op: "<", value }); return this; }
  lte(column: string, value: any) { this.filters.push({ column, op: "<=", value }); return this; }
  in(column: string, value: any[]) { this.filters.push({ column, op: "IN", value: value || [] }); return this; }
  is(column: string, value: any) { this.filters.push({ column, op: "IS", value }); return this; }
  ilike(column: string, value: string) { this.filters.push({ column, op: "ILIKE", value }); return this; }
  or(expression: string) { this.orClauses.push(expression); return this; }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number) { this.rowLimit = count; return this; }
  offset(count: number) { this.rowOffset = Math.max(0, Number(count) || 0); return this; }
  single() { this.singleRow = true; this.rowLimit = this.rowLimit || 1; return this; }

  private buildWhere(values: any[]) {
    const clauses: string[] = [];
    for (const filter of this.filters) {
      const col = quoteIdent(filter.column);
      if (filter.op === "IS") {
        clauses.push(`${col} IS ${filter.value === null ? "NULL" : filter.value === true ? "TRUE" : filter.value === false ? "FALSE" : "NOT NULL"}`);
      } else if (filter.op === "IN") {
        values.push(filter.value);
        clauses.push(`${col} = ANY($${values.length})`);
      } else {
        values.push(filter.value);
        clauses.push(`${col} ${filter.op} $${values.length}`);
      }
    }
    for (const expr of this.orClauses) {
      const parsed = this.parseOrExpression(expr, values);
      if (parsed) clauses.push(parsed);
    }
    return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  }

  private parseOrExpression(expr: string, values: any[]) {
    const andGroups = [...expr.matchAll(/and\(([^)]*)\)/g)].map((m) => m[1]);
    if (andGroups.length) {
      const groups = andGroups.map((group) => {
        const parts = splitTopLevel(group).map((part) => this.parseCondition(part, values)).filter(Boolean);
        return parts.length ? `(${parts.join(" AND ")})` : "";
      }).filter(Boolean);
      return groups.length ? `(${groups.join(" OR ")})` : "";
    }
    const parts = splitTopLevel(expr).map((part) => this.parseCondition(part, values)).filter(Boolean);
    return parts.length ? `(${parts.join(" OR ")})` : "";
  }

  private parseCondition(part: string, values: any[]) {
    const match = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(eq|ilike)\.(.*)$/);
    if (!match) return "";
    const [, column, op, value] = match;
    values.push(value);
    return `${quoteIdent(column)} ${op === "ilike" ? "ILIKE" : "="} $${values.length}`;
  }

  private async executeSelect(client?: PoolClient): Promise<DbResult<T>> {
    const values: any[] = [];
    const columns = this.head ? "1" : parseSelectColumns(this.selectSpec);
    const where = this.buildWhere(values);
    const order = this.orders.length
      ? ` ORDER BY ${this.orders.map((o) => `${quoteIdent(o.column)} ${o.ascending ? "ASC" : "DESC"}`).join(", ")}`
      : "";
    const limit = this.rowLimit ? ` LIMIT ${Number(this.rowLimit)}` : "";
    const offset = this.rowOffset ? ` OFFSET ${Number(this.rowOffset)}` : "";
    const sql = `SELECT ${columns} FROM ${quoteIdent(this.table)}${where}${order}${limit}${offset}`;
    const result = await (client || pool).query(sql, values);
    const rows = this.head ? [] : await this.hydrateRows(result.rows);
    const count = this.countMode ? await this.executeCount(where, values, client) : null;
    if (this.singleRow) {
      return { data: (rows[0] || null) as T, error: rows[0] ? null : { code: "PGRST116", message: "No rows found" }, count };
    }
    return { data: rows as T, error: null, count };
  }

  private async executeCount(where: string, values: any[], client?: PoolClient) {
    const result = await (client || pool).query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(this.table)}${where}`, values);
    return Number(result.rows[0]?.count || 0);
  }

  private async hydrateRows(rows: any[]) {
    if (!rows.length) return rows;
    if (this.selectSpec.includes("users!inner") && ["forum_threads", "forum_posts"].includes(this.table)) {
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      if (userIds.length) {
        const users = await pool.query(`SELECT id, username, role, avatar FROM users WHERE id = ANY($1)`, [userIds]);
        const map = new Map(users.rows.map((u) => [u.id, u]));
        rows = rows.map((r) => ({ ...r, users: map.get(r.user_id) || null }));
      }
    }
    if (this.selectSpec.includes("users!inner") && this.table === "support_messages") {
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      if (userIds.length) {
        const users = await pool.query(`SELECT id, username FROM users WHERE id = ANY($1)`, [userIds]);
        const map = new Map(users.rows.map((u) => [u.id, u]));
        rows = rows.map((r) => ({ ...r, users: map.get(r.user_id) || null }));
      }
    }
    if (this.selectSpec.includes("forum_posts(") && this.table === "forum_threads") {
      const ids = rows.map((r) => r.id);
      const posts = await pool.query(`SELECT id, thread_id FROM forum_posts WHERE thread_id = ANY($1)`, [ids]);
      const byThread = new Map<string, any[]>();
      for (const post of posts.rows) {
        byThread.set(post.thread_id, [...(byThread.get(post.thread_id) || []), { id: post.id }]);
      }
      rows = rows.map((r) => ({ ...r, forum_posts: byThread.get(r.id) || [] }));
    }
    if (this.selectSpec.includes("novels(") && this.table === "reviews") {
      const novelIds = [...new Set(rows.map((r) => r.novel_id).filter(Boolean))];
      if (novelIds.length) {
        const novels = await pool.query(`SELECT id, title FROM novels WHERE id = ANY($1)`, [novelIds]);
        const map = new Map(novels.rows.map((n) => [n.id, { title: n.title }]));
        rows = rows.map((r) => ({ ...r, novels: map.get(r.novel_id) || null }));
      }
    }
    return rows;
  }

  private async executeMutation(): Promise<DbResult<T>> {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload || {}];
    if (this.operation === "delete") return this.executeDelete();
    if (!rows.length) return { data: [] as T, error: null };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const returned: any[] = [];
      for (const rawRow of rows) {
        const row = addJsonCasts(rawRow);
        const result = this.operation === "update"
          ? await this.executeUpdateRow(row, client)
          : this.operation === "upsert"
            ? await this.executeUpsertRow(row, client)
            : await this.executeInsertRow(row, client);
        returned.push(...result.rows);
      }
      await client.query("COMMIT");
      const dataRows = this.selectAfterMutation ? returned : null;
      if (this.singleRow) return { data: ((dataRows || [])[0] || null) as T, error: null };
      return { data: (Array.isArray(this.payload) ? dataRows : dataRows?.[0] || null) as T, error: null };
    } catch (error: any) {
      await client.query("ROLLBACK");
      return { data: null, error: normalizeError(error) };
    } finally {
      client.release();
    }
  }

  private async executeInsertRow(row: Record<string, any>, client: PoolClient): Promise<QueryResult> {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    const returning = this.selectAfterMutation ? ` RETURNING ${parseSelectColumns(this.selectSpec)}` : "";
    return client.query(
      `INSERT INTO ${quoteIdent(this.table)} (${columns.map(quoteIdent).join(", ")}) VALUES (${placeholders})${returning}`,
      values
    );
  }

  private async executeUpdateRow(row: Record<string, any>, client: PoolClient): Promise<QueryResult> {
    const values = Object.values(row);
    const sets = Object.keys(row).map((col, index) => `${quoteIdent(col)} = $${index + 1}`).join(", ");
    const where = this.buildWhere(values);
    const returning = this.selectAfterMutation ? ` RETURNING ${parseSelectColumns(this.selectSpec)}` : "";
    return client.query(`UPDATE ${quoteIdent(this.table)} SET ${sets}${where}${returning}`, values);
  }

  private async executeUpsertRow(row: Record<string, any>, client: PoolClient): Promise<QueryResult> {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const conflict = primaryKeyFor(this.table, row, this.conflictColumns);
    const updates = columns
      .filter((col) => !conflict.includes(col))
      .map((col) => `${quoteIdent(col)} = EXCLUDED.${quoteIdent(col)}`)
      .join(", ");
    const returning = this.selectAfterMutation ? ` RETURNING ${parseSelectColumns(this.selectSpec)}` : "";
    return client.query(
      `INSERT INTO ${quoteIdent(this.table)} (${columns.map(quoteIdent).join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")}) ` +
      `ON CONFLICT (${conflict.map(quoteIdent).join(", ")}) DO ${updates ? `UPDATE SET ${updates}` : "NOTHING"}${returning}`,
      values
    );
  }

  private async executeDelete(): Promise<DbResult<T>> {
    const values: any[] = [];
    const where = this.buildWhere(values);
    const returning = this.selectAfterMutation ? ` RETURNING ${parseSelectColumns(this.selectSpec)}` : "";
    const result = await pool.query(`DELETE FROM ${quoteIdent(this.table)}${where}${returning}`, values);
    return { data: (this.selectAfterMutation ? result.rows : null) as T, error: null };
  }

  private async execute(): Promise<DbResult<T>> {
    try {
      if (this.operation === "select") return await this.executeSelect();
      return await this.executeMutation();
    } catch (error: any) {
      return { data: null, error: normalizeError(error) };
    }
  }

  then<TResult1 = DbResult<T>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null) {
    return this.execute().catch(onrejected);
  }
}

async function rpc(name: string, params: Record<string, any> = {}) {
  try {
    if (name === "increment_novel_views") {
      await pool.query(`UPDATE novels SET views_count = COALESCE(views_count, 0) + 1 WHERE id = $1`, [params.row_id]);
      return { data: null, error: null };
    }
    if (name === "increment_chapter_views") {
      await pool.query(`UPDATE chapters SET views_count = COALESCE(views_count, 0) + 1 WHERE id = $1`, [params.row_id]);
      return { data: null, error: null };
    }
    if (name === "increment_thread_votes") {
      await pool.query(`UPDATE forum_threads SET votes = COALESCE(votes, 0) + 1 WHERE id = $1`, [params.p_thread_id]);
      return { data: null, error: null };
    }
    if (name === "increment_views") {
      await pool.query(`UPDATE forum_threads SET views = COALESCE(views, 0) + 1 WHERE id = $1`, [params.row_id]);
      return { data: null, error: null };
    }
    return { data: null, error: { message: `Unsupported RPC: ${name}` } };
  } catch (error) {
    return { data: null, error: normalizeError(error) };
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withTransactionSavepoint<T>(
  client: Pick<PoolClient, "query">,
  savepointName: string,
  fn: () => Promise<T>,
  recover: (error: unknown) => T | Promise<T>,
): Promise<T> {
  const safeName = assertIdentifier(savepointName);
  await client.query(`SAVEPOINT ${safeName}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${safeName}`);
    return result;
  } catch (error) {
    // Catching a PostgreSQL error does not clear the failed transaction state.
    // Roll back only the optional operation so the enclosing transaction can
    // safely continue.
    await client.query(`ROLLBACK TO SAVEPOINT ${safeName}`);
    await client.query(`RELEASE SAVEPOINT ${safeName}`);
    return recover(error);
  }
}

export const db = {
  pool,
  query: (text: string, params?: any[]) => pool.query(text, params),
  withTransaction,
};

export const supabase = {
  from(table: string) {
    return new PostgresQueryBuilder(table);
  },
  rpc,
};
