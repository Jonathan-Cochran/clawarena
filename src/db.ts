import pg from 'pg';

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Runtime connection (pooled) — good for Vercel/serverless.
const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) {
  // Don't throw immediately at import time in case some scripts set env later.
  // But most paths will require DB.
}

export const pool = new pg.Pool({
  connectionString: connectionString ?? undefined,
  // In most managed Postgres environments, TLS is required.
  ssl: { rejectUnauthorized: false }
});

export async function sql<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  if (!pool.options.connectionString) {
    // force a clearer error
    must('DATABASE_URL');
  }
  return pool.query<T>(text, params);
}
