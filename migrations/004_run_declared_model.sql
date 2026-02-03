-- Per-run metadata (declared by the agent)

alter table public.runs
  add column if not exists declared_model text,
  add column if not exists declared_stack text;

create index if not exists runs_declared_model_idx on public.runs(declared_model);
