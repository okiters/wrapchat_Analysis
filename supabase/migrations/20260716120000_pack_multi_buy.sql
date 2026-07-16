-- Multi-buy: unlock_report_packs now honors DUPLICATE pack ids in the array,
-- so buying N of the same pack in one call charges N x cost and increments the
-- quantity by N, atomically. Previously the array was de-duplicated, so the
-- quantity stepper and re-buying an owned pack silently did nothing.

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
  v_cost integer;
  v_total integer := 0;
  v_balance integer;
  v_email text;
  v_source text := 'credits';
  v_free boolean;
  v_counts jsonb := '{}'::jsonb;
  v_key text;
  v_qty integer;
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

  v_free := public.is_current_admin() or public.get_access_mode() = 'open';
  v_source := case
    when public.is_current_admin() then 'admin'
    when public.get_access_mode() = 'open' then 'open'
    else 'credits'
  end;

  -- Validate every occurrence, tally per-pack counts, and sum the charge over
  -- ALL occurrences (not de-duplicated).
  foreach v_pack_id in array p_pack_ids loop
    v_pack_id := lower(trim(coalesce(v_pack_id, '')));
    v_cost := public.report_pack_credit_cost(v_pack_id);
    if v_cost is null then
      raise exception 'Invalid report pack: %', v_pack_id;
    end if;
    v_counts := jsonb_set(
      v_counts,
      array[v_pack_id],
      to_jsonb(coalesce((v_counts ->> v_pack_id)::integer, 0) + 1),
      true
    );
    if not v_free then
      v_total := v_total + v_cost;
    end if;
  end loop;

  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'User not found';
  end if;

  insert into public.credits (user_id, email, credits, updated_at)
  values (p_user_id, v_email, 0, now())
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = public.credits.updated_at;

  select credits into v_balance from public.credits where user_id = p_user_id for update;

  if v_total > 0 then
    if coalesce(v_balance, 0) < v_total then
      raise exception 'Insufficient credits' using errcode = '23514';
    end if;
    update public.credits
    set credits = credits - v_total, updated_at = now()
    where user_id = p_user_id
    returning credits into v_balance;
  end if;

  -- Apply the tallied quantities.
  for v_key, v_qty in select key, value::integer from jsonb_each_text(v_counts) loop
    insert into public.report_unlocks (user_id, pack_id, credits_spent, source, unlocked_at, quantity)
    values (p_user_id, v_key, public.report_pack_credit_cost(v_key) * v_qty, v_source, now(), v_qty)
    on conflict (user_id, pack_id) do update
      set quantity = public.report_unlocks.quantity + v_qty,
          credits_spent = public.report_unlocks.credits_spent + public.report_pack_credit_cost(excluded.pack_id) * v_qty,
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
