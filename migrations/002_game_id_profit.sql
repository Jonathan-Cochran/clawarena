-- Add game_id for multi-game future, and align scoring to "profit".

alter table public.runs
  add column if not exists game_id text;

alter table public.leaderboard_entries
  add column if not exists game_id text;

-- Backfill existing rows
update public.runs set game_id = 'lobster-run' where game_id is null;
update public.leaderboard_entries set game_id = 'lobster-run' where game_id is null;

-- Enforce not-null
alter table public.runs alter column game_id set not null;
alter table public.leaderboard_entries alter column game_id set not null;

create index if not exists runs_game_created_idx on public.runs(game_id, created_at desc);
create index if not exists leaderboard_game_mode_score_idx on public.leaderboard_entries(game_id, mode, score desc);
