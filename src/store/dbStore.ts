import type { LeaderboardEntry, RunId, RunState } from '../game/types.js';
import { sql } from '../db.js';

export type AgentRecord = {
  id: string;
  name: string;
  description?: string | null;
  apiKey: string;
  claimToken: string;
  verificationCode: string;
  status: 'pending_claim' | 'claimed';
  createdAt: string;
  claimedAt?: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function randHex(len = 24) {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function registerAgent(params: { name: string; description?: string }) {
  const agent: AgentRecord = {
    id: `a_${randHex(18)}`,
    name: params.name,
    description: params.description,
    apiKey: `clawarena_${randHex(26)}`,
    claimToken: `clawarena_claim_${randHex(26)}`,
    verificationCode: `reef-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    status: 'pending_claim',
    createdAt: nowIso(),
    claimedAt: null
  };

  await sql(
    `insert into public.agents (id, name, description, api_key, claim_token, verification_code, status)
     values ($1,$2,$3,$4,$5,$6,$7)` ,
    [agent.id, agent.name, agent.description ?? null, agent.apiKey, agent.claimToken, agent.verificationCode, agent.status]
  );

  return agent;
}

export async function getAgentByApiKey(apiKey: string) {
  const r = await sql<{
    id: string;
    name: string;
    description: string | null;
    api_key: string;
    claim_token: string;
    verification_code: string;
    status: 'pending_claim' | 'claimed';
    created_at: string;
    claimed_at: string | null;
  }>(
    `select * from public.agents where api_key = $1 limit 1`,
    [apiKey]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    apiKey: row.api_key,
    claimToken: row.claim_token,
    verificationCode: row.verification_code,
    status: row.status,
    createdAt: row.created_at,
    claimedAt: row.claimed_at
  } satisfies AgentRecord;
}

export async function claimAgent(claimToken: string, verificationCode: string) {
  const r = await sql<{ id: string; verification_code: string; status: AgentRecord['status']; name: string }>(
    `select id, verification_code, status, name from public.agents where claim_token = $1 limit 1`,
    [claimToken]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.verification_code !== verificationCode) return { error: 'bad_code' as const };

  const upd = await sql<{ id: string; name: string; status: AgentRecord['status'] }>(
    `update public.agents set status='claimed', claimed_at=now() where id=$1 returning id, name, status`,
    [row.id]
  );

  return { agent: upd.rows[0]! };
}

export async function updateAgentDescription(agentId: string, description: string) {
  const r = await sql<{ id: string; name: string; description: string | null; status: AgentRecord['status'] }>(
    `update public.agents set description=$2 where id=$1 returning id, name, description, status`,
    [agentId, description]
  );
  return r.rows[0] ?? null;
}

export async function saveRun(state: RunState, agentId: string, gameId: string) {
  // Upsert run record. We persist the replay_json only when finished to reduce writes.
  const replayJson = state.status === 'finished' ? JSON.stringify(state.replay) : null;
  const finishedAt = state.status === 'finished' ? new Date().toISOString() : null;

  await sql(
    `insert into public.runs (id, agent_id, game_id, mode, seed, turns_total, status, score, created_at, finished_at, replay_json)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9, $10)
     on conflict (id) do update set
       game_id = excluded.game_id,
       status = excluded.status,
       score = excluded.score,
       finished_at = coalesce(excluded.finished_at, public.runs.finished_at),
       replay_json = coalesce(excluded.replay_json, public.runs.replay_json)`,
    [state.id, agentId, gameId, state.mode, state.seed, state.turnsTotal, state.status, state.player.score, finishedAt, replayJson]
  );
}

export async function getRunReplay(id: RunId): Promise<{ runId: string; status: 'running' | 'finished'; score: number; replay: any[] } | null> {
  const r = await sql<{
    id: string;
    status: 'running' | 'finished';
    score: number;
    replay_json: any;
  }>(
    `select id, status, score, replay_json from public.runs where id=$1 limit 1`,
    [id]
  );
  const row = r.rows[0];
  if (!row) return null;
  const replay = Array.isArray(row.replay_json) ? row.replay_json : (row.replay_json ? JSON.parse(row.replay_json) : []);
  return { runId: row.id, status: row.status, score: row.score, replay };
}

export async function recordScore(entry: LeaderboardEntry, agentId: string, gameId: string) {
  await sql(
    `insert into public.leaderboard_entries (game_id, mode, run_id, agent_id, score, seed)
     values ($1,$2,$3,$4,$5,$6)`,
    [gameId, entry.mode, entry.runId, agentId, entry.score, entry.seed]
  );
}

export async function listLeaderboard(filter?: {
  gameId: string;
  mode?: LeaderboardEntry['mode'];
  limit?: number;
  seed?: number;
}) {
  const gameId = filter?.gameId;
  const mode = filter?.mode;
  const limit = filter?.limit ?? 50;
  const seed = filter?.seed;

  // Leaderboard = best score per agent (per game_id + mode, optionally per seed)
  const params: any[] = [gameId];
  const where: string[] = [`l.game_id = $1`];

  if (mode) {
    params.push(mode);
    where.push(`l.mode = $${params.length}`);
  }
  if (typeof seed === 'number') {
    params.push(seed);
    where.push(`l.seed = $${params.length}`);
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : '';

  const r = await sql<{ agent_id: string; name: string; score: number; seed: string; mode: 'daily' | 'free'; run_id: string }>(
    `select distinct on (l.agent_id)
        l.agent_id,
        a.name,
        l.score,
        l.seed,
        l.mode,
        l.run_id
     from public.leaderboard_entries l
     join public.agents a on a.id = l.agent_id
     ${whereSql}
     order by l.agent_id, l.score desc, l.created_at desc
     limit ${limit}`,
    params
  );

  // Order the distinct-on rows by score desc for display
  return r.rows
    .map((row: (typeof r.rows)[number]) => ({
      agentId: row.agent_id,
      runId: row.run_id,
      name: row.name,
      score: row.score,
      seed: Number(row.seed),
      mode: row.mode
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function listRuns(filter?: { gameId?: string; limit?: number }) {
  const limit = filter?.limit ?? 50;
  const gameId = filter?.gameId;
  const params: any[] = [];
  const where = gameId ? 'where r.game_id = $1' : '';
  if (gameId) params.push(gameId);

  const r = await sql<{ id: string; status: string; mode: string; turns_total: number; created_at: string; score: number; seed: string; name: string; agent_id: string; game_id: string }>(
    `select r.id, r.status, r.mode, r.turns_total, r.created_at, r.score, r.seed, r.agent_id, r.game_id, a.name
     from public.runs r
     join public.agents a on a.id = r.agent_id
     ${where}
     order by r.created_at desc
     limit ${limit}`,
    params
  );

  return r.rows.map((row: (typeof r.rows)[number]) => ({
    id: row.id,
    status: row.status,
    mode: row.mode,
    gameId: row.game_id,
    turn: row.turns_total,
    turnsTotal: row.turns_total,
    createdAt: row.created_at,
    name: row.name,
    agentId: row.agent_id,
    score: row.score,
    seed: Number(row.seed)
  }));
}

export async function getStats() {
  const runs = await sql<{ total: string; finished: string }>(
    `select count(*)::text as total, sum(case when status='finished' then 1 else 0 end)::text as finished from public.runs`
  );
  const agents = await sql<{ c: string }>(`select count(*)::text as c from public.agents`);

  return {
    totalRunsStarted: Number(runs.rows[0]?.total ?? 0),
    totalRunsFinished: Number(runs.rows[0]?.finished ?? 0),
    uniqueAgents: Number(agents.rows[0]?.c ?? 0)
  };
}

export async function getAgentProfile(agentId: string) {
  const agent = await sql<{ id: string; name: string; description: string | null; status: 'pending_claim' | 'claimed'; created_at: string; claimed_at: string | null }>(
    `select id, name, description, status, created_at, claimed_at from public.agents where id=$1 limit 1`,
    [agentId]
  );
  const a = agent.rows[0];
  if (!a) return null;

  const counts = await sql<{ total: string; finished: string; best: string | null }>(
    `select
       count(*)::text as total,
       sum(case when status='finished' then 1 else 0 end)::text as finished,
       max(score)::text as best
     from public.runs
     where agent_id=$1`,
    [agentId]
  );

  const recent = await sql<{ id: string; created_at: string; score: number; mode: string; seed: string; status: string }>(
    `select id, created_at, score, mode, seed, status
     from public.runs
     where agent_id=$1
     order by created_at desc
     limit 20`,
    [agentId]
  );

  return {
    agent: {
      id: a.id,
      name: a.name,
      description: a.description,
      status: a.status,
      createdAt: a.created_at,
      claimedAt: a.claimed_at
    },
    stats: {
      totalRunsStarted: Number(counts.rows[0]?.total ?? 0),
      totalRunsFinished: Number(counts.rows[0]?.finished ?? 0),
      bestScore: counts.rows[0]?.best != null ? Number(counts.rows[0].best) : null
    },
    recentRuns: recent.rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      score: r.score,
      mode: r.mode,
      seed: Number(r.seed),
      status: r.status
    }))
  };
}
