import crypto from 'node:crypto';
import { mulberry32, pick } from './rng.js';
import type { LobsterAction, ReplayEvent, RunState } from './types.js';

function now() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function dailySeedForDate(d: Date, salt = 0) {
  // YYYY-MM-DD
  const iso = d.toISOString().slice(0, 10);
  let h = 2166136261;
  for (const ch of `${iso}:${salt}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRun(params: {
  seed?: number;
  turnsTotal?: number;
  mode?: RunState['mode'];
  playerName: string;
}): RunState {
  const seed = params.seed ?? Math.floor(Math.random() * 1_000_000);
  const turnsTotal = params.turnsTotal ?? 12;
  const mode = params.mode ?? 'free';

  const runId = newId('r');
  const replay: ReplayEvent[] = [
    { t: now(), kind: 'RUN_CREATED', seed, turnsTotal, mode }
  ];

  const r = mulberry32(seed);
  const marketPrice = 8 + Math.floor(r() * 5); // 8..12
  const weather = pick(r, ['calm', 'breezy', 'storm'] as const);

  const state: RunState = {
    id: runId,
    createdAt: now(),
    seed,
    mode,
    turnsTotal,
    status: 'running',
    turn: 1,
    player: {
      name: params.playerName,
      cash: 100,
      bait: 5,
      fuel: 5,
      ice: 0,
      capacity: 20,
      catch: 0,
      insured: false,
      score: 0
    },
    pendingAction: null,
    public: {
      turn: 1,
      turnsTotal,
      marketPricePerLobster: marketPrice,
      weather
    },
    replay
  };

  state.replay.push({
    t: now(),
    kind: 'TURN_STARTED',
    turn: state.turn,
    marketPrice: state.public.marketPricePerLobster,
    weather: state.public.weather
  });

  return state;
}

export function getLegalActions(_state: RunState): LobsterAction[] {
  return [
    { type: 'FISH_INSHORE' },
    { type: 'FISH_OFFSHORE' },
    { type: 'INSURE' },
    { type: 'UPGRADE', qty: 1 },
    { type: 'BUY', item: 'bait', qty: 1 },
    { type: 'BUY', item: 'fuel', qty: 1 },
    { type: 'BUY', item: 'ice', qty: 1 }
  ];
}

export function submitAction(state: RunState, turn: number, action: LobsterAction): void {
  if (state.status !== 'running') throw new Error('Run not running');
  if (turn !== state.turn) throw new Error('Wrong turn');
  if (state.pendingAction != null) throw new Error('Action already submitted');

  state.pendingAction = action;
  state.replay.push({ t: now(), kind: 'ACTION', turn, action });

  resolveTurn(state);
}

function resolveTurn(state: RunState) {
  const r = mulberry32(state.seed + state.turn); // deterministic per turn
  const notes: string[] = [];

  // Market drift + weather each turn
  const marketDelta = pick(r, [-2, -1, 0, 0, 1, 2] as const);
  state.public.marketPricePerLobster = Math.max(4, state.public.marketPricePerLobster + marketDelta);
  state.public.weather = pick(r, ['calm', 'breezy', 'storm'] as const);

  const p = state.player;
  const action = state.pendingAction!;

  // Insurance resets each turn (must re-buy)
  p.insured = false;

  if (action.type === 'INSURE') {
    const cost = 8;
    if (p.cash >= cost) {
      p.cash -= cost;
      p.insured = true;
      notes.push('Bought insurance.');
    }
  } else if (action.type === 'UPGRADE') {
    const cost = 15 * action.qty;
    if (p.cash >= cost) {
      p.cash -= cost;
      p.capacity += 5 * action.qty;
      notes.push(`Upgraded capacity (+${5 * action.qty}).`);
    }
  } else if (action.type === 'BUY') {
    const unitCost = action.item === 'bait' ? 2 : action.item === 'fuel' ? 3 : 1;
    const cost = unitCost * action.qty;
    if (p.cash >= cost) {
      p.cash -= cost;
      (p as any)[action.item] += action.qty;
      notes.push(`Bought ${action.qty} ${action.item}.`);
    }
  } else if (action.type === 'FISH_INSHORE' || action.type === 'FISH_OFFSHORE') {
    const fuelCost = action.type === 'FISH_OFFSHORE' ? 2 : 1;
    const baitCost = action.type === 'FISH_OFFSHORE' ? 2 : 1;

    if (p.fuel < fuelCost || p.bait < baitCost) {
      notes.push("Couldn't fish (insufficient bait/fuel).");
    } else {
      p.fuel -= fuelCost;
      p.bait -= baitCost;

      const base = action.type === 'FISH_OFFSHORE' ? 10 : 6;
      const variance = action.type === 'FISH_OFFSHORE' ? 8 : 4;
      let caught = base + Math.floor(r() * variance);

      // Weather hurts offshore more
      if (state.public.weather === 'storm') {
        const loss = action.type === 'FISH_OFFSHORE' ? 8 : 3;
        caught = Math.max(0, caught - loss);
        notes.push('Storm reduced the catch.');
      }

      // Spoilage if no ice and catch already stored
      const spoilChance = p.ice > 0 ? 0 : 0.15;
      if (r() < spoilChance && p.catch > 0) {
        const spoiled = Math.min(p.catch, 5);
        p.catch -= spoiled;
        notes.push(`Lost ${spoiled} lobster to spoilage (no ice).`);
      }

      // Cap at capacity
      const room = Math.max(0, p.capacity - p.catch);
      const stored = Math.min(room, caught);
      p.catch += stored;
      if (stored < caught) notes.push(`Hit capacity; tossed ${caught - stored}.`);

      notes.push(`Fished ${action.type === 'FISH_OFFSHORE' ? 'offshore' : 'inshore'}: +${stored} lobster stored.`);
    }
  }

  // Auto-sell at end of turn
  if (p.catch > 0) {
    const revenue = p.catch * state.public.marketPricePerLobster;
    p.cash += revenue;
    p.score += revenue;
    notes.push(`Sold ${p.catch} lobster @ $${state.public.marketPricePerLobster} = $${revenue}.`);
    p.catch = 0;
  }

  state.pendingAction = null;

  state.replay.push({ t: now(), kind: 'TURN_RESOLVED', turn: state.turn, notes, score: p.score });

  if (state.turn >= state.turnsTotal) {
    state.status = 'finished';
    state.replay.push({ t: now(), kind: 'RUN_FINISHED', score: p.score });
    return;
  }

  state.turn += 1;
  state.public.turn = state.turn;
  state.replay.push({
    t: now(),
    kind: 'TURN_STARTED',
    turn: state.turn,
    marketPrice: state.public.marketPricePerLobster,
    weather: state.public.weather
  });
}
