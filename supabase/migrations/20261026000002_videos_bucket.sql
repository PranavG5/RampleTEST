-- Private bucket for finished videos. Files are served only through short-lived
-- signed URLs. Object keys: runs/{run_id}/output.{ext}
--
-- file_size_limit is 50 MB, the Free plan's maximum. On Pro you can raise it
-- here (and in Storage settings) and set VIDEO_MAX_MB to match.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 52428800, array['video/*'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Signed-in team members can read and manage every video; anonymous gets nothing.
create policy "team can read videos"
  on storage.objects for select to authenticated
  using (bucket_id = 'videos');

create policy "team can upload videos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'videos');

create policy "team can update videos"
  on storage.objects for update to authenticated
  using (bucket_id = 'videos')
  with check (bucket_id = 'videos');

create policy "team can delete videos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'videos');
