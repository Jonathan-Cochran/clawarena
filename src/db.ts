import pg from 'pg';

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Runtime connection.
// NOTE: Supabase pooler URLs can fail TLS verification in some serverless environments.
// Prefer NON_POOLING when available; it is stable for our low-traffic v1.
const connectionString =
  process.env.DATABASE_URL_NON_POOLING ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL;

function poolConfigFromUrl(cs?: string) {
  if (!cs) return {};
  const u = new URL(cs);
  const port = u.port ? Number(u.port) : 5432;
  const cfg: pg.PoolConfig = {
    host: u.hostname,
    port,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
    // In most managed Postgres environments, TLS is required.
    // Force node to not validate chain (Supabase pooler sometimes trips this in serverless).
    ssl: { rejectUnauthorized: false }
  };
  return cfg;
}

function intEnv(name: string, fallback: number) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Serverless note:
// Vercel can spin up many concurrent lambdas; if each lambda opens a 5-connection pool
// against a pooled/Supavisor "session mode" endpoint, you'll hit pool_size and get:
//   MaxClientsInSessionMode: max clients reached
// Default to 1 connection per lambda unless explicitly overridden.
const POOL_MAX = intEnv('DB_POOL_MAX', 1);

export const pool = new pg.Pool({
  ...poolConfigFromUrl(connectionString ?? undefined),
  max: POOL_MAX,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 10000
});

export async function sql<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  if (!connectionString) {
    must('DATABASE_URL_NON_POOLING or POSTGRES_URL_NON_POOLING or DATABASE_URL or POSTGRES_URL');
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
