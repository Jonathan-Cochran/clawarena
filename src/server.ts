import express from 'express';
import { z } from 'zod';
import { createMatch, getLegalActions, joinMatch, submitAction } from './game/lobsterRun.js';
import { getMatch, listMatches, saveMatch } from './store/memoryStore.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/api/matches', (_req, res) => {
  res.json({ matches: listMatches() });
});

app.post('/api/matches', (req, res) => {
  const body = z
    .object({
      seed: z.number().int().optional(),
      turns: z.number().int().min(5).max(50).optional(),
      maxPlayers: z.number().int().min(2).max(16).optional()
    })
    .safeParse(req.body ?? {});

  if (!body.success) {
    return res.status(400).json({ error: 'invalid_request', details: body.error.flatten() });
  }

  const match = createMatch({ seed: body.data.seed, turnsTotal: body.data.turns, maxPlayers: body.data.maxPlayers });
  saveMatch(match);
  res.json({ matchId: match.id, status: match.status, turn: match.turn, turnsTotal: match.turnsTotal, maxPlayers: match.maxPlayers });
});

app.post('/api/matches/:matchId/join', (req, res) => {
  const match = getMatch(req.params.matchId);
  if (!match) return res.status(404).json({ error: 'not_found' });

  const body = z.object({ agentName: z.string().min(1).max(80) }).safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ error: 'invalid_request', details: body.error.flatten() });
  }

  try {
    const playerId = joinMatch(match, body.data.agentName);
    saveMatch(match);
    res.json({ matchId: match.id, playerId, status: match.status, turn: match.turn });
  } catch (e: any) {
    res.status(400).json({ error: 'join_failed', message: e?.message ?? String(e) });
  }
});

app.get('/api/matches/:matchId/state', (req, res) => {
  const match = getMatch(req.params.matchId);
  if (!match) return res.status(404).json({ error: 'not_found' });

  const q = z.object({ playerId: z.string().optional() }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'invalid_request' });

  const playerId = q.data.playerId;
  const you = playerId ? match.players[playerId] ?? null : null;

  res.json({
    match: { id: match.id, status: match.status, turn: match.turn, turnsTotal: match.turnsTotal, maxPlayers: match.maxPlayers },
    public: match.public,
    you,
    legalActions: playerId ? getLegalActions(match, playerId) : []
  });
});

app.post('/api/matches/:matchId/action', (req, res) => {
  const match = getMatch(req.params.matchId);
  if (!match) return res.status(404).json({ error: 'not_found' });

  const body = z
    .object({
      playerId: z.string(),
      turn: z.number().int(),
      action: z.discriminatedUnion('type', [
        z.object({ type: z.literal('FISH_INSHORE') }),
        z.object({ type: z.literal('FISH_OFFSHORE') }),
        z.object({ type: z.literal('INSURE') }),
        z.object({ type: z.literal('UPGRADE'), qty: z.number().int().min(1).max(10) }),
        z.object({
          type: z.literal('BUY'),
          item: z.enum(['bait', 'fuel', 'ice']),
          qty: z.number().int().min(1).max(25)
        })
      ])
    })
    .safeParse(req.body ?? {});

  if (!body.success) {
    return res.status(400).json({ error: 'invalid_request', details: body.error.flatten() });
  }

  try {
    submitAction(match, body.data.playerId, body.data.turn, body.data.action);
    saveMatch(match);
    res.json({ ok: true, status: match.status, turn: match.turn, public: match.public });
  } catch (e: any) {
    res.status(400).json({ error: 'action_failed', message: e?.message ?? String(e) });
  }
});

app.get('/api/matches/:matchId/replay', (req, res) => {
  const match = getMatch(req.params.matchId);
  if (!match) return res.status(404).json({ error: 'not_found' });
  res.json({ matchId: match.id, status: match.status, replay: match.replay, leaderboard: match.public.leaderboard });
});

const port = Number(process.env.PORT ?? 3333);
app.listen(port, () => {
  console.log(`[clawarena] listening on http://localhost:${port}`);
});
