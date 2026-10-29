-- Read-only numbers for the app's Settings -> Storage panel: database size,
-- per-table rows and size, every Storage bucket's file count and size, and a
-- breakdown of the videos bucket. Only the server (secret key) can call it.
-- Safe to run more than once.
create or replace function public.usage_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with video_files as (
    select (o.metadata->>'size')::bigint as bytes, split_part(o.name, '/', 2) as run_key
      from storage.objects o
     where o.bucket_id = 'videos'
  ),
  videos as (
    select f.bytes, r.id, r.provider, r.model_name, r.deleted_at
      from video_files f
      left join public.runs r on r.id::text = f.run_key
  )
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'rows', t.rows, 'bytes', t.bytes) order by t.bytes desc), '[]'::jsonb)
        from (
          select 'runs' as name, (select count(*) from public.runs) as rows, pg_total_relation_size('public.runs') as bytes
          union all
          select 'run_events', (select count(*) from public.run_events), pg_total_relation_size('public.run_events')
          union all
          select 'run_inputs', (select count(*) from public.run_inputs), pg_total_relation_size('public.run_inputs')
        ) t
    ),
    'buckets', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', b.id, 'public', b.public, 'size_limit', b.file_size_limit,
               'files', coalesce(o.files, 0), 'bytes', coalesce(o.bytes, 0)) order by b.id), '[]'::jsonb)
        from storage.buckets b
        left join (
          select bucket_id, count(*) as files, sum((metadata->>'size')::bigint) as bytes
            from storage.objects
           group by bucket_id
        ) o on o.bucket_id = b.id
    ),
    'videos', jsonb_build_object(
      'visible', (select jsonb_build_object('files', count(*), 'bytes', coalesce(sum(bytes), 0))
                    from videos where id is not null and deleted_at is null),
      'hidden_soft_deleted', (select jsonb_build_object('files', count(*), 'bytes', coalesce(sum(bytes), 0))
                                from videos where deleted_at is not null),
      'without_run', (select jsonb_build_object('files', count(*), 'bytes', coalesce(sum(bytes), 0))
                        from videos where id is null),
      'by_model', (
        select coalesce(jsonb_agg(jsonb_build_object('provider', m.provider, 'model', m.model_name, 'files', m.files, 'bytes', m.bytes)
                                  order by m.bytes desc), '[]'::jsonb)
          from (
            select provider, model_name, count(*) as files, sum(bytes) as bytes
              from videos
             where id is not null and deleted_at is null
             group by provider, model_name
             order by sum(bytes) desc
             limit 15
          ) m
      )
    ),
    'runs', (
      select jsonb_build_object(
               'total', count(*),
               'with_saved_video', count(*) filter (where archive_status = 'stored'),
               'video_not_saved', count(*) filter (where status = 'completed' and provider_video_url is not null
                                                     and (archive_status is null or archive_status = 'failed')))
        from public.runs
       where deleted_at is null
    )
  );
$$;

revoke execute on function public.usage_stats() from public, anon, authenticated;
grant execute on function public.usage_stats() to service_role;
