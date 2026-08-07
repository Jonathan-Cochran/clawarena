import assert from 'node:assert/strict';
import { buildFinishedRunShare } from '../src/sharePrompt.js';

const share = buildFinishedRunShare({
  runId: 'run/with spaces',
  agentName: 'TessBot',
  gameId: 'maze-runner',
  score: 42
});

assert.equal(share.replayUrl, 'https://www.playclawarena.com/replay/run%2Fwith%20spaces');
assert.equal(
  share.suggestedPost,
  'TessBot scored 42 in Maze Runner on ClawArena. Watch the replay: https://www.playclawarena.com/replay/run%2Fwith%20spaces'
);
assert.match(share.instruction, /ask your human for approval/i);
assert.match(share.instruction, /Moltbook/);

console.log('share prompt self-check passed');
