-- Pack quantity: track how many of each pack a user owns and consume on use.
-- Previously report_unlocks was boolean (owned/not), now each row has a quantity.

alter table public.report_unlocks
  add column if not exists quantity integer not null default 1;

do $$
begin
  alter table public.report_unlocks
    add constraint report_unlocks_quantity_check check (quantity > 0);
exception when duplicate_object then null;
end $$;

-- get_report_unlocks: return { pack_id: quantity } jsonb instead of text[]
drop function if exists public.get_report_unlocks(uuid);
create or replace function public.get_report_unlocks(p_user_id uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if p_user_id <> auth.uid() and not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(pack_id, quantity), '{}'::jsonb)
  into v_result
  from public.report_unlocks
  where user_id = p_user_id;

  return v_result;
end;
$$;

-- unlock_report_packs: charge per purchase and increment quantity (allows buying multiples)
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
  v_dedup_ids text[] := array[]::text[];
  v_cost integer;
  v_total integer := 0;
  v_balance integer;
  v_email text;
  v_source text := 'credits';
  v_result jsonb;
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

    if not v_pack_id = any(v_dedup_ids) then
      v_dedup_ids := array_append(v_dedup_ids, v_pack_id);
    end if;
  end loop;

  if public.is_current_admin() or public.get_access_mode() = 'open' then
    v_source := case when public.is_current_admin() then 'admin' else 'open' end;
    v_total := 0;
  else
    select coalesce(sum(public.report_pack_credit_cost(pack_id)), 0)::integer
    into v_total
    from unnest(v_dedup_ids) as d(pack_id);
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

  foreach v_pack_id in array v_dedup_ids loop
    insert into public.report_unlocks (user_id, pack_id, credits_spent, source, unlocked_at, quantity)
    values (p_user_id, v_pack_id, public.report_pack_credit_cost(v_pack_id), v_source, now(), 1)
    on conflict (user_id, pack_id) do update
      set quantity = public.report_unlocks.quantity + 1,
          credits_spent = public.report_unlocks.credits_spent + public.report_pack_credit_cost(excluded.pack_id),
          unlocked_at = now();
  end loop;

  select coalesce(jsonb_object_agg(pack_id, quantity), '{}'::jsonb)
  into v_result
  from public.report_unlocks
  where user_id = p_user_id;

  return jsonb_build_object(
    'balance', greatest(coalesce(v_balance, 0), 0),
    'charged_credits', v_total,
    'unlocked_pack_ids', v_result
  );
end;
$$;

-- consume_report_pack: decrement quantity by 1, delete row when it reaches 0
create or replace function public.consume_report_pack(
  p_user_id uuid,
  p_pack_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack_id text := lower(trim(coalesce(p_pack_id, '')));
  v_quantity integer;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if p_user_id <> auth.uid() and not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select quantity
  into v_quantity
  from public.report_unlocks
  where user_id = p_user_id
    and pack_id = v_pack_id
  for update;

  if v_quantity is null then
    raise exception 'Pack not owned: %', v_pack_id using errcode = 'P0002';
  end if;

  if v_quantity <= 1 then
    delete from public.report_unlocks
    where user_id = p_user_id
      and pack_id = v_pack_id;
  else
    update public.report_unlocks
    set quantity = quantity - 1
    where user_id = p_user_id
      and pack_id = v_pack_id;
  end if;

  select coalesce(jsonb_object_agg(pack_id, quantity), '{}'::jsonb)
  into v_result
  from public.report_unlocks
  where user_id = p_user_id;

  return v_result;
end;
$$;

revoke all on function public.consume_report_pack(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_report_pack(uuid, text) to authenticated;
