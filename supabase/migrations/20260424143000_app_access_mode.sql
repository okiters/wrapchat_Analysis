create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);

alter table public.app_settings enable row level security;

do $$
begin
  alter table public.app_settings
    add constraint app_settings_access_mode_value
    check (
      key <> 'access_mode'
      or value in ('open', 'credits', 'payments')
    );
exception
  when duplicate_object then null;
end $$;

insert into public.app_settings (key, value)
values ('access_mode', 'credits')
on conflict (key) do nothing;

revoke all on public.app_settings from public, anon, authenticated;

create or replace function public.get_access_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select s.value
      from public.app_settings s
      where s.key = 'access_mode'
        and s.value in ('open', 'credits', 'payments')
      limit 1
    ),
    'credits'
  );
$$;

create or replace function public.admin_set_access_mode(p_mode text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := lower(trim(coalesce(p_mode, '')));
begin
  if not public.is_current_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_mode not in ('open', 'credits', 'payments') then
    raise exception 'Invalid access mode';
  end if;

  insert into public.app_settings (key, value, updated_at, updated_by)
  values ('access_mode', v_mode, now(), auth.uid())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  return v_mode;
end;
$$;

revoke all on function public.get_access_mode() from public, anon, authenticated;
grant execute on function public.get_access_mode() to authenticated;

revoke all on function public.admin_set_access_mode(text) from public, anon, authenticated;
grant execute on function public.admin_set_access_mode(text) to authenticated;
