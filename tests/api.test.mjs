import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, mock, test } from 'node:test';

// Exercise real HTTP handlers and game engines without production credentials.
const agent = { id: 'test-agent', name: 'Test Bot', status: 'claimed', apiKey: 'test-key', claimToken: 'claim', verificationCode: 'verify' };
const runs = new Map();
const scores = [];
const feedback = [];
let leaderboardQuery;
const unused = async () => { throw new Error('Unexpected persistence call'); };
mock.module('../dist/store/dbStore.js', {
  exports: {
    claimAgent: unused,
    getAgentByApiKey: async (key) => key === agent.apiKey ? agent : null,
    addFeedback: async (value) => feedback.push(value),
    countRunsForAgentSince: async () => 0,
    getAgentProfile: unused,
    getRunMeta: unused,
    updateAgentDescription: unused,
    getRunReplay: async (id) => {
      const run = runs.get(id);
      return run && { runId: id, status: run.status, replay: run.replay, score: run.player.score };
    },
    getLiveRunState: unused,
    getSpectateSnapshot: unused,
    getStats: unused,
    cleanupStaleRunningRuns: async () => {},
    listLeaderboard: async (query) => { leaderboardQuery = query; return []; },
    listRuns: async () => [],
    recordScore: async (score) => scores.push(score),
    registerAgent: async ({ name }) => ({ ...agent, name }),
    saveRun: async (run) => runs.set(run.id, structuredClone(run)),
    listAgents: unused
  }
});
const { app } = await import('../dist/app.js');
let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, body, { auth = true, status = 200 } = {}) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${agent.apiKey}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  assert.equal(response.status, status, `${path}: ${response.status}`);
  return response.json();
}

test('health and static game/replay pages still render through Express', async () => {
  assert.deepEqual(await request('/healthz'), { ok: true });
  for (const path of ['/', '/games/lobster-run', '/games/maze-runner', '/replay/test-run']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('registration accepts valid names and keeps structured validation errors', async () => {
  const valid = await request('/api/v1/agents/register', { name: 'Test Bot' });
  assert.equal(valid.agent.api_key, agent.apiKey);
  for (const name of [null, 42, '', 'x'.repeat(121), ['bot']]) {
    const invalid = await request('/api/v1/agents/register', { name }, { status: 400 });
    assert.equal(invalid.error, 'invalid_request');
    assert.ok(invalid.details.fieldErrors.name.length);
    assert.deepEqual(invalid.details.formErrors, []);
  }
});

test('query coercion, limits, and daily leaderboard defaults survive Zod upgrade', async () => {
  await request('/api/v1/leaderboard?limit=10&seed=123&mode=free');
  assert.deepEqual(leaderboardQuery, { gameId: 'lobster-run', mode: 'free', limit: 10, seed: 123 });
  await request('/api/leaderboard/daily?date=2026-10-24');
  assert.equal(leaderboardQuery.limit, 100);
  assert.equal(leaderboardQuery.gameId, 'lobster-run');
  for (const query of ['limit=201', 'limit=nope', 'limit=1.5', 'mode=invalid']) {
    assert.equal((await request(`/api/v1/leaderboard?${query}`, undefined, { status: 400 })).error, 'invalid_request');
  }
});

test('authentication and invalid run payloads fail before creating a run', async () => {
  assert.equal((await request('/api/v1/runs', {}, { auth: false, status: 401 })).error, 'missing_api_key');
  for (const body of [{ turns: 4 }, { turns: '12' }, { game: 'invalid' }, { declaredModel: '<script>' }, { seed: 1.5 }]) {
    assert.equal((await request('/api/v1/runs', body, { status: 400 })).error, 'invalid_request');
  }
});

test('feedback applies defaults and rejects ratings outside the allowed range', async () => {
  await request('/api/v1/feedback', { comment: 'hello\nworld' });
  assert.deepEqual(feedback.at(-1), { agentId: agent.id, gameId: 'lobster-run', runId: null, rating: null, comment: 'helloworld' });
  assert.equal((await request('/api/v1/feedback', { rating: 6 }, { status: 400 })).error, 'invalid_request');
});

test('Lobster Run completes, persists a replay, and records the daily score', async () => {
  const run = await request('/api/v1/runs', { mode: 'daily', turns: 5 });
  assert.equal(run.game, 'lobster-run');
  assert.equal(run.turnsTotal, 12);
  const invalid = await request(`/api/v1/runs/${run.runId}/action`, { turn: 1, action: { type: 'BUY', item: 'bait', qty: 0 } }, { status: 400 });
  assert.equal(invalid.error, 'invalid_request');
  for (let turn = 1; turn <= 12; turn++) {
    const state = await request(`/api/v1/runs/${run.runId}/state`);
    assert.equal(state.run.turn, turn);
    const result = await request(`/api/v1/runs/${run.runId}/action`, { turn, action: { type: 'FISH_INSHORE' } });
    assert.equal(result.ok, true);
  }
  assert.equal(runs.get(run.runId).status, 'finished');
  assert.ok(scores.some((score) => score.runId === run.runId));
  const replay = await request(`/api/runs/${run.runId}/replay`);
  assert.equal(replay.status, 'finished');
  assert.ok(replay.replay.length > 12);
});

test('Maze Runner accepts enum actions and rejects actions from the other game', async () => {
  const run = await request('/api/v1/runs', { game: 'maze-runner', turns: 5, seed: 123 });
  assert.equal(run.mode, 'free');
  assert.equal((await request(`/api/v1/runs/${run.runId}/action`, { turn: 1, action: { type: 'FISH_INSHORE' } }, { status: 400 })).error, 'invalid_request');
  for (let turn = 1; turn <= 5; turn++) {
    const result = await request(`/api/v1/runs/${run.runId}/action`, { turn, action: { type: 'WAIT' } });
    assert.equal(result.you.turnsUsed, turn);
    assert.equal(result.status, turn === 5 ? 'finished' : 'running');
  }
  assert.equal(runs.get(run.runId).player.result, 'timeout');
});
