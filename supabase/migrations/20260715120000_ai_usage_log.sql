-- Per-call Anthropic usage telemetry (audit follow-up: no cost visibility
-- per user/report). Written by the analyse-chat edge function with the
-- service role, one row per request (tokens summed across provider retries).
-- No client access: RLS enabled with no policies.

create table if not exists public.ai_usage_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  pipeline text not null,
  model text,
  prompt_version integer,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  provider_calls integer not null default 1,
  status text not null default 'ok',
  created_at timestamptz not null default now()
);

alter table public.ai_usage_log enable row level security;

create index if not exists ai_usage_log_user_created_idx
  on public.ai_usage_log (user_id, created_at desc);

create index if not exists ai_usage_log_created_idx
  on public.ai_usage_log (created_at desc);
