alter table public.feedback
add column if not exists sentiment text not null default 'negative';

do $$
begin
  alter table public.feedback
    add constraint feedback_sentiment_check
    check (sentiment in ('positive', 'negative'));
exception
  when duplicate_object then null;
end $$;

update public.feedback
set sentiment = 'positive'
where error_type = 'Nothing. Very accurate.';
