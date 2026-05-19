-- Give the free Quick Read a clear starter-pass window without affecting paid credits.
do $$ begin
  alter table public.credits add column quick_read_expires_at timestamptz null;
exception when duplicate_column then null;
end $$;

update public.credits
set quick_read_expires_at = coalesce(trial_granted_at, updated_at, now()) + interval '7 days'
where quick_read_expires_at is null
  and quick_read_used_at is null;

drop function if exists public.initialise_credits(uuid, text);

create function public.initialise_credits(
  p_user_id uuid,
  p_email    text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  select credits into v_balance
  from public.credits
  where user_id = p_user_id;

  if found then
    update public.credits
    set quick_read_expires_at = coalesce(quick_read_expires_at, coalesce(trial_granted_at, updated_at, now()) + interval '7 days')
    where user_id = p_user_id
      and quick_read_used_at is null;

    return coalesce(v_balance, 0);
  end if;

  insert into public.credits (
    user_id,
    email,
    credits,
    role,
    trial_granted_at,
    quick_read_available,
    quick_read_used_at,
    quick_read_expires_at,
    updated_at
  )
  values (
    p_user_id,
    p_email,
    0,
    'user',
    now(),
    true,
    null,
    now() + interval '7 days',
    now()
  )
  on conflict (user_id) do nothing
  returning credits into v_balance;

  if v_balance is null then
    select credits into v_balance
    from public.credits
    where user_id = p_user_id;
  end if;

  return coalesce(v_balance, 0);
end;
$$;

create or replace function public.consume_quick_read_trial(
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if p_user_id <> auth.uid() and not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.credits
  set quick_read_available = false,
      quick_read_used_at = coalesce(quick_read_used_at, now()),
      updated_at = now()
  where user_id = p_user_id
    and quick_read_available = true
    and quick_read_used_at is null
    and (quick_read_expires_at is null or quick_read_expires_at >= now());

  return found;
end;
$$;

revoke all on function public.initialise_credits(uuid, text) from public, anon, authenticated;
grant execute on function public.initialise_credits(uuid, text) to authenticated;

revoke all on function public.consume_quick_read_trial(uuid) from public, anon, authenticated;
grant execute on function public.consume_quick_read_trial(uuid) to authenticated;
