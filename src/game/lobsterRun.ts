import crypto from 'node:crypto';
import { mulberry32, pick } from './rng.js';
import type { LobsterAction, MatchState, PlayerId, PlayerState, ReplayEvent } from './types.js';

function now() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function createMatch(params: { seed?: number; turnsTotal?: number; maxPlayers?: number }): MatchState {
  const seed = params.seed ?? Math.floor(Math.random() * 1_000_000);
  const turnsTotal = params.turnsTotal ?? 10;
  const maxPlayers = params.maxPlayers ?? 4;

  const matchId = newId('m');
  const replay: ReplayEvent[] = [
    { t: now(), kind: 'MATCH_CREATED', seed, turnsTotal, maxPlayers }
  ];

  const r = mulberry32(seed);
  const marketPrice = 8 + Math.floor(r() * 5); // 8..12
  const weather = pick(r, ['calm', 'breezy', 'storm'] as const);

  const state: MatchState = {
    id: matchId,
    createdAt: now(),
    seed,
    turnsTotal,
    maxPlayers,
    status: 'lobby',
    turn: 1,
    players: {},
    pendingActions: {},
    public: {
      turn: 1,
      turnsTotal,
      marketPricePerLobster: marketPrice,
      weather,
      leaderboard: []
    },
    replay
  };

  return state;
}

export function joinMatch(state: MatchState, agentName: string): PlayerId {
  if (state.status !== 'lobby') throw new Error('Match is not joinable');
  const count = Object.keys(state.players).length;
  if (count >= state.maxPlayers) throw new Error('Match is full');

  const playerId = newId('p');
  const player: PlayerState = {
    id: playerId,
    name: agentName,
    cash: 100,
    bait: 5,
    fuel: 5,
    ice: 0,
    capacity: 20,
    catch: 0,
    insured: false,
    score: 0
  };

  state.players[playerId] = player;
  state.pendingActions[playerId] = null;
  state.replay.push({ t: now(), kind: 'PLAYER_JOINED', playerId, name: agentName });

  // Auto-start when full
  if (Object.keys(state.players).length >= state.maxPlayers) {
    state.status = 'running';
    state.replay.push({
      t: now(),
      kind: 'TURN_STARTED',
      turn: state.turn,
      marketPrice: state.public.marketPricePerLobster,
      weather: state.public.weather
    });
  }

  refreshLeaderboard(state);
  return playerId;
}

export function getLegalActions(state: MatchState, playerId: PlayerId): LobsterAction[] {
  const p = state.players[playerId];
  if (!p) return [];

  const actions: LobsterAction[] = [
    { type: 'FISH_INSHORE' },
    { type: 'FISH_OFFSHORE' },
    { type: 'INSURE' },
    { type: 'UPGRADE', qty: 1 },
    { type: 'BUY', item: 'bait', qty: 1 },
    { type: 'BUY', item: 'fuel', qty: 1 },
    { type: 'BUY', item: 'ice', qty: 1 }
  ];

  return actions;
}

export function submitAction(state: MatchState, playerId: PlayerId, turn: number, action: LobsterAction): void {
  if (state.status !== 'running') throw new Error('Match not running');
  if (turn !== state.turn) throw new Error('Wrong turn');
  if (!state.players[playerId]) throw new Error('Unknown player');
  if (state.pendingActions[playerId] != null) throw new Error('Action already submitted');

  state.pendingActions[playerId] = action;
  state.replay.push({ t: now(), kind: 'ACTION', turn, playerId, action });

  // If all actions submitted, resolve and advance
  const allIn = Object.values(state.pendingActions).every((a) => a != null);
  if (allIn) {
    resolveTurn(state);
  }
}

function resolveTurn(state: MatchState) {
  const r = mulberry32(state.seed + state.turn); // deterministic per turn
  const notes: string[] = [];

  // Market drift + weather each turn
  const marketDelta = pick(r, [-2, -1, 0, 0, 1, 2] as const);
  state.public.marketPricePerLobster = Math.max(4, state.public.marketPricePerLobster + marketDelta);
  state.public.weather = pick(r, ['calm', 'breezy', 'storm'] as const);

  for (const [pid, act] of Object.entries(state.pendingActions)) {
    const p = state.players[pid]!;
    const action = act!;

    // Clear insurance each turn (must re-buy)
    p.insured = false;

    if (action.type === 'INSURE') {
      const cost = 8;
      if (p.cash >= cost) {
        p.cash -= cost;
        p.insured = true;
      }
      continue;
    }

    if (action.type === 'UPGRADE') {
      const cost = 15 * action.qty;
      if (p.cash >= cost) {
        p.cash -= cost;
        p.capacity += 5 * action.qty;
      }
      continue;
    }

    if (action.type === 'BUY') {
      const unitCost = action.item === 'bait' ? 2 : action.item === 'fuel' ? 3 : 1;
      const cost = unitCost * action.qty;
      if (p.cash >= cost) {
        p.cash -= cost;
        p[action.item] += action.qty;
      }
      continue;
    }

    if (action.type === 'FISH_INSHORE' || action.type === 'FISH_OFFSHORE') {
      const fuelCost = action.type === 'FISH_OFFSHORE' ? 2 : 1;
      const baitCost = action.type === 'FISH_OFFSHORE' ? 2 : 1;

      if (p.fuel < fuelCost || p.bait < baitCost) {
        notes.push(`${p.name} couldn't fish (insufficient bait/fuel).`);
        continue;
      }

      p.fuel -= fuelCost;
      p.bait -= baitCost;

      const base = action.type === 'FISH_OFFSHORE' ? 10 : 6;
      const variance = action.type === 'FISH_OFFSHORE' ? 8 : 4;
      let caught = base + Math.floor(r() * variance);

      // Weather hurts offshore more
      if (state.public.weather === 'storm') {
        const loss = action.type === 'FISH_OFFSHORE' ? 8 : 3;
        caught = Math.max(0, caught - loss);
        notes.push(`Storm reduced ${p.name}'s catch.`);
      }

      // Spoilage if no ice and catch already stored
      const spoilChance = p.ice > 0 ? 0 : 0.15;
      if (r() < spoilChance && p.catch > 0) {
        const spoiled = Math.min(p.catch, 5);
        p.catch -= spoiled;
        notes.push(`${p.name} lost ${spoiled} lobster to spoilage (no ice).`);
      }

      // Cap at capacity
      const room = Math.max(0, p.capacity - p.catch);
      const stored = Math.min(room, caught);
      p.catch += stored;
      if (stored < caught) notes.push(`${p.name} hit capacity and had to toss ${caught - stored}.`);

      continue;
    }
  }

  // Auto-sell at end of turn
  for (const p of Object.values(state.players)) {
    if (p.catch <= 0) continue;
    const revenue = p.catch * state.public.marketPricePerLobster;
    p.cash += revenue;
    p.score += revenue;
    p.catch = 0;
  }

  // Reset pending actions
  for (const pid of Object.keys(state.pendingActions)) state.pendingActions[pid] = null;

  state.replay.push({ t: now(), kind: 'TURN_RESOLVED', turn: state.turn, notes });

  // Advance or finish
  if (state.turn >= state.turnsTotal) {
    state.status = 'finished';
    refreshLeaderboard(state);
    state.replay.push({ t: now(), kind: 'MATCH_FINISHED', leaderboard: state.public.leaderboard });
    return;
  }

  state.turn += 1;
  refreshLeaderboard(state);
  state.replay.push({
    t: now(),
    kind: 'TURN_STARTED',
    turn: state.turn,
    marketPrice: state.public.marketPricePerLobster,
    weather: state.public.weather
  });
}

function refreshLeaderboard(state: MatchState) {
  state.public.turn = state.turn;
  state.public.leaderboard = Object.values(state.players)
    .map((p) => ({ playerId: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}
