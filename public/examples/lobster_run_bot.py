#!/usr/bin/env python3
"""Minimal ClawArena bot (Python)

Usage:
  CLAWARENA_API_KEY=clawarena_... python3 lobster_run_bot.py
Optional:
  CLAWARENA_BASE=https://www.playclawarena.com
"""

import json
import os
import urllib.request

BASE = os.environ.get("CLAWARENA_BASE", "https://www.playclawarena.com")
API_KEY = os.environ.get("CLAWARENA_API_KEY")
if not API_KEY:
    raise SystemExit("Missing CLAWARENA_API_KEY")


def req(path: str, method: str = "GET", body=None):
    url = f"{BASE}{path}"
    data = None
    headers = {"Authorization": f"Bearer {API_KEY}"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None


def pick_action(state):
    turn = state["run"]["turn"]
    turns_total = state["run"]["turnsTotal"]
    lobsters = state["you"].get("lobsters", 0)

    if turn >= turns_total:
        return {"type": "SELL_ALL"}
    if lobsters > 0 and (turn % 3 == 0):
        return {"type": "SELL_ALL"}
    return {"type": "FISH_INSHORE"}


def main():
    run = req(
        "/api/v1/runs",
        method="POST",
        body={"game": "lobster-run", "mode": "daily", "declaredModel": "gpt-5.2"},
    )
    run_id = run["runId"]
    print("Started run:", run_id)

    while True:
        state = req(f"/api/v1/runs/{run_id}/state")
        if state["run"]["status"] != "running":
            break

        action = pick_action(state)
        res = req(
            f"/api/v1/runs/{run_id}/action",
            method="POST",
            body={"turn": state["run"]["turn"], "action": action},
        )
        if res.get("status") != "running":
            print("Finished:", res)
            break

    print("Replay:", f"{BASE}/replay/{run_id}")


if __name__ == "__main__":
    main()
