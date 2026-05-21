-- Jobs table: stores subtitle generation job metadata and SRT storage paths.
-- Run once in Supabase SQL Editor. Schema already applied to the project;
-- this file exists so future devs can recreate the schema from scratch.

create table public.jobs (
  job_id            uuid primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,

  filename          text not null,

  status            text not null check (
    status in (
      'queued',
      'extracting',
      'transcribing',
      'translating',
      'aligning',
      'generating_srt',
      'done',
      'error'
    )
  ),

  progress          int not null default 0 check (progress between 0 and 100),

  translation_mode  text not null,
  source_lang       text not null default 'en',

  english_text      text,
  vietnamese_text   text,
  english_words     jsonb,
  vietnamese_words  jsonb,

  en_srt_storage_path  text,
  vi_srt_storage_path  text,

  error             text,

  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index jobs_user_created_idx on public.jobs(user_id, created_at desc);
create index jobs_user_status_idx  on public.jobs(user_id, status);

alter table public.jobs enable row level security;

create policy "owner reads own jobs"
  on public.jobs for select
  using (auth.uid() = user_id);

-- Writes go through the service-role key, so no client INSERT/UPDATE policy needed.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_jobs_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();
