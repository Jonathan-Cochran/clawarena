-- Challenge mode (V1) + owner email verification scaffolding
-- Additive + idempotent; safe to run repeatedly.

-- --- Agents: owner email verification ---

alter table public.agents
  add column if not exists owner_email text;

alter table public.agents
  add column if not exists owner_email_verified_at timestamptz;

create table if not exists public.agent_owner_email_verifications (
  id text primary key,
  agent_id text not null references public.agents(id) on delete cascade,
  email text not null,
  code text not null,
  token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists agent_owner_email_verifications_agent_id_idx on public.agent_owner_email_verifications(agent_id);
create index if not exists agent_owner_email_verifications_token_idx on public.agent_owner_email_verifications(token);

-- --- Challenges: core tables ---

create table if not exists public.challenges (
  id text primary key,
  slug text unique,
  title text not null,
  status text not null default 'draft', -- draft | published | closed
  game_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  entry_deadline_at timestamptz,

  -- display content
  rules_md text,
  prize_pool_usd numeric,
  prize_split_json jsonb, -- e.g. [{"place":1,"pct":70},{"place":2,"pct":20},{"place":3,"pct":10}]
  sponsor_name text,

  -- Future Stripe (scaffolding; unused in V1)
  stripe_product_id text,
  stripe_price_id text,
  stripe_connect_account_id text,

  created_at timestamptz not null default now()
);

create index if not exists challenges_status_idx on public.challenges(status);
create index if not exists challenges_starts_at_idx on public.challenges(starts_at);

create table if not exists public.challenge_entries (
  id text primary key,
  challenge_id text not null references public.challenges(id) on delete cascade,
  agent_id text not null references public.agents(id) on delete cascade,
  run_id text not null references public.runs(id) on delete cascade,
  score integer not null,
  created_at timestamptz not null default now(),

  unique (challenge_id, agent_id),
  unique (challenge_id, run_id)
);

create index if not exists challenge_entries_challenge_id_idx on public.challenge_entries(challenge_id);
create index if not exists challenge_entries_score_idx on public.challenge_entries(challenge_id, score desc);

create table if not exists public.payouts (
  id text primary key,
  challenge_id text not null references public.challenges(id) on delete cascade,
  agent_id text not null references public.agents(id) on delete cascade,
  amount_usd numeric not null,
  currency text not null default 'USD',
  status text not null default 'pending', -- pending | paid | canceled
  created_at timestamptz not null default now(),
  paid_at timestamptz,

  -- Future Stripe Connect (scaffolding)
  stripe_transfer_id text,
  stripe_destination_account_id text
);

create index if not exists payouts_challenge_id_idx on public.payouts(challenge_id);
create index if not exists payouts_agent_id_idx on public.payouts(agent_id);
