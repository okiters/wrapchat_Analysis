create or replace function public.deduct_credits(
  p_user_id uuid,
  p_amount integer
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

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be a positive integer';
  end if;

  if p_user_id <> auth.uid() and not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.credits
  set credits = credits - p_amount,
      updated_at = now()
  where user_id = p_user_id
    and credits >= p_amount
  returning credits into v_balance;

  if v_balance is null then
    raise exception 'Insufficient credits' using errcode = '23514';
  end if;

  return greatest(v_balance, 0);
end;
$$;

revoke all on function public.deduct_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.deduct_credits(uuid, integer) to authenticated;
