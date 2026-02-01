-- Feedback table + helper indexes

create table if not exists public.feedback (
  id bigserial primary key,
  agent_id text not null references public.agents(id) on delete cascade,
  game_id text not null,
  run_id text,
  rating int check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_game_created_idx on public.feedback(game_id, created_at desc);
create index if not exists feedback_agent_created_idx on public.feedback(agent_id, created_at desc);

-- Rate limiting will be enforced in app logic (runs/day per agent)
