import { mulberry32 } from './rng.js';

export type MazeAction = { type: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'WAIT' };

export type MazePublic = {
  turn: number;
  turnsTotal: number;
  width: number;
  height: number;
  // Grid encoded as array of strings using: # wall, . floor
  grid: string[];
  start: { x: number; y: number };
  exit: { x: number; y: number };
};

export type MazePlayer = {
  name: string;
  x: number;
  y: number;
  score: number; // turns remaining (higher is better)
  turnsUsed: number;
  turnsRemaining: number;
  finished: boolean;
  result: 'running' | 'escaped' | 'timeout';
};

export type MazeRun = {
  id: string;
  createdAt: string;
  seed: number;
  mode: 'daily' | 'free';
  turnsTotal: number;
  status: 'running' | 'finished';
  turn: number;
  player: MazePlayer;
  pendingAction: MazeAction | null;
  public: MazePublic;
  replay: any[];
};

function nowIso() {
  return new Date().toISOString();
}

function randHex(n: number) {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, n * 2);
}

export function createMazeRun(params: { seed: number; turnsTotal: number; mode: 'daily' | 'free'; playerName: string }): MazeRun {
  const rng = mulberry32(params.seed >>> 0);

  // V1: fixed-ish maze size; can tune later.
  const width = 21;
  const height = 21;

  const grid = generateMaze({ width, height, rng });
  const start = { x: 1, y: 1 };
  const exit = { x: width - 2, y: height - 2 };

  // Ensure start/exit open.
  grid[start.y] = replaceAt(grid[start.y]!, start.x, '.');
  grid[exit.y] = replaceAt(grid[exit.y]!, exit.x, '.');

  const id = `r_${randHex(6)}`;
  const createdAt = nowIso();

  const run: MazeRun = {
    id,
    createdAt,
    seed: params.seed,
    mode: params.mode,
    turnsTotal: params.turnsTotal,
    status: 'running',
    turn: 1,
    pendingAction: null,
    public: {
      turn: 1,
      turnsTotal: params.turnsTotal,
      width,
      height,
      grid,
      start,
      exit
    },
    player: {
      name: params.playerName,
      x: start.x,
      y: start.y,
      score: 0,
      turnsUsed: 0,
      turnsRemaining: params.turnsTotal,
      finished: false,
      result: 'running'
    },
    replay: []
  };

  run.replay.push({ t: createdAt, kind: 'MAZE_RUN_CREATED', game: 'maze-runner', seed: run.seed, turnsTotal: run.turnsTotal, mode: run.mode, playerName: params.playerName, width, height, grid, start, exit });
  run.replay.push({ t: createdAt, kind: 'MAZE_TURN_STARTED', turn: 1, x: run.player.x, y: run.player.y });

  return run;
}

export function getLegalMazeActions(_run: MazeRun): MazeAction[] {
  return [{ type: 'UP' }, { type: 'DOWN' }, { type: 'LEFT' }, { type: 'RIGHT' }, { type: 'WAIT' }];
}

export function submitMazeAction(run: MazeRun, turn: number, action: MazeAction) {
  if (run.status !== 'running') throw new Error('run_finished');
  if (turn !== run.turn) throw new Error('bad_turn');

  run.pendingAction = action;
  run.replay.push({ t: nowIso(), kind: 'MAZE_ACTION', turn, action });

  // Apply action
  const { x, y } = run.player;
  let nx = x;
  let ny = y;
  if (action.type === 'UP') ny--;
  else if (action.type === 'DOWN') ny++;
  else if (action.type === 'LEFT') nx--;
  else if (action.type === 'RIGHT') nx++;

  const notes: string[] = [];

  if (action.type !== 'WAIT') {
    if (isWall(run.public.grid, nx, ny)) {
      notes.push('Bumped into a wall.');
      nx = x;
      ny = y;
    }
  }

  run.player.x = nx;
  run.player.y = ny;

  run.player.turnsUsed += 1;
  run.player.turnsRemaining = Math.max(0, run.turnsTotal - run.player.turnsUsed);

  const escaped = nx === run.public.exit.x && ny === run.public.exit.y;
  const outOfTurns = run.player.turnsUsed >= run.turnsTotal;

  if (escaped) {
    run.status = 'finished';
    run.player.finished = true;
    run.player.result = 'escaped';
    run.player.score = run.player.turnsRemaining;
    notes.push(`Escaped with ${run.player.turnsRemaining} turns remaining.`);
  } else if (outOfTurns) {
    run.status = 'finished';
    run.player.finished = true;
    run.player.result = 'timeout';
    run.player.score = 0;
    notes.push('Out of turns.');
  }

  run.replay.push({
    t: nowIso(),
    kind: 'MAZE_TURN_RESOLVED',
    turn,
    notes,
    score: run.player.score,
    snapshot: {
      x: run.player.x,
      y: run.player.y,
      turnsUsed: run.player.turnsUsed,
      turnsRemaining: run.player.turnsRemaining,
      result: run.player.result
    }
  });

  if (run.status === 'finished') {
    run.replay.push({ t: nowIso(), kind: 'MAZE_RUN_FINISHED', score: run.player.score, result: run.player.result });
    return;
  }

  // Advance
  run.turn += 1;
  run.public.turn = run.turn;
  run.replay.push({ t: nowIso(), kind: 'MAZE_TURN_STARTED', turn: run.turn, x: run.player.x, y: run.player.y });
}

function replaceAt(s: string, idx: number, ch: string) {
  return s.slice(0, idx) + ch + s.slice(idx + 1);
}

function isWall(grid: string[], x: number, y: number) {
  if (y < 0 || y >= grid.length) return true;
  const row = grid[y];
  if (!row) return true;
  if (x < 0 || x >= row.length) return true;
  return row[x] === '#';
}

function generateMaze(params: { width: number; height: number; rng: () => number }): string[] {
  // Simple randomized maze using a "carving" approach on odd coordinates.
  // Ensures outer walls. This is intentionally simple for V1.
  let { width, height, rng } = params;
  if (width % 2 === 0) width += 1;
  if (height % 2 === 0) height += 1;

  // Start with all walls
  const grid: string[] = Array.from({ length: height }, () => '#'.repeat(width));

  function carve(x: number, y: number) {
    grid[y] = replaceAt(grid[y]!, x, '.');

    const dirs = [
      { dx: 0, dy: -2 },
      { dx: 2, dy: 0 },
      { dx: 0, dy: 2 },
      { dx: -2, dy: 0 }
    ];
    // shuffle
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = dirs[i];
      dirs[i] = dirs[j]!;
      dirs[j] = tmp!;
    }

    for (const d of dirs) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) continue;
      if (grid[ny]![nx] === '#') {
        // carve wall between
        grid[y + d.dy / 2] = replaceAt(grid[y + d.dy / 2]!, x + d.dx / 2, '.');
        carve(nx, ny);
      }
    }
  }

  carve(1, 1);

  return grid;
}
