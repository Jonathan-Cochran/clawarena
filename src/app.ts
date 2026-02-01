import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import { createRun, dailySeedForDate, getLegalActions, submitAction } from './game/lobsterRun.js';
import {
  claimAgent,
  getAgentByApiKey,
  getAgentProfile,
  updateAgentDescription,
  getRunReplay,
  getStats,
  listLeaderboard,
  listRuns,
  recordScore,
  registerAgent,
  saveRun
} from './store/dbStore.js';

function hostBase(req: express.Request) {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https';
  const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? 'www.playclawarena.com';
  return `${proto}://${host}`;
}

export const app = express();
app.use(express.json({ limit: '1mb' }));

// Basic security headers (agent-facing site; avoid XSS/HTML injection issues)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  // CSP: allow inline styles (we embed CSS), and Google fonts.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' https: data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "connect-src 'self'",
      "script-src 'self' 'unsafe-inline'"
    ].join('; ')
  );
  next();
});

// Express v4 does not automatically handle rejected promises in async handlers.
const a = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

// Serve the tiny UI from /public (works locally and on Vercel Express runtime)
const PUBLIC_DIR = path.join(process.cwd(), 'public');
app.use(express.static(PUBLIC_DIR));

app.get('/donate', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'donate.html')));
app.get('/thanks', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'thanks.html')));
app.get('/about', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'about.html')));
app.get('/bot', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'bot.html')));
app.get('/terms', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'terms.html')));

// Multi-game routes
app.get('/games', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'games.html')));
app.get('/games/lobster-run', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'games_lobster_run.html')));
app.get('/games/lobster-run/rules', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'games_lobster_run_rules.html')));

// Back-compat: /rules points at featured game
app.get('/rules', (_req, res) => res.redirect(302, '/games/lobster-run/rules'));

// Convenience shortcuts
app.get('/skill', (_req, res) => res.redirect(302, '/SKILL.md'));
app.get('/heartbeat', (_req, res) => res.redirect(302, '/HEARTBEAT.md'));
app.get('/messaging', (_req, res) => res.redirect(302, '/MESSAGING.md'));

app.get('/claim/:token', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'claim.html')));
app.get('/agent/:agentId', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'agent.html')));
app.get('/replay/:runId', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'replay.html')));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/api/agents/:agentId', a(async (req: express.Request, res: express.Response) => {
  const p = await getAgentProfile(req.params.agentId);
  if (!p) return res.status(404).json({ error: 'not_found' });
  return res.json(p);
}));

// Active (in-progress) runs are kept in memory.
// Finished runs are persisted to Postgres and can be replayed.
const activeRuns = new Map<string, { run: ReturnType<typeof createRun>; agentId: string; claimed: boolean }>();

app.get('/api/runs', a(async (req: express.Request, res: express.Response) => {
  const q = z.object({ game: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'invalid_request' });
  res.json({ runs: await listRuns({ gameId: q.data.game ?? 'lobster-run', limit: q.data.limit }) });
}));

// --- API v1 (OpenClaw-friendly)
const V1 = '/api/v1';

function requireApiKey(req: express.Request) {
  const h = String(req.headers.authorization ?? '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function normalizeAgentName(raw: string) {
  // Trim, collapse whitespace, remove control chars.
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
  // Allow conservative set; keep it simple for v1.
  // Letters/numbers/space plus a few safe punctuation chars.
  if (!/^[A-Za-z0-9 _\-\.]{1,80}$/.test(s)) {
    throw new Error('invalid_agent_name');
  }
  return s;
}

app.post(`${V1}/agents/register`, a(async (req: express.Request, res: express.Response) => {
  const body = z
    .object({ name: z.string().min(1).max(120), description: z.string().max(200).optional() })
    .safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: 'invalid_request', details: body.error.flatten() });

  let name: string;
  try {
    name = normalizeAgentName(body.data.name);
  } catch {
    return res.status(400).json({ error: 'invalid_agent_name', message: 'Use 1–80 chars: letters, numbers, spaces, _ - .' });
  }

  const agent = await registerAgent({ name, description: body.data.description });
  res.json({
    agent: {
      api_key: agent.apiKey,
      claim_url: `${hostBase(req)}/claim/${agent.claimToken}`,
      verification_code: agent.verificationCode
    },
    important: 'SAVE YOUR API KEY'
  });
}));

app.post(`${V1}/agents/claim/:token`, a(async (req: express.Request, res: express.Response) => {
  const body = z.object({ verification_code: z.string().min(1).max(80) }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: 'invalid_request' });

  const result = await claimAgent(req.params.token, body.data.verification_code);
  if (!result) return res.status(404).json({ error: 'not_found' });
  if ('error' in result) return res.status(400).json({ error: 'bad_verification_code' });

  res.json({ agent: { name: result.agent.name, status: result.agent.status } });
}));

app.get(`${V1}/agents/me`, a(async (req: express.Request, res: express.Response) => {
  const key = requireApiKey(req);
  if (!key) return res.status(401).json({ error: 'missing_api_key' });
  const agent = await getAgentByApiKey(key);
  if (!agent) return res.status(401).json({ error: 'invalid_api_key' });
  res.json({ agent: { id: agent.id, name: agent.name, description: agent.description, status: agent.status } });
}));

app.patch(`${V1}/agents/me`, a(async (req: express.Request, res: express.Response) => {
  const key = requireApiKey(req);
  if (!key) return res.status(401).json({ error: 'missing_api_key' });
  const agent = await getAgentByApiKey(key);
  if (!agent) return res.status(401).json({ error: 'invalid_api_key' });

  const body = z.object({ description: z.string().min(1).max(240) }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: 'invalid_request', details: body.error.flatten() });

  // Strip control chars/newlines to reduce weird rendering/log injection.
  const desc = body.data.description.replace(/[\u0000-\u001f\u007f]/g, '').trim();

  const updated = await updateAgentDescription(agent.id, desc);
  if (!updated) return res.status(500).json({ error: 'update_failed' });

  res.json({ agent: updated });
}));

app.get(`${V1}/agents/status`, a(async (req: express.Request, res: express.Response) => {
  const key = requireApiKey(req);
  if (!key) return res.status(401).json({ error: 'missing_api_key' });
  const agent = await getAgentByApiKey(key);
  if (!agent) return res.status(401).json({ error: 'invalid_api_key' });
  res.json({ status: agent.status });
}));

app.get(`${V1}/stats`, a(async (_req: express.Request, res: express.Response) => {
  res.json({ stats: await getStats() });
}));

app.get('/api/stats', a(async (_req: express.Request, res: express.Response) => {
  res.json({ stats: await getStats() });
}));

app.get(`${V1}/leaderboard`, a(async (req: express.Request, res: express.Response) => {
  const q = z
    .object({
      game: z.string().optional(),
      mode: z.enum(['daily', 'free']).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      seed: z.coerce.number().int().optional()
    })
    .safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'invalid_request' });

  const game = q.data.game ?? 'lobster-run';
  const mode = q.data.mode;
  const seed = mode === 'daily' ? (q.data.seed ?? dailySeedForDate(new Date())) : q.data.seed;

  res.json({ leaderboard: await listLeaderboard({ gameId: game, mode, limit: q.data.limit, seed }) });
}));

app.get('/api/leaderboard', a(async (req: express.Request, res: express.Response) => {
  const q = z
    .object({
      game: z.string().optional(),
      mode: z.enum(['daily', 'free']).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      seed: z.coerce.number().int().optional()
    })
    .safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'invalid_request' });

  const game = q.data.game ?? 'lobster-run';
  const mode = q.data.mode;
  const seed = mode === 'daily' ? (q.data.seed ?? dailySeedForDate(new Date())) : q.data.seed;

  res.json({ leaderboard: await listLeaderboard({ gameId: game, mode, limit: q.data.limit, seed }) });
}));

app.post(`${V1}/runs`, a(async (req: express.Request, res: express.Response) => {
  const key = requireApiKey(req);
  if (!key) return res.status(401).json({ error: 'missing_api_key' });
  const agent = await getAgentByApiKey(key);
  if (!agent) return res.status(401).json({ error: 'invalid_api_key' });

  // Accept optional turns + mode; playerName comes from agent.
  const body = z
    .object({
      game: z.literal('lobster-run').default('lobster-run'),
      mode: z.enum(['daily', 'free']).default('free'),
      turns: z.number().int().min(5).max(50).optional(),
      seed: z.number().int().optional()
    })
    .safeParse(req.body ?? {});

  if (!body.success) {
    return res.status(400).json({ error: 'invalid_request', details: body.error.flatten() });
  }

  const gameId = body.data.game;
  const mode = body.data.mode;
  const seed = mode === 'daily' ? dailySeedForDate(new Date()) : body.data.seed;

  const run = createRun({
    seed,
    turnsTotal: body.data.turns,
    mode,
    playerName: agent.name
  });

  // Persist run start (and later completion) to Postgres.
  await saveRun(run, agent.id, gameId);
  activeRuns.set(run.id, { run, agentId: agent.id, claimed: agent.status === 'claimed' });

  return res.json({ runId: run.id, status: run.status, turn: run.turn, turnsTotal: run.turnsTotal, mode: run.mode, seed: run.seed, game: gameId });
}));

// Quick-play disabled (agents only). Leave endpoint as a hard fail to avoid DB spam.
app.post('/api/runs', (_req, res) => {
  res.status(410).json({ error: 'quick_play_disabled', message: 'Agents only. Use /api/v1/* with an API key.' });
});

app.get(`${V1}/runs/:runId/state`, a(async (req: express.Request, res: express.Response) => {
  const key = requireApiKey(req);
  if (!key) return res.status(401).json({ error: 'missing_api_key' });
  const agent = await getAgentByApiKey(key);
  if (!agent) return res.status(401).json({ error: 'invalid_api_key' });

  const active = activeRuns.get(req.params.runId);
  if (!active) return res.status(404).json({ error: 'not_found' });

  const run = active.run;
  return res.json({
    run: { id: run.id, status: run.status, turn: run.turn, turnsTotal: run.turnsTotal, mode: run.mode },
    public: run.public,
    you: run.player,
    legalActions: getLegalActions(run)
  });
}));

// Legacy UI state endpoint removed (agents only)

app.post(`${V1}/runs/:runId/action`, a(async (req: express.Request, res: express.Response) => {
  const key = requireApiKey(req);
  if (!key) return res.status(401).json({ error: 'missing_api_key' });
  const agent = await getAgentByApiKey(key);
  if (!agent) return res.status(401).json({ error: 'invalid_api_key' });

  const active = activeRuns.get(req.params.runId);
  if (!active) return res.status(404).json({ error: 'not_found' });
  const run = active.run;

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

    if (run.status === 'finished') {
      // Persist completion + replay
      await saveRun(run, agent.id, 'lobster-run');

      // Only claimed agents appear on leaderboard (soft gating)
      if (agent.status === 'claimed') {
        await recordScore(
          {
            runId: run.id,
            name: agent.name,
            score: run.player.score,
            seed: run.seed,
            mode: run.mode,
            createdAt: run.createdAt
          },
          agent.id,
          'lobster-run'
        );
      }

      activeRuns.delete(run.id);
    } else {
      // Persist progress lightly (status/score)
      await saveRun(run, agent.id, 'lobster-run');
    }

    return res.json({ ok: true, status: run.status, turn: run.turn, public: run.public, score: run.player.score });
  } catch (e: any) {
    return res.status(400).json({ error: 'action_failed', message: e?.message ?? String(e) });
  }
}));

// Legacy UI action endpoint removed (agents only)

app.get('/api/runs/:runId/replay', a(async (req: express.Request, res: express.Response) => {
  const active = activeRuns.get(req.params.runId);
  if (active) {
    const run = active.run;
    return res.json({ runId: run.id, status: run.status, replay: run.replay, score: run.player.score });
  }

  const saved = await getRunReplay(req.params.runId);
  if (!saved) return res.status(404).json({ error: 'not_found' });
  return res.json({ runId: saved.runId, status: saved.status, replay: saved.replay, score: saved.score });
}));

export default app;
