import crypto from 'node:crypto';
import { mulberry32 } from './rng.js';

export type GlacierAction =
  | { type: 'RIDGE' }
  | { type: 'ICEFALL' }
  | { type: 'SCAVENGE' }
  | { type: 'CAMP' };

export type GlacierPublic = {
  turn: number;
  turnsTotal: number;
  summitAltitude: number;
  weather: 'clear' | 'wind' | 'whiteout';
  hazard: 'stable' | 'crevasse' | 'serac';
  forecast: string;
};

export type GlacierPlayer = {
  name: string;
  altitude: number;
  food: number;
  warmth: number;
  stamina: number;
  rope: number;
  score: number;
  turnsUsed: number;
  turnsRemaining: number;
  result: 'running' | 'summit' | 'weathered-out' | 'exhausted';
};

export type GlacierRun = {
  id: string;
  createdAt: string;
  seed: number;
  mode: 'daily' | 'free';
  turnsTotal: number;
  status: 'running' | 'finished';
  turn: number;
  player: GlacierPlayer;
  pendingAction: GlacierAction | null;
  public: GlacierPublic;
  replay: any[];
};

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function describeForecast(weather: GlacierPublic['weather'], hazard: GlacierPublic['hazard']) {
  if (weather === 'whiteout' && hazard === 'crevasse') return 'Whiteout over a broken crevasse field.';
  if (weather === 'whiteout' && hazard === 'serac') return 'Whiteout with unstable seracs above the route.';
  if (weather === 'wind' && hazard === 'crevasse') return 'Crosswinds are sweeping the crevasse ladders.';
  if (weather === 'wind' && hazard === 'serac') return 'Hard wind is rattling the serac wall.';
  if (weather === 'clear' && hazard === 'stable') return 'Clear light and firm ice.';
  if (hazard === 'crevasse') return 'The glacier is splitting into narrow bridges.';
  if (hazard === 'serac') return 'The route passes under cracking blue towers.';
  return 'A cold, steady push up blue ice.';
}

function nextConditions(seed: number, turn: number) {
  const rng = mulberry32((seed + turn * 7_919) >>> 0);
  const weatherRoll = rng();
  const hazardRoll = rng();

  const weather: GlacierPublic['weather'] =
    weatherRoll < 0.42 ? 'clear' : weatherRoll < 0.76 ? 'wind' : 'whiteout';
  const hazard: GlacierPublic['hazard'] =
    hazardRoll < 0.42 ? 'stable' : hazardRoll < 0.74 ? 'crevasse' : 'serac';

  return {
    weather,
    hazard,
    forecast: describeForecast(weather, hazard)
  };
}

export function createGlacierRun(params: { seed: number; turnsTotal: number; mode: 'daily' | 'free'; playerName: string }): GlacierRun {
  const createdAt = nowIso();
  const id = newId('r');
  const summitAltitude = 90;
  const first = nextConditions(params.seed, 1);

  const run: GlacierRun = {
    id,
    createdAt,
    seed: params.seed >>> 0,
    mode: params.mode,
    turnsTotal: params.turnsTotal,
    status: 'running',
    turn: 1,
    pendingAction: null,
    public: {
      turn: 1,
      turnsTotal: params.turnsTotal,
      summitAltitude,
      weather: first.weather,
      hazard: first.hazard,
      forecast: first.forecast
    },
    player: {
      name: params.playerName,
      altitude: 0,
      food: 9,
      warmth: 8,
      stamina: 8,
      rope: 4,
      score: 0,
      turnsUsed: 0,
      turnsRemaining: params.turnsTotal,
      result: 'running'
    },
    replay: []
  };

  run.replay.push({
    t: createdAt,
    kind: 'GLACIER_RUN_CREATED',
    game: 'glacier-run',
    seed: run.seed,
    turnsTotal: run.turnsTotal,
    mode: run.mode,
    playerName: params.playerName,
    summitAltitude
  });
  run.replay.push({
    t: createdAt,
    kind: 'GLACIER_TURN_STARTED',
    turn: 1,
    weather: run.public.weather,
    hazard: run.public.hazard,
    forecast: run.public.forecast
  });

  return run;
}

export function getLegalGlacierActions(_run: GlacierRun): GlacierAction[] {
  return [{ type: 'RIDGE' }, { type: 'ICEFALL' }, { type: 'SCAVENGE' }, { type: 'CAMP' }];
}

export function submitGlacierAction(run: GlacierRun, turn: number, action: GlacierAction) {
  if (run.status !== 'running') throw new Error('run_finished');
  if (turn !== run.turn) throw new Error('bad_turn');
  if (run.pendingAction) throw new Error('action_already_submitted');

  run.pendingAction = action;
  run.replay.push({ t: nowIso(), kind: 'GLACIER_ACTION', turn, action });

  resolveTurn(run);
}

function resolveTurn(run: GlacierRun) {
  const rng = mulberry32((run.seed + run.turn * 10_003) >>> 0);
  const notes: string[] = [];
  const action = run.pendingAction!;
  const player = run.player;
  const { weather, hazard, summitAltitude } = run.public;

  player.turnsUsed += 1;
  player.turnsRemaining = Math.max(0, run.turnsTotal - player.turnsUsed);

  if (player.food > 0) {
    player.food -= 1;
    notes.push('Spent one ration keeping the climb moving.');
  } else {
    player.stamina -= 1;
    player.warmth -= 1;
    notes.push('No food left. The cold hit harder.');
  }

  let altitudeGain = 0;

  if (action.type === 'RIDGE') {
    altitudeGain = 10 + Math.floor(rng() * 5);
    player.stamina -= 1;

    if (hazard === 'stable') altitudeGain += 2;
    if (hazard === 'crevasse') {
      if (player.rope > 0) {
        player.rope -= 1;
        notes.push('Used a rope on a crevasse crossing.');
      } else {
        altitudeGain -= 5;
        player.stamina -= 1;
        notes.push('Crevasse crossing without rope cost precious time.');
      }
    }
    if (hazard === 'serac') {
      altitudeGain -= 2;
      notes.push('Falling ice forced a slower traverse.');
    }

    if (weather === 'wind') {
      altitudeGain -= 2;
      player.warmth -= 1;
      notes.push('Crosswind stripped heat off the ridge.');
    } else if (weather === 'whiteout') {
      altitudeGain -= 5;
      player.warmth -= 2;
      notes.push('Whiteout markers vanished and progress slowed.');
    }
  } else if (action.type === 'ICEFALL') {
    altitudeGain = 18 + Math.floor(rng() * 7);
    player.stamina -= 2;

    if (hazard !== 'stable') {
      if (player.rope > 0) {
        player.rope -= 1;
        notes.push('Burned a rope length protecting the icefall.');
      } else {
        altitudeGain -= 5;
        player.stamina -= 1;
        player.warmth -= 1;
        notes.push('Pushed the icefall unprotected and paid for it.');
      }
    }

    if (hazard === 'serac') {
      altitudeGain -= 3;
      notes.push('A serac collapse forced a detour.');
    }

    if (weather === 'wind') {
      altitudeGain -= 2;
      player.warmth -= 1;
      notes.push('Spindrift cut visibility in the icefall.');
    } else if (weather === 'whiteout') {
      altitudeGain -= 5;
      player.warmth -= 2;
      notes.push('Whiteout turned the icefall into a blind grind.');
    }
  } else if (action.type === 'SCAVENGE') {
    altitudeGain = 1 + Math.floor(rng() * 4);
    const foodFound = 1 + Math.floor(rng() * 2);
    player.food = clamp(player.food + foodFound, 0, 12);
    notes.push(`Scavenged ${foodFound} ration${foodFound === 1 ? '' : 's'} from an old cache.`);

    if (hazard === 'crevasse' && rng() < 0.5) {
      player.rope = clamp(player.rope + 1, 0, 6);
      notes.push('Recovered an abandoned rope line.');
    }

    if (weather === 'whiteout') {
      player.warmth -= 1;
      notes.push('Digging through drift cost warmth.');
    }
  } else if (action.type === 'CAMP') {
    player.stamina = clamp(player.stamina + 3, 0, 9);
    player.warmth = clamp(player.warmth + 3, 0, 9);
    notes.push('Camped early to recover heat and legs.');

    if (weather === 'whiteout') {
      player.warmth = clamp(player.warmth - 1, 0, 9);
      notes.push('The storm bled some of that warmth back out.');
    }
  }

  altitudeGain = Math.max(0, altitudeGain);
  player.altitude += altitudeGain;
  if (altitudeGain > 0) notes.push(`Climbed ${altitudeGain} altitude.`);

  if (player.food === 0 && action.type !== 'SCAVENGE') {
    notes.push('Food stores are empty after this turn.');
  }

  player.score = player.altitude;
  run.pendingAction = null;

  if (player.altitude >= summitAltitude) {
    run.status = 'finished';
    player.result = 'summit';
    player.score = summitAltitude + player.turnsRemaining * 10 + player.warmth + player.stamina + player.rope * 2;
    notes.push(`Reached the summit with ${player.turnsRemaining} turns left.`);
  } else if (player.stamina <= 0 || player.warmth <= 0) {
    run.status = 'finished';
    player.result = 'exhausted';
    player.score = player.altitude;
    notes.push('The team had to turn back exhausted.');
  } else if (player.turnsUsed >= run.turnsTotal) {
    run.status = 'finished';
    player.result = 'weathered-out';
    player.score = player.altitude;
    notes.push('The weather window closed before the summit.');
  }

  run.replay.push({
    t: nowIso(),
    kind: 'GLACIER_TURN_RESOLVED',
    turn: run.turn,
    notes,
    score: player.score,
    snapshot: {
      altitude: player.altitude,
      food: player.food,
      warmth: player.warmth,
      stamina: player.stamina,
      rope: player.rope,
      turnsUsed: player.turnsUsed,
      turnsRemaining: player.turnsRemaining,
      weather,
      hazard,
      result: player.result
    }
  });

  if (run.status === 'finished') {
    run.replay.push({ t: nowIso(), kind: 'GLACIER_RUN_FINISHED', score: player.score, result: player.result });
    return;
  }

  const nextTurn = run.turn + 1;
  const next = nextConditions(run.seed, nextTurn);
  run.turn = nextTurn;
  run.public.turn = nextTurn;
  run.public.weather = next.weather;
  run.public.hazard = next.hazard;
  run.public.forecast = next.forecast;

  run.replay.push({
    t: nowIso(),
    kind: 'GLACIER_TURN_STARTED',
    turn: run.turn,
    weather: run.public.weather,
    hazard: run.public.hazard,
    forecast: run.public.forecast
  });
}
