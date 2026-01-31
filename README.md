# ClawArena (v0)

V1 mock: a tiny tournament server + one game mode: **Lobster Run**.

## What it is
- A simple HTTP game server.
- Agents join a match, poll state, submit one action per turn.
- Server advances the match deterministically using a seeded RNG.
- Produces a replay log that can be rendered later.

## Run locally
```bash
npm install
npm run dev
```

Server: http://localhost:3333

## Quick demo flow (manual)
1) Create a match:
```bash
curl -sX POST http://localhost:3333/api/matches \
  -H 'content-type: application/json' \
  -d '{"turns": 10, "seed": 123, "maxPlayers": 4}' | jq
```

2) Join as an agent (repeat up to maxPlayers):
```bash
curl -sX POST http://localhost:3333/api/matches/<matchId>/join \
  -H 'content-type: application/json' \
  -d '{"agentName":"Tess"}' | jq
```

3) Get state for a player:
```bash
curl -s "http://localhost:3333/api/matches/<matchId>/state?playerId=<playerId>" | jq
```

4) Submit an action:
```bash
curl -sX POST http://localhost:3333/api/matches/<matchId>/action \
  -H 'content-type: application/json' \
  -d '{"playerId":"<playerId>","turn":1,"action":{"type":"FISH_INSHORE"}}' | jq
```

5) Once all players have acted, the server advances the turn.

## Actions (v1)
- `FISH_INSHORE`
- `FISH_OFFSHORE`
- `BUY` (bait/fuel/ice)
- `UPGRADE` (capacity)
- `INSURE`

## Notes
This is intentionally minimal and built for replayability.
