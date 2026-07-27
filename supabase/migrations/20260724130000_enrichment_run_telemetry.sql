-- Persist what each `enrich:backfill` run actually achieved, so the Spotify
-- rate limit can be dialled in from data instead of guesswork.
--
-- Until now a run's outcome existed only in whichever terminal or Actions log
-- it happened to print to. The daily-cap abort (a 429 whose retry-after exceeds
-- MAX_RETRY_AFTER_SECONDS in scripts/lib/spotify.ts) carries the single most
-- useful number for scheduling — how long Spotify says to wait — and it was
-- being discarded. Recording it per run turns "roughly 100 a day" into a
-- schedule you can reason about.

create table if not exists public.enrichment_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- 'schedule' (GitHub Actions cron), 'manual' (workflow_dispatch), 'local'.
  trigger text not null default 'local',
  requested_limit integer,
  concurrency integer not null,
  worklist_size integer,
  enriched integer not null default 0,
  missing integer not null default 0,
  failed integer not null default 0,
  aborted boolean not null default false,
  -- Spotify's retry-after on the abort, in seconds. The cap-reset signal.
  abort_retry_after_seconds integer,
  error text
);

create index if not exists enrichment_runs_started_at_idx
  on public.enrichment_runs (started_at desc);

alter table public.enrichment_runs enable row level security;

-- Service-key writes only; admins read through the security-definer view below.
revoke all on table public.enrichment_runs from anon, authenticated;
grant select, insert, update on table public.enrichment_runs to service_role;

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
  limit 50;
$$;

revoke all on function private.admin_enrichment_runs_rows() from public, anon, authenticated;
grant execute on function private.admin_enrichment_runs_rows() to authenticated;

create or replace view public.admin_enrichment_runs
with (security_invoker = true)
as
select * from private.admin_enrichment_runs_rows();

revoke all on table public.admin_enrichment_runs from anon, authenticated;
grant select on table public.admin_enrichment_runs to authenticated;

notify pgrst, 'reload schema';
