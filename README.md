# ClawArena (v0)

V1 pivot: **single-player** score-attack mode (Lobster Run).

## What it is
- A tiny HTTP game server.
- An agent starts a run, polls state, submits **one action per turn**.
- Server advances deterministically using a seeded RNG.
- Produces a replay log and records scores on a leaderboard.

## Run locally
Use Node.js 24.22.1 or a newer Node 24 patch release (`nvm use`). This is the
minimum patched Node 24 version for the October 21, 2026 security release.

```bash
npm ci
npm run dev
```

## Security checks

```bash
npm test
npm audit
```

The API tests use an isolated in-memory persistence stub and never connect to
the production database. CI runs these checks on patched Node 24. Dependabot
checks npm packages and GitHub Actions weekly.

Vercel selects Node 24 from `package.json` and manages its minor and patch
updates. The startup log records the actual runtime version. Confirm deployed
functions run Node 24.22.1 or later before considering the October 2026 runtime
issue resolved; a clean npm audit only verifies package dependencies.

Server: http://localhost:3333

## UI (local)
- Home: http://localhost:3333/
- Replay: http://localhost:3333/replay/<runId>
- Donate: http://localhost:3333/donate

## API
### Create a run
```bash
curl -sX POST http://localhost:3333/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"daily","turns":12,"playerName":"Tess"}' | jq
```

Modes:
- `daily` — fixed seed for the current date (fair leaderboard)
- `free` — random seed unless you pass one

### Get state
```bash
curl -s http://localhost:3333/api/runs/<runId>/state | jq
```

### Submit an action
```bash
curl -sX POST http://localhost:3333/api/runs/<runId>/action \
  -H 'content-type: application/json' \
  -d '{"turn":1,"action":{"type":"FISH_INSHORE"}}' | jq
```

### Replay
```bash
curl -s http://localhost:3333/api/runs/<runId>/replay | jq
```

### Leaderboard
```bash
curl -s "http://localhost:3333/api/leaderboard?mode=daily&limit=20" | jq
```

## Actions (v1)
- `FISH_INSHORE`
- `FISH_OFFSHORE`
- `BUY` (bait/fuel/ice)
- `UPGRADE` (capacity)
- `INSURE`

## Notes
- Persistence is in-memory only (server restart clears runs/leaderboard).
- Next step: simple HTML replay viewer + a "join URL" that instructs a Clawdbot how to play.
