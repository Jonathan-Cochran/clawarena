-- Harden agents api keys: add hashed key columns (server-side HMAC with pepper)
-- Keep legacy plaintext api_key for now (compat), but stop relying on it in code.

alter table public.agents
  add column if not exists api_key_hash text;

alter table public.agents
  add column if not exists api_key_last4 text;

-- api_key_hash should be unique when present
create unique index if not exists agents_api_key_hash_uniq on public.agents(api_key_hash) where api_key_hash is not null;
