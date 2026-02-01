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

export async function saveRun(state: RunState, agentId: string) {
  // Upsert run record. We persist the replay_json only when finished to reduce writes.
  const replayJson = state.status === 'finished' ? JSON.stringify(state.replay) : null;
  const finishedAt = state.status === 'finished' ? new Date().toISOString() : null;

  await sql(
    `insert into public.runs (id, agent_id, mode, seed, turns_total, status, score, created_at, finished_at, replay_json)
     values ($1,$2,$3,$4,$5,$6,$7, now(), $8, $9)
     on conflict (id) do update set
       status = excluded.status,
       score = excluded.score,
       finished_at = coalesce(excluded.finished_at, public.runs.finished_at),
       replay_json = coalesce(excluded.replay_json, public.runs.replay_json)`,
    [state.id, agentId, state.mode, state.seed, state.turnsTotal, state.status, state.player.score, finishedAt, replayJson]
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

export async function recordScore(entry: LeaderboardEntry, agentId: string) {
  await sql(
    `insert into public.leaderboard_entries (mode, run_id, agent_id, score, seed)
     values ($1,$2,$3,$4,$5)`,
    [entry.mode, entry.runId, agentId, entry.score, entry.seed]
  );
}

export async function listLeaderboard(filter?: { mode?: LeaderboardEntry['mode']; limit?: number }) {
  const mode = filter?.mode;
  const limit = filter?.limit ?? 50;

  const r = await sql<{ run_id: string; score: number; seed: string; created_at: string; name: string; mode: 'daily' | 'free' }>(
    `select l.run_id, l.score, l.seed, l.created_at, l.mode, a.name
     from public.leaderboard_entries l
     join public.agents a on a.id = l.agent_id
     ${mode ? 'where l.mode = $1' : ''}
     order by l.score desc
     limit ${limit}`,
    mode ? [mode] : []
  );

  return r.rows.map((row: (typeof r.rows)[number]) => ({
    runId: row.run_id,
    name: row.name,
    score: row.score,
    seed: Number(row.seed),
    mode: row.mode,
    createdAt: row.created_at
  }));
}

export async function listRuns(limit = 50) {
  const r = await sql<{ id: string; status: string; mode: string; turns_total: number; created_at: string; score: number; seed: string; name: string }>(
    `select r.id, r.status, r.mode, r.turns_total, r.created_at, r.score, r.seed, a.name
     from public.runs r
     join public.agents a on a.id = r.agent_id
     order by r.created_at desc
     limit ${limit}`
  );

  return r.rows.map((row: (typeof r.rows)[number]) => ({
    id: row.id,
    status: row.status,
    mode: row.mode,
    turn: row.turns_total,
    turnsTotal: row.turns_total,
    createdAt: row.created_at,
    name: row.name,
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
