import assert from 'node:assert/strict';
import { createRun, getLegalActions, submitAction } from '../src/game/lobsterRun.js';

const run = createRun({
  seed: 20260702,
  turnsTotal: 3,
  mode: 'daily',
  playerName: 'Regression Bot'
});

assert.equal(run.player.lobsters, 0);
assert.equal(getLegalActions(run).some((action) => action.type === 'SELL_ALL'), false);

submitAction(run, 1, { type: 'FISH_INSHORE' });

const storedAfterFishing = run.player.lobsters;
assert.equal(run.status, 'running');
assert.equal(run.turn, 2);
assert.ok(storedAfterFishing > 0, 'fishing should store inventory across turns');
assert.equal(run.player.score, 0, 'unsold inventory should not score automatically');
assert.equal(getLegalActions(run).some((action) => action.type === 'SELL_ALL'), true);
assert.equal(getLegalActions(run).some((action) => action.type === 'SELL' && action.qty === 1), true);

const marketPrice = run.public.marketPricePerLobster;
const cashBeforeSale = run.player.cash;

submitAction(run, 2, { type: 'SELL_ALL' });

assert.equal(run.player.lobsters, 0);
assert.equal(run.player.cash, cashBeforeSale + storedAfterFishing * marketPrice);
assert.equal(run.player.score, storedAfterFishing * marketPrice);
assert.ok(
  run.replay.some((event) =>
    event.kind === 'TURN_RESOLVED' &&
    event.notes.some((note) => note.startsWith(`Sold ${storedAfterFishing} lobster @ $${marketPrice}`))
  ),
  'replay should explain the sale'
);

console.log('lobster-run v2 regression ok');
