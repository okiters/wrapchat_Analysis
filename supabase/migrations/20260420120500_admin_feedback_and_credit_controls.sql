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

revoke all on function public.admin_add_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_add_credits(uuid, integer) to authenticated;

create or replace function public.admin_delete_feedback(
  p_feedback_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if coalesce(trim(p_feedback_id), '') = '' then
    raise exception 'Feedback id is required';
  end if;

  delete from public.feedback
  where id::text = trim(p_feedback_id);

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.admin_delete_feedback(text) from public, anon, authenticated;
grant execute on function public.admin_delete_feedback(text) to authenticated;
