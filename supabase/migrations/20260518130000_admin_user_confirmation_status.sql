drop function if exists public.admin_list_user_credits();

create or replace function public.admin_list_user_credits()
returns table (
  user_id uuid,
  email text,
  balance integer,
  email_confirmed_at timestamptz,
  confirmation_sent_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select
    u.id::uuid as user_id,
    coalesce(u.email, '')::text as email,
    coalesce(c.credits, 0)::integer as balance,
    u.email_confirmed_at,
    u.confirmation_sent_at
  from auth.users u
  left join public.credits c
    on c.user_id = u.id
  order by lower(coalesce(u.email, '')), u.created_at desc;
end;
$$;

revoke all on function public.admin_list_user_credits() from public, anon, authenticated;
grant execute on function public.admin_list_user_credits() to authenticated;
