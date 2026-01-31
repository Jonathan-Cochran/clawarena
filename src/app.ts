import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import { createRun, dailySeedForDate, getLegalActions, submitAction } from './game/lobsterRun.js';
import { getRun, listLeaderboard, listRuns, recordScore, saveRun } from './store/memoryStore.js';

export const app = express();
app.use(express.json({ limit: '1mb' }));

// Serve the tiny UI from /public (works locally and on Vercel Express runtime)
const PUBLIC_DIR = path.join(process.cwd(), 'public');
app.use(express.static(PUBLIC_DIR));

app.get('/donate', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'donate.html')));
app.get('/replay/:runId', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'replay.html')));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/api/runs', (_req, res) => {
  res.json({ runs: listRuns() });
});

app.get('/api/leaderboard', (req, res) => {
  const q = z
    .object({ mode: z.enum(['daily', 'free']).optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
    .safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'invalid_request' });
  res.json({ leaderboard: listLeaderboard({ mode: q.data.mode, limit: q.data.limit }) });
});

app.post('/api/runs', (req, res) => {
  const body = z
    .object({
      mode: z.enum(['daily', 'free']).default('free'),
      turns: z.number().int().min(5).max(50).optional(),
      seed: z.number().int().optional(),
      playerName: z.string().min(1).max(80)
    })
    .safeParse(req.body ?? {});

  if (!body.success) {
    return res.status(400).json({ error: 'invalid_request', details: body.error.flatten() });
  }

  const mode = body.data.mode;
  const seed = mode === 'daily' ? dailySeedForDate(new Date()) : body.data.seed;

  const run = createRun({
    seed,
    turnsTotal: body.data.turns,
    mode,
    playerName: body.data.playerName
  });
  saveRun(run);
  res.json({ runId: run.id, status: run.status, turn: run.turn, turnsTotal: run.turnsTotal, mode: run.mode, seed: run.seed });
});

app.get('/api/runs/:runId/state', (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'not_found' });

  res.json({
    run: { id: run.id, status: run.status, turn: run.turn, turnsTotal: run.turnsTotal, mode: run.mode },
    public: run.public,
    you: run.player,
    legalActions: getLegalActions(run)
  });
});

app.post('/api/runs/:runId/action', (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'not_found' });

  const body = z
    .object({
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
    submitAction(run, body.data.turn, body.data.action);

    // If finished, record score.
    if (run.status === 'finished') {
      recordScore({
        runId: run.id,
        name: run.player.name,
        score: run.player.score,
        seed: run.seed,
        mode: run.mode,
        createdAt: run.createdAt
      });
    }

    saveRun(run);
    res.json({ ok: true, status: run.status, turn: run.turn, public: run.public, score: run.player.score });
  } catch (e: any) {
    res.status(400).json({ error: 'action_failed', message: e?.message ?? String(e) });
  }
});

app.get('/api/runs/:runId/replay', (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'not_found' });
  res.json({ runId: run.id, status: run.status, replay: run.replay, score: run.player.score });
});
