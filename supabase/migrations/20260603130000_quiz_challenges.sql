-- Quiz challenges: stores quiz snapshots for public sharing.
-- No auth required to read — the quiz link IS the access token.
-- Only authenticated users can create challenges.

create table if not exists public.quiz_challenges (
  id          uuid        primary key default gen_random_uuid(),
  result_id   uuid        references public.results(id) on delete set null,
  created_by  uuid        references auth.users(id)    on delete cascade,
  quiz_data   jsonb       not null,
  created_at  timestamptz not null default now()
);

alter table public.quiz_challenges enable row level security;

-- Anyone (including anon) can read any quiz challenge row.
create policy "quiz_challenges_public_read"
  on public.quiz_challenges for select
  using (true);

-- Only authenticated users can insert, and only for themselves.
create policy "quiz_challenges_insert"
  on public.quiz_challenges for insert
  to authenticated
  with check (auth.uid() = created_by);

-- Grant read to anon so unauthenticated quiz players can fetch the data.
grant select on public.quiz_challenges to anon;
grant select, insert on public.quiz_challenges to authenticated;
