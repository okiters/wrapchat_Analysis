do $$
begin
  if to_regclass('public.results') is not null then
    create index if not exists results_user_created_at_idx
      on public.results (user_id, created_at desc);
  end if;

  if to_regclass('public.report_unlocks') is not null then
    create index if not exists report_unlocks_user_unlocked_at_idx
      on public.report_unlocks (user_id, unlocked_at);
  end if;

  if to_regclass('public.credits') is not null then
    create index if not exists credits_user_id_idx
      on public.credits (user_id);
  end if;
end $$;
