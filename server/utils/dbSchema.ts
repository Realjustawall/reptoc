import { db } from "../postgres";

/**
 * ✅ FIX B-9: columnCache now has a TTL so that migrations applied via
 * external tools (psql, run-migrations.mjs from another instance) are
 * picked up without requiring a server restart.
 *
 * Previously, the cache was populated once on first access and never
 * invalidated (except via runOptionalSchemaQuery which only fires when
 * the app itself runs a migration). This meant that after a DBA added a
 * column via psql, the app would continue to filter it out until the
 * process was restarted.
 *
 * Now entries expire after 5 minutes, giving a reasonable balance between
 * performance (most reads hit the cache) and correctness (new columns
 * appear within 5 minutes of migration).
 */
const COLUMN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const columnCache = new Map<string, { promise: Promise<Set<string>>, expiresAt: number }>();

export function isSchemaPermissionError(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  return error?.code === "42501" || message.includes("must be owner") || message.includes("permission denied");
}

/**
 * Report a missing-schema condition once per process.
 *
 * On managed PostgreSQL the application role usually does not own the tables,
 * so runtime `ALTER TABLE ... ADD COLUMN` is rejected with 42501
 * ("must be owner of table"). That is expected and harmless — but the previous
 * behaviour logged the same failure on every admin request, burying real
 * errors. One actionable line per condition is enough.
 */
const reportedSchemaGaps = new Set<string>();

export function reportSchemaGapOnce(scope: string, error: any) {
  if (reportedSchemaGaps.has(scope)) return;
  reportedSchemaGaps.add(scope);
  const detail = String(error?.message || error || "unknown");
  if (isSchemaPermissionError(error)) {
    console.warn(
      `[schema] ${scope}: the database role cannot alter this table (${detail}). ` +
      `This is expected on managed PostgreSQL — apply migrations with "npm run db:migrate" as the table owner.`,
    );
    return;
  }
  console.warn(`[schema] ${scope}: ${detail}. Run "npm run db:migrate" to apply pending migrations.`);
}

/**
 * Columns the admin surfaces need. Missing entries mean the deployment is
 * behind on migrations; the API keeps working with the columns that do exist.
 */
export async function missingExpectedColumns(tableName: string, expected: string[], schemaName = "public") {
  try {
    const available = await getTableColumns(tableName, schemaName);
    return expected.filter((column) => !available.has(column));
  } catch {
    return [];
  }
}

function isOptionalSchemaDependencyError(error: any) {
  return ["42703", "42P01", "42P07"].includes(String(error?.code || ""));
}

export async function runOptionalSchemaQuery(sql: string, params?: any[]) {
  try {
    await db.query(sql, params);
    columnCache.clear();
    return true;
  } catch (error) {
    if (isSchemaPermissionError(error) || isOptionalSchemaDependencyError(error)) return false;
    throw error;
  }
}

export async function runOptionalSchemaQueries(statements: string[]) {
  for (const statement of statements) {
    await runOptionalSchemaQuery(statement);
  }
}

export async function getTableColumns(tableName: string, schemaName = "public") {
  const key = `${schemaName}.${tableName}`;
  const now = Date.now();
  const entry = columnCache.get(key);

  // ✅ FIX B-9: Return cached entry only if it exists AND has not expired.
  if (entry && entry.expiresAt > now) {
    return entry.promise;
  }

  // Otherwise, start a fresh query and cache it with a new TTL.
  const promise = db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    [schemaName, tableName]
  ).then((result) => new Set(result.rows.map((row: any) => row.column_name)));

  columnCache.set(key, { promise, expiresAt: now + COLUMN_CACHE_TTL_MS });
  return promise;
}

export async function hasTableColumn(tableName: string, columnName: string, schemaName = "public") {
  const columns = await getTableColumns(tableName, schemaName);
  return columns.has(columnName);
}

export async function filterExistingColumns(tableName: string, columns: string[], schemaName = "public") {
  const available = await getTableColumns(tableName, schemaName);
  return columns.filter((column) => available.has(column));
}

export async function filterPayloadToExistingColumns(tableName: string, payload: Record<string, any>, schemaName = "public") {
  const available = await getTableColumns(tableName, schemaName);
  return Object.fromEntries(Object.entries(payload).filter(([column]) => available.has(column)));
}
