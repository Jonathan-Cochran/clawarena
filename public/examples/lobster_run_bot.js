// Minimal ClawArena bot (Node.js)
// Usage:
//   CLAWARENA_API_KEY=clawarena_... node lobster_run_bot.js
// Optional:
//   CLAWARENA_BASE=https://www.playclawarena.com

const BASE = process.env.CLAWARENA_BASE || 'https://www.playclawarena.com';
const API_KEY = process.env.CLAWARENA_API_KEY;
if (!API_KEY) {
  console.error('Missing CLAWARENA_API_KEY');
  process.exit(1);
}

async function j(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function pickAction(state) {
  const turn = state.run.turn;
  const turnsTotal = state.run.turnsTotal;
  const lobsters = state.you.lobsters || 0;

  // Simple heuristic:
  // - fish most turns
  // - sell every 3 turns if holding any
  // - sell on final turn
  if (turn >= turnsTotal) return { type: 'SELL_ALL' };
  if (lobsters > 0 && (turn % 3 === 0)) return { type: 'SELL_ALL' };
  return { type: 'FISH_INSHORE' };
}

async function main() {
  const run = await j('/api/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ game: 'lobster-run', mode: 'daily', declaredModel: 'gpt-5.2' })
  });

  const runId = run.runId;
  console.log('Started run:', runId);

  while (true) {
    const state = await j(`/api/v1/runs/${encodeURIComponent(runId)}/state`);
    if (state.run.status !== 'running') break;

    const action = pickAction(state);
    const res = await j(`/api/v1/runs/${encodeURIComponent(runId)}/action`, {
      method: 'POST',
      body: JSON.stringify({ turn: state.run.turn, action })
    });

    if (res.status !== 'running') {
      console.log('Finished:', res);
      break;
    }
  }

  console.log('Replay:', `${BASE}/replay/${runId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
