-- Server-side gating for the analyse-chat edge function.
--
-- Before this migration the edge function verified the JWT and nothing else,
-- which made it an unmetered Anthropic proxy for any authenticated account.
-- This adds the two primitives the function now enforces on every request:
--
-- 1. consume_ai_call_quota  — fixed-window per-user rate limit.
-- 2. user_has_ai_entitlement — may this user consume AI calls at all?
--    True when the app is in open mode, the user is an allowlisted admin,
--    or the user has paid credits, an unlocked pack, or a live Quick Read.
--
-- Both are called by the edge function with the service-role key only.

create table if not exists public.ai_usage_counters (
  user_id uuid not null,
  window_start timestamptz not null,
  calls integer not null default 0,
  primary key (user_id, window_start)
);

alter table public.ai_usage_counters enable row level security;
revoke all on public.ai_usage_counters from public, anon, authenticated;

create or replace function public.consume_ai_call_quota(
  p_user_id uuid,
  p_max_calls integer,
  p_window_minutes integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_calls integer;
begin
  if p_user_id is null or p_max_calls is null or p_max_calls <= 0
     or p_window_minutes is null or p_window_minutes <= 0 then
    return false;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / (p_window_minutes * 60)) * (p_window_minutes * 60)
  );

  -- Opportunistic cleanup of expired windows for this user.
  delete from public.ai_usage_counters
  where user_id = p_user_id
    and window_start < now() - make_interval(mins => p_window_minutes * 2);

  insert into public.ai_usage_counters (user_id, window_start, calls)
  values (p_user_id, v_window_start, 1)
  on conflict (user_id, window_start)
  do update set calls = ai_usage_counters.calls + 1
  where ai_usage_counters.calls < p_max_calls
  returning calls into v_calls;

  return v_calls is not null;
end;
$$;

revoke all on function public.consume_ai_call_quota(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_call_quota(uuid, integer, integer) to service_role;

create or replace function public.user_has_ai_entitlement(
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_mode text;
begin
  if p_user_id is null then
    return false;
  end if;

  v_mode := public.get_access_mode();
  if v_mode = 'open' then
    return true;
  end if;

  -- Allowlisted admins always pass.
  if exists (
    select 1
    from public.admin_email_allowlist a
    join auth.users u on lower(u.email) = lower(a.email)
    where u.id = p_user_id
  ) then
    return true;
  end if;

  -- Paid credits, or a live (unused, unexpired) Quick Read.
  if exists (
    select 1
    from public.credits c
    where c.user_id = p_user_id
      and (
        coalesce(c.credits, 0) > 0
        or (
          coalesce(c.quick_read_available, false)
          and c.quick_read_used_at is null
          and (c.quick_read_expires_at is null or c.quick_read_expires_at > now())
        )
      )
  ) then
    return true;
  end if;

  -- An owned, unconsumed report pack.
  if exists (
    select 1
    from public.report_unlocks r
    where r.user_id = p_user_id
      and coalesce(r.quantity, 0) > 0
  ) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.user_has_ai_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.user_has_ai_entitlement(uuid) to service_role;
