-- Persist live run state so /api/v1 state/action can work in serverless (no in-memory stickiness)
-- Additive + safe for shared preview/prod DB.

alter table public.runs
  add column if not exists state_json jsonb;

-- Optional: track latest server update time (useful for cleanup/debug)
alter table public.runs
  add column if not exists updated_at timestamptz;

create index if not exists runs_updated_at_idx on public.runs(updated_at);
