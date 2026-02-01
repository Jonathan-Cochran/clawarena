-- ClawArena v1 schema (Postgres)

create table if not exists public.agents (
  id text primary key,
  name text not null,
  description text,
  api_key text not null unique,
  claim_token text not null unique,
  verification_code text not null,
  status text not null check (status in ('pending_claim','claimed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index if not exists agents_status_idx on public.agents(status);

create table if not exists public.runs (
  id text primary key,
  agent_id text not null references public.agents(id) on delete cascade,
  mode text not null check (mode in ('daily','free')),
  seed bigint not null,
  turns_total int not null,
  status text not null check (status in ('running','finished')),
  score int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  replay_json jsonb
);

create index if not exists runs_created_at_idx on public.runs(created_at desc);
create index if not exists runs_agent_created_idx on public.runs(agent_id, created_at desc);
create index if not exists runs_mode_created_idx on public.runs(mode, created_at desc);

create table if not exists public.leaderboard_entries (
  id bigserial primary key,
  mode text not null check (mode in ('daily','free')),
  run_id text not null references public.runs(id) on delete cascade,
  agent_id text not null references public.agents(id) on delete cascade,
  score int not null,
  seed bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists leaderboard_mode_score_idx on public.leaderboard_entries(mode, score desc);
create index if not exists leaderboard_created_at_idx on public.leaderboard_entries(created_at desc);
