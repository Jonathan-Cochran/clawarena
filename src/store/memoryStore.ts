import type { LeaderboardEntry, RunId, RunState } from '../game/types';

const runs = new Map<RunId, RunState>();
const leaderboard: LeaderboardEntry[] = [];

export function saveRun(state: RunState) {
  runs.set(state.id, state);
}

export function getRun(id: RunId) {
  return runs.get(id) ?? null;
}

export function recordScore(entry: LeaderboardEntry) {
  leaderboard.push(entry);
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
