import assert from 'node:assert/strict';
import { createRun, getLegalActions, submitAction } from '../src/game/lobsterRun.js';

const run = createRun({
  seed: 20260702,
  turnsTotal: 3,
  mode: 'daily',
  playerName: 'Regression Bot'
});

assert.equal(run.player.lobsters, 0);
assert.equal(run.public.marketTrend, 'steady', 'initial market trend should be neutral');
assert.equal(getLegalActions(run).some((action) => action.type === 'SELL_ALL'), false);

submitAction(run, 1, { type: 'FISH_INSHORE' });

const storedAfterFishing = run.player.lobsters;
const firstStartedTurn = run.replay.find((event) => event.kind === 'TURN_STARTED' && event.turn === 1);
const secondStartedTurn = run.replay.find((event) => event.kind === 'TURN_STARTED' && event.turn === 2);
assert.equal(run.status, 'running');
assert.equal(run.turn, 2);
assert.ok(firstStartedTurn && firstStartedTurn.kind === 'TURN_STARTED');
assert.ok(secondStartedTurn && secondStartedTurn.kind === 'TURN_STARTED');
assert.equal(firstStartedTurn.marketTrend, 'steady');
assert.equal(run.public.marketTrend, secondStartedTurn.marketTrend);
assert.match(run.public.marketTrend, /^(rising|steady|falling)$/);
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

const iceRun = createRun({
  seed: 2,
  turnsTotal: 2,
  mode: 'daily',
  playerName: 'Ice Regression Bot'
});
iceRun.player.lobsters = 5;
iceRun.player.ice = 1;

submitAction(iceRun, 1, { type: 'FISH_INSHORE' });

const iceTurn = iceRun.replay.find((event) => event.kind === 'TURN_RESOLVED' && event.turn === 1);
assert.ok(iceTurn && iceTurn.kind === 'TURN_RESOLVED');
assert.equal(iceRun.player.ice, 0, 'ice should be consumed when protecting stored inventory');
assert.ok(
  iceTurn.notes.includes('Used 1 ice to protect stored lobster.'),
  'replay should explain ice protection'
);
assert.equal(
  iceTurn.notes.some((note) => note.includes('spoilage')),
  false,
  'ice should prevent spoilage for the protected turn'
);

const noIceRun = createRun({
  seed: 2,
  turnsTotal: 2,
  mode: 'daily',
  playerName: 'Spoilage Regression Bot'
});
noIceRun.player.lobsters = 5;

submitAction(noIceRun, 1, { type: 'FISH_INSHORE' });

const noIceTurn = noIceRun.replay.find((event) => event.kind === 'TURN_RESOLVED' && event.turn === 1);
assert.ok(noIceTurn && noIceTurn.kind === 'TURN_RESOLVED');
assert.ok(
  noIceTurn.notes.some((note) => note === 'Lost 5 lobster to spoilage (no ice).'),
  'same deterministic turn should spoil stored inventory without ice'
);

console.log('lobster-run ice consumption regression ok');
