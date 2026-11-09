-- Spending numbers for Settings -> Spending.
-- 1. A permanently deleted run keeps a small cost record, so totals never drop
--    when someone deletes a video.
-- 2. spending_stats(): totals, this month, last 30 days, per provider, per
--    model and per month. Server-only (secret key).
-- Safe to run more than once.

create table if not exists public.deleted_run_costs (
  run_id      uuid primary key,
  provider    text not null,
  model_id    text not null,
  model_name  text not null,
  status      public.run_status not null,
  cost_usd    numeric(12, 6),
  quoted_usd  numeric(12, 6),
  created_at  timestamptz not null,
  deleted_at  timestamptz not null default now()
);

alter table public.deleted_run_costs enable row level security;
revoke all on public.deleted_run_costs from anon, authenticated;
grant select, insert on public.deleted_run_costs to service_role;

create or replace function public.keep_deleted_run_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.deleted_run_costs (run_id, provider, model_id, model_name, status, cost_usd, quoted_usd, created_at)
  values (old.id, old.provider, old.model_id, old.model_name, old.status, old.cost_usd, old.quoted_usd, old.created_at)
  on conflict (run_id) do nothing;
  return old;
end;
$$;

create or replace trigger runs_keep_deleted_cost
  before delete on public.runs
  for each row execute function public.keep_deleted_run_cost();

revoke execute on function public.keep_deleted_run_cost() from public, anon, authenticated;

-- "exact"     = the charge Pika confirmed for the job.
-- "estimated" = Pika's quote taken at Generate, for a finished run whose charge
--               isn't confirmed (yet).
-- "unpriced"  = finished runs with neither (Higgsfield doesn't report prices).
create or replace function public.spending_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with all_runs as (
    select provider, model_id, model_name, status, cost_usd, quoted_usd, created_at, false as deleted from public.runs
    union all
    select provider, model_id, model_name, status, cost_usd, quoted_usd, created_at, true from public.deleted_run_costs
  ),
  priced as (
    select a.*,
           coalesce(a.cost_usd, 0) as exact,
           case when a.cost_usd is null and a.status = 'completed' then coalesce(a.quoted_usd, 0) else 0 end as estimated,
           (a.cost_usd is null and a.quoted_usd is null and a.status = 'completed') as unpriced
      from all_runs a
  ),
  totals as (
    select 'total' as k, coalesce(sum(exact), 0) as exact, coalesce(sum(estimated), 0) as estimated,
           count(*) as runs, count(*) filter (where unpriced) as unpriced
      from priced
    union all
    select 'this_month', coalesce(sum(exact), 0), coalesce(sum(estimated), 0), count(*), count(*) filter (where unpriced)
      from priced where created_at >= date_trunc('month', now())
    union all
    select 'last_30_days', coalesce(sum(exact), 0), coalesce(sum(estimated), 0), count(*), count(*) filter (where unpriced)
      from priced where created_at >= now() - interval '30 days'
    union all
    select 'deleted', coalesce(sum(exact), 0), coalesce(sum(estimated), 0), count(*), count(*) filter (where unpriced)
      from priced where deleted
  )
  select jsonb_build_object(
    'totals', (select jsonb_object_agg(k, jsonb_build_object('exact', exact, 'estimated', estimated, 'runs', runs, 'unpriced', unpriced)) from totals),
    'by_provider', (
      select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'exact', exact, 'estimated', estimated, 'runs', runs, 'unpriced', unpriced)
                                order by exact + estimated desc), '[]'::jsonb)
        from (select provider, sum(exact) as exact, sum(estimated) as estimated, count(*) as runs, count(*) filter (where unpriced) as unpriced
                from priced group by provider) p
    ),
    'by_model', (
      select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'model', model_name, 'exact', exact, 'estimated', estimated, 'runs', runs)
                                order by exact + estimated desc), '[]'::jsonb)
        from (select provider, model_name, sum(exact) as exact, sum(estimated) as estimated, count(*) as runs
                from priced group by provider, model_name
               order by sum(exact) + sum(estimated) desc
               limit 15) m
    ),
    'by_month', (
      select coalesce(jsonb_agg(jsonb_build_object('month', month, 'exact', exact, 'estimated', estimated, 'runs', runs) order by month desc), '[]'::jsonb)
        from (select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, sum(exact) as exact, sum(estimated) as estimated, count(*) as runs
                from priced group by 1 order by 1 desc limit 12) mo
    )
  );
$$;

revoke execute on function public.spending_stats() from public, anon, authenticated;
grant execute on function public.spending_stats() to service_role;
