import type { MatchId, MatchState } from '../game/types.js';

const matches = new Map<MatchId, MatchState>();

export function saveMatch(state: MatchState) {
  matches.set(state.id, state);
}

export function getMatch(id: MatchId) {
  return matches.get(id) ?? null;
}

export function listMatches() {
  return [...matches.values()].map((m) => ({
    id: m.id,
    status: m.status,
    turn: m.turn,
    turnsTotal: m.turnsTotal,
    players: Object.keys(m.players).length,
    maxPlayers: m.maxPlayers,
    createdAt: m.createdAt
  }));
}
