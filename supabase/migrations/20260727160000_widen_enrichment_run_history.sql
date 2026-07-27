-- Widen the enrichment run history so /admin's 24-hour throughput is real.
--
-- The 50-row cap was sized when GitHub Actions fired 8 times a day. pg_cron now
-- fires 96 times a day, so 50 rows covers 12.5 hours — and `enrichedInWindow`
-- in src/lib/adminHealth.ts sums only the rows it is handed. The "in the last
-- 24h" figure would have silently truncated, and `projectedDaysRemaining`
-- divides by it, so the projected finish date would have read roughly double
-- the real one with nothing to indicate it was wrong.
--
-- 300 covers ~3 days at the current cadence. This number is coupled to the cron
-- schedule in 20260727130000: if that cadence rises, this has to rise with it,
-- or the 24h window silently truncates again.
--
-- The return type is unchanged, so the dependent view needs no rebuild.

create or replace function private.admin_enrichment_runs_rows()
returns table (
  id bigint,
  started_at timestamptz,
  finished_at timestamptz,
  trigger text,
  requested_limit integer,
  concurrency integer,
  worklist_size integer,
  enriched integer,
  missing integer,
  failed integer,
  aborted boolean,
  abort_retry_after_seconds integer,
  error text,
  duration_seconds integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with gate as (
    select private.current_user_is_admin() as ok
  )
  select
    r.id,
    r.started_at,
    r.finished_at,
    r.trigger,
    r.requested_limit,
    r.concurrency,
    r.worklist_size,
    r.enriched,
    r.missing,
    r.failed,
    r.aborted,
    r.abort_retry_after_seconds,
    r.error,
    case
      when r.finished_at is null then null
      else extract(epoch from (r.finished_at - r.started_at))::integer
    end as duration_seconds
  from gate g
  cross join public.enrichment_runs r
  where g.ok
  order by r.started_at desc
  limit 300;
$$;

revoke all on function private.admin_enrichment_runs_rows() from public, anon, authenticated;
grant execute on function private.admin_enrichment_runs_rows() to authenticated;

notify pgrst, 'reload schema';
