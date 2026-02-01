import type { LeaderboardEntry, RunId, RunState } from '../game/types.js';

const runs = new Map<RunId, RunState>();
const leaderboard: LeaderboardEntry[] = [];

type AgentRecord = {
  id: string;
  name: string;
  description?: string;
  apiKey: string;
  claimToken: string;
  verificationCode: string;
  status: 'pending_claim' | 'claimed';
  createdAt: string;
  claimedAt?: string;
};

const agentsByKey = new Map<string, AgentRecord>();
const agentsByClaim = new Map<string, AgentRecord>();

export function saveRun(state: RunState) {
  runs.set(state.id, state);
}

export function getRun(id: RunId) {
  return runs.get(id) ?? null;
}

export function recordScore(entry: LeaderboardEntry) {
  leaderboard.push(entry);
}

export function registerAgent(params: { name: string; description?: string }) {
  const rand = () => Math.random().toString(16).slice(2);
  const agent: AgentRecord = {
    id: `a_${rand()}${rand()}`,
    name: params.name,
    description: params.description,
    apiKey: `clawarena_${rand()}${rand()}`,
    claimToken: `clawarena_claim_${rand()}${rand()}`,
    verificationCode: `reef-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    status: 'pending_claim',
    createdAt: new Date().toISOString()
  };

  agentsByKey.set(agent.apiKey, agent);
  agentsByClaim.set(agent.claimToken, agent);

  return agent;
}

export function getAgentByApiKey(apiKey: string) {
  return agentsByKey.get(apiKey) ?? null;
}

export function claimAgent(claimToken: string, verificationCode: string) {
  const agent = agentsByClaim.get(claimToken);
  if (!agent) return null;
  if (agent.verificationCode !== verificationCode) return { error: 'bad_code' as const };
  agent.status = 'claimed';
  agent.claimedAt = new Date().toISOString();
  return { agent };
}

export function listLeaderboard(filter?: { mode?: LeaderboardEntry['mode']; limit?: number }) {
  const mode = filter?.mode;
  const limit = filter?.limit ?? 50;

  return leaderboard
    .filter((e) => !mode || e.mode === mode)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function listRuns() {
  return [...runs.values()].map((r) => ({
    id: r.id,
    status: r.status,
    mode: r.mode,
    turn: r.turn,
    turnsTotal: r.turnsTotal,
    createdAt: r.createdAt,
    name: r.player.name,
    score: r.player.score,
    seed: r.seed
  }));
}

export function getStats() {
  const allRuns = [...runs.values()];
  const totalRunsStarted = allRuns.length;
  const totalRunsFinished = allRuns.filter((r) => r.status === 'finished').length;

  const agentNames = new Set<string>();
  for (const r of allRuns) agentNames.add(r.player.name);
  for (const e of leaderboard) agentNames.add(e.name);

  return {
    totalRunsStarted,
    totalRunsFinished,
    uniqueAgents: agentNames.size
  };
}
