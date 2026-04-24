-- Add role and trial columns to the credits table (idempotent).
do $$ begin
  alter table public.credits add column role text not null default 'user'
    check (role in ('user', 'tester'));
exception when duplicate_column then null;
end $$;

do $$ begin
  alter table public.credits add column trial_granted_at timestamptz null;
exception when duplicate_column then null;
end $$;

-- Drop first so we can change the return type from whatever existed before.
drop function if exists public.initialise_credits(uuid, text);

-- initialise_credits — called by the initialise-credits edge function on first login.
-- Idempotent: if a row already exists, returns the current balance without touching it.
-- In payments mode the first call grants 1 trial credit and stamps trial_granted_at.
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
  v_balance     integer;
  v_access_mode text;
  v_initial     integer := 0;
  v_trial_at    timestamptz := null;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  -- Return immediately if the user already has a credits row.
  select credits into v_balance
  from public.credits
  where user_id = p_user_id;

  if found then
    return coalesce(v_balance, 0);
  end if;

  -- Grant 1 trial credit in payments mode.
  v_access_mode := public.get_access_mode();
  if v_access_mode = 'payments' then
    v_initial  := 1;
    v_trial_at := now();
  end if;

  insert into public.credits (user_id, email, credits, role, trial_granted_at, updated_at)
  values (p_user_id, p_email, v_initial, 'user', v_trial_at, now())
  on conflict (user_id) do nothing
  returning credits into v_balance;

  -- on conflict do nothing means nothing was inserted if race condition hit;
  -- read the row that won.
  if v_balance is null then
    select credits into v_balance
    from public.credits
    where user_id = p_user_id;
  end if;

  return coalesce(v_balance, 0);
end;
$$;

-- get_user_role — returns the role of the given user (defaults to auth.uid()).
create or replace function public.get_user_role(
  p_user_id uuid default null
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select role
      from public.credits
      where user_id = coalesce(p_user_id, auth.uid())
      limit 1
    ),
    'user'
  );
$$;

-- admin_set_user_role — lets admins promote/demote a user between 'user' and 'tester'.
create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role    text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := lower(trim(coalesce(p_role, '')));
  v_email text;
begin
  if not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if v_role not in ('user', 'tester') then
    raise exception 'Role must be ''user'' or ''tester''';
  end if;

  -- Ensure a credits row exists before updating role.
  select u.email into v_email
  from auth.users u
  where u.id = p_user_id;

  if v_email is null then
    raise exception 'User not found';
  end if;

  insert into public.credits (user_id, email, credits, role, updated_at)
  values (p_user_id, v_email, 0, v_role, now())
  on conflict (user_id) do update
    set role       = excluded.role,
        updated_at = now();

  return v_role;
end;
$$;

-- Grant execute permissions.
revoke all on function public.initialise_credits(uuid, text)   from public, anon, authenticated;
grant  execute on function public.initialise_credits(uuid, text)   to authenticated;

revoke all on function public.get_user_role(uuid)              from public, anon, authenticated;
grant  execute on function public.get_user_role(uuid)              to authenticated;

revoke all on function public.admin_set_user_role(uuid, text)  from public, anon, authenticated;
grant  execute on function public.admin_set_user_role(uuid, text)  to authenticated;
