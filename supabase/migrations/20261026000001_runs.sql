-- Rample Model Lab: generation runs, their status history and input files.
-- One shared team workspace: every signed-in user can read and write every row,
-- anonymous requests get nothing.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.run_status as enum ('uploading', 'submitting', 'queued', 'running', 'completed', 'failed');

-- Copy of the finished video into the private "videos" bucket.
create type public.archive_status as enum ('pending', 'uploading', 'stored', 'failed');

-- ---------------------------------------------------------------------------
-- runs: one row per video generation
-- ---------------------------------------------------------------------------
create table public.runs (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  finished_at        timestamptz,
  deleted_at         timestamptz,                       -- soft delete: hidden from the app, kept in the table
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,

  -- model snapshot at run time
  provider           text not null check (provider in ('pika', 'higgsfield')),
  model_id           text not null,
  model_name         text not null,
  model_function     text not null default '',

  -- what was asked for
  prompt             text not null default '',
  input              jsonb not null default '{}'::jsonb, -- full request body sent to the provider (all settings/params)
  prompt_draft       jsonb,                              -- set when "Draft with Claude" wrote the prompt: idea, document names, Claude model

  -- pipeline
  status             public.run_status not null default 'submitting',
  job_id             text,                               -- provider job / request id
  error              text,
  quoted_usd         numeric(12, 6),
  cost_usd           numeric(12, 6),
  runtime_s          numeric(10, 2),

  -- output video
  provider_video_url text,                               -- provider CDN URL; expires after a few days
  video_path         text,                               -- object key in the "videos" bucket once stored
  video_bytes        bigint,
  video_content_type text,
  archive_status     public.archive_status,              -- null until the run has a video to store
  archive_attempts   integer not null default 0,
  archive_error      text,
  archive_retry_at   timestamptz,                        -- earliest time a failed copy may be retried

  -- review
  rating             smallint check (rating between 1 and 5),
  notes              text not null default '',
  tags               text[] not null default '{}'
);

create index runs_created_at_idx on public.runs (created_at desc) where deleted_at is null;
create index runs_model_idx on public.runs (provider, model_id);
create index runs_active_idx on public.runs (status) where status in ('uploading', 'submitting', 'queued', 'running');
create index runs_archive_due_idx on public.runs (archive_status) where archive_status in ('pending', 'uploading', 'failed');
create index runs_job_id_idx on public.runs (job_id) where job_id is not null;

-- ---------------------------------------------------------------------------
-- run_events: status history, written by a trigger so app code can't skip it
-- ---------------------------------------------------------------------------
create table public.run_events (
  id             bigint generated always as identity primary key,
  run_id         uuid not null references public.runs (id) on delete cascade,
  at             timestamptz not null default now(),
  status         public.run_status not null,
  archive_status public.archive_status,
  detail         jsonb not null default '{}'::jsonb
);

create index run_events_run_idx on public.run_events (run_id, at);

-- ---------------------------------------------------------------------------
-- run_inputs: images/videos passed to the model
-- ---------------------------------------------------------------------------
create table public.run_inputs (
  id           bigint generated always as identity primary key,
  run_id       uuid not null references public.runs (id) on delete cascade,
  created_at   timestamptz not null default now(),
  field        text,                                     -- form field it filled; null for "@file:" refs in JSON fields
  kind         text not null check (kind in ('image', 'video')),
  file_name    text not null,
  content_type text,
  size_bytes   bigint,
  hosted_url   text                                      -- where the provider read it from (Vercel Blob or Higgsfield storage)
);

create index run_inputs_run_idx on public.run_inputs (run_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger runs_touch_updated_at
  before update on public.runs
  for each row execute function public.touch_updated_at();

create function public.log_run_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.archive_status is distinct from old.archive_status then
    insert into public.run_events (run_id, status, archive_status, detail)
    values (
      new.id,
      new.status,
      new.archive_status,
      jsonb_strip_nulls(jsonb_build_object(
        'job_id', new.job_id,
        'error', new.error,
        'archive_error', new.archive_error,
        'video_path', new.video_path
      ))
    );
  end if;
  return new;
end;
$$;

create trigger runs_log_event
  after insert or update on public.runs
  for each row execute function public.log_run_event();

-- ---------------------------------------------------------------------------
-- Claim a finished run's video for copying into Storage. Returns the row only
-- to the one caller that wins, so two pollers never upload the same video.
-- A claim stuck in 'uploading' for 10 minutes (crashed function) can be retaken.
-- ---------------------------------------------------------------------------
create function public.claim_video_archive(p_run_id uuid, p_max_attempts integer default 5)
returns setof public.runs
language sql
set search_path = ''
as $$
  update public.runs
     set archive_status   = 'uploading',
         archive_attempts = archive_attempts + 1,
         archive_error    = null,
         archive_retry_at = null
   where id = p_run_id
     and deleted_at is null
     and status = 'completed'
     and provider_video_url is not null
     and archive_attempts < p_max_attempts
     and (
          archive_status = 'pending'
       or (archive_status = 'failed' and coalesce(archive_retry_at, now()) <= now())
       or (archive_status = 'uploading' and updated_at < now() - interval '10 minutes')
     )
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- Access: signed-in team members get everything, anonymous gets nothing.
-- ---------------------------------------------------------------------------
alter table public.runs enable row level security;
alter table public.run_events enable row level security;
alter table public.run_inputs enable row level security;

create policy "team can do everything with runs"
  on public.runs for all to authenticated using (true) with check (true);
create policy "team can do everything with run events"
  on public.run_events for all to authenticated using (true) with check (true);
create policy "team can do everything with run inputs"
  on public.run_inputs for all to authenticated using (true) with check (true);

revoke all on public.runs, public.run_events, public.run_inputs from anon;
revoke all on sequence public.run_events_id_seq, public.run_inputs_id_seq from anon;

-- The claim function is only for the server's background video copy (secret key).
revoke execute on function public.claim_video_archive(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_video_archive(uuid, integer) to service_role;
revoke execute on function public.log_run_event() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
