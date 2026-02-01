import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL_NON_POOLING ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing DATABASE_URL_NON_POOLING (or POSTGRES_URL_NON_POOLING / DATABASE_URL)');
  process.exit(1);
}

async function main() {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const dir = path.join(process.cwd(), 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    process.stdout.write(`Applying ${f}... `);
    await client.query(sql);
    process.stdout.write('ok\n');
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
