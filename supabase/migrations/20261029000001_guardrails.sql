-- Guardrails: nothing can delete runs or videos except the app's explicit,
-- confirmed "Delete permanently" action (which runs on the server with the
-- secret key). Signed-in users keep read/create/update; they lose delete on
-- the tables, and upload/overwrite/delete on the videos bucket (the server
-- does all uploads). Safe to run more than once.

-- Tables: replace the "everything" policies with read/create/update only.
drop policy if exists "team can do everything with runs" on public.runs;
drop policy if exists "team can do everything with run events" on public.run_events;
drop policy if exists "team can do everything with run inputs" on public.run_inputs;

drop policy if exists "team can read runs" on public.runs;
drop policy if exists "team can create runs" on public.runs;
drop policy if exists "team can update runs" on public.runs;
create policy "team can read runs" on public.runs for select to authenticated using (true);
create policy "team can create runs" on public.runs for insert to authenticated with check (true);
create policy "team can update runs" on public.runs for update to authenticated using (true) with check (true);

drop policy if exists "team can read run events" on public.run_events;
create policy "team can read run events" on public.run_events for select to authenticated using (true);

drop policy if exists "team can read run inputs" on public.run_inputs;
drop policy if exists "team can create run inputs" on public.run_inputs;
drop policy if exists "team can update run inputs" on public.run_inputs;
create policy "team can read run inputs" on public.run_inputs for select to authenticated using (true);
create policy "team can create run inputs" on public.run_inputs for insert to authenticated with check (true);
create policy "team can update run inputs" on public.run_inputs for update to authenticated using (true) with check (true);

-- Belt and braces: take the privilege away too, so a future policy can't reopen it.
revoke delete, truncate on public.runs, public.run_events, public.run_inputs from authenticated, anon;
revoke insert, update on public.run_events from authenticated, anon; -- written only by the trigger

-- Grants the app needs. Some new projects don't grant these automatically
-- ("Automatically expose new tables" off), so state them here.
grant select, insert, update on public.runs, public.run_inputs to authenticated;
grant select on public.run_events to authenticated;
grant usage, select on sequence public.run_inputs_id_seq to authenticated;
grant select, insert, update, delete on public.runs, public.run_events, public.run_inputs to service_role;
grant usage, select on sequence public.run_events_id_seq, public.run_inputs_id_seq to service_role;

-- Videos bucket: signed-in users may only read (for signed URLs).
drop policy if exists "team can upload videos" on storage.objects;
drop policy if exists "team can update videos" on storage.objects;
drop policy if exists "team can delete videos" on storage.objects;

-- The Results list asks only for runs changed since its last check.
create index if not exists runs_updated_at_idx on public.runs (updated_at);
