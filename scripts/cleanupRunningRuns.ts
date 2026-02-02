import { sql } from '../src/db.js';

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const olderMinutes = Number(arg('--older-minutes') ?? '60');
  if (!Number.isFinite(olderMinutes) || olderMinutes <= 0) {
    throw new Error('invalid --older-minutes');
  }

  const dryRun = (arg('--dry-run') ?? 'false') === 'true' || process.argv.includes('--dry-run');

  const rows = await sql<{
    id: string;
    created_at: string;
    agent_id: string;
    mode: string;
    turns_total: number;
    score: number;
  }>(
    `select id, created_at::text, agent_id, mode, turns_total, score
     from public.runs
     where status='running'
       and created_at < now() - ($1 || ' minutes')::interval
     order by created_at asc
     limit 500`,
    [String(olderMinutes)]
  );

  console.log(`[cleanup] found ${rows.rows.length} running runs older than ${olderMinutes} minutes`);
  for (const r of rows.rows.slice(0, 20)) {
    console.log(`- ${r.id} agent=${r.agent_id} mode=${r.mode} turns=${r.turns_total} score=${r.score} created=${r.created_at}`);
  }
  if (rows.rows.length > 20) console.log(`... (${rows.rows.length - 20} more)`);

  if (dryRun) {
    console.log('[cleanup] dry-run: not deleting');
    return;
  }

  const ids = rows.rows.map(r => r.id);
  if (!ids.length) return;

  // Delete (safe: leaderboard entries reference runs and will cascade; running runs should not have leaderboard entries).
  await sql(`delete from public.runs where id = any($1::text[])`, [ids]);
  console.log(`[cleanup] deleted ${ids.length} runs`);
}

main().catch((e) => {
  console.error('[cleanup] error', e);
  process.exit(1);
});
