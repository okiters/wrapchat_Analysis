create table if not exists public.report_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_id text not null,
  credits_spent integer not null default 0,
  source text not null default 'credits',
  unlocked_at timestamptz not null default now(),
  constraint report_unlocks_pack_id_check check (pack_id in ('vibe', 'rf', 'full', 'growth')),
  constraint report_unlocks_credits_spent_check check (credits_spent >= 0),
  constraint report_unlocks_user_pack_unique unique (user_id, pack_id)
);

alter table public.report_unlocks enable row level security;

do $$
begin
  create policy "Users can read their own report unlocks"
    on public.report_unlocks
    for select
    to authenticated
    using (user_id = auth.uid() or public.is_current_admin());
exception
  when duplicate_object then null;
end $$;

revoke all on public.report_unlocks from public, anon, authenticated;
grant select on public.report_unlocks to authenticated;

create or replace function public.report_pack_credit_cost(p_pack_id text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case lower(trim(coalesce(p_pack_id, '')))
    when 'vibe' then 95
    when 'rf' then 80
    when 'full' then 210
    when 'growth' then 45
    else null
  end;
$$;

create or replace function public.get_report_unlocks(p_user_id uuid default auth.uid())
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unlocks text[];
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if p_user_id <> auth.uid() and not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(array_agg(pack_id order by unlocked_at), array[]::text[])
  into v_unlocks
  from public.report_unlocks
  where user_id = p_user_id;

  return v_unlocks;
end;
$$;

create or replace function public.unlock_report_packs(
  p_user_id uuid,
  p_pack_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_pack_id text;
  v_pack_ids text[] := array[]::text[];
  v_missing_ids text[] := array[]::text[];
  v_cost integer;
  v_total integer := 0;
  v_balance integer;
  v_email text;
  v_source text := 'credits';
  v_unlocks text[];
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if p_user_id <> auth.uid() and not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_pack_ids is null or array_length(p_pack_ids, 1) is null then
    raise exception 'Choose at least one pack to unlock';
  end if;

  foreach v_pack_id in array p_pack_ids loop
    v_pack_id := lower(trim(coalesce(v_pack_id, '')));
    v_cost := public.report_pack_credit_cost(v_pack_id);

    if v_cost is null then
      raise exception 'Invalid report pack: %', v_pack_id;
    end if;

    if not v_pack_id = any(v_pack_ids) then
      v_pack_ids := array_append(v_pack_ids, v_pack_id);
    end if;
  end loop;

  select coalesce(array_agg(pack_id), array[]::text[])
  into v_missing_ids
  from unnest(v_pack_ids) as requested(pack_id)
  where not exists (
    select 1
    from public.report_unlocks existing
    where existing.user_id = p_user_id
      and existing.pack_id = requested.pack_id
  );

  if public.is_current_admin() or public.get_access_mode() = 'open' then
    v_source := case when public.is_current_admin() then 'admin' else 'open' end;
    v_total := 0;
  else
    select coalesce(sum(public.report_pack_credit_cost(pack_id)), 0)::integer
    into v_total
    from unnest(v_missing_ids) as missing(pack_id);
  end if;

  select u.email
  into v_email
  from auth.users u
  where u.id = p_user_id;

  if v_email is null then
    raise exception 'User not found';
  end if;

  insert into public.credits (user_id, email, credits, updated_at)
  values (p_user_id, v_email, 0, now())
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = public.credits.updated_at;

  select credits
  into v_balance
  from public.credits
  where user_id = p_user_id
  for update;

  if v_total > 0 then
    if coalesce(v_balance, 0) < v_total then
      raise exception 'Insufficient credits' using errcode = '23514';
    end if;

    update public.credits
    set credits = credits - v_total,
        updated_at = now()
    where user_id = p_user_id
    returning credits into v_balance;
  end if;

  foreach v_pack_id in array v_missing_ids loop
    insert into public.report_unlocks (user_id, pack_id, credits_spent, source, unlocked_at)
    values (p_user_id, v_pack_id, public.report_pack_credit_cost(v_pack_id), v_source, now())
    on conflict (user_id, pack_id) do nothing;
  end loop;

  select coalesce(array_agg(pack_id order by unlocked_at), array[]::text[])
  into v_unlocks
  from public.report_unlocks
  where user_id = p_user_id;

  return jsonb_build_object(
    'balance', greatest(coalesce(v_balance, 0), 0),
    'charged_credits', v_total,
    'unlocked_pack_ids', v_unlocks
  );
end;
$$;

create or replace function public.simulate_credit_purchase(
  p_user_id uuid,
  p_bundle_id text
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_bundle_id text := lower(trim(coalesce(p_bundle_id, '')));
  v_amount integer;
  v_balance integer;
  v_email text;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if p_user_id <> auth.uid() and not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  v_amount := case v_bundle_id
    when 'starter' then 100
    when 'plus' then 250
    when 'all_access' then 450
    else null
  end;

  if v_amount is null then
    raise exception 'Invalid credit bundle';
  end if;

  select u.email
  into v_email
  from auth.users u
  where u.id = p_user_id;

  if v_email is null then
    raise exception 'User not found';
  end if;

  insert into public.credits (user_id, email, credits, updated_at)
  values (p_user_id, v_email, v_amount, now())
  on conflict (user_id) do update
    set email = excluded.email,
        credits = coalesce(public.credits.credits, 0) + excluded.credits,
        updated_at = now()
  returning public.credits.credits into v_balance;

  return greatest(v_balance, 0);
end;
$$;

create or replace function public.admin_add_credits(
  p_user_id uuid,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_balance integer;
  v_email text;
begin
  if not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'Amount must be a non-zero integer';
  end if;

  select u.email
  into v_email
  from auth.users u
  where u.id = p_user_id;

  if v_email is null then
    raise exception 'User not found';
  end if;

  insert into public.credits (user_id, email, credits, updated_at)
  values (p_user_id, v_email, greatest(p_amount, 0), now())
  on conflict (user_id) do update
    set email = excluded.email,
        credits = greatest(coalesce(public.credits.credits, 0) + p_amount, 0),
        updated_at = now()
  returning public.credits.credits into v_balance;

  return v_balance;
end;
$$;

revoke all on function public.report_pack_credit_cost(text) from public, anon, authenticated;

revoke all on function public.get_report_unlocks(uuid) from public, anon, authenticated;
grant execute on function public.get_report_unlocks(uuid) to authenticated;

revoke all on function public.unlock_report_packs(uuid, text[]) from public, anon, authenticated;
grant execute on function public.unlock_report_packs(uuid, text[]) to authenticated;

revoke all on function public.simulate_credit_purchase(uuid, text) from public, anon, authenticated;
grant execute on function public.simulate_credit_purchase(uuid, text) to authenticated;

revoke all on function public.admin_add_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_add_credits(uuid, integer) to authenticated;
