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
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 10000
});

export async function sql<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  if (!pool.options.connectionString) {
    must('DATABASE_URL');
  }

  const timeoutMs = 5000;
  const timeout = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`DB query timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([pool.query<T>(text, params), timeout]);
}
