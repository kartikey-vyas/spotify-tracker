-- Move metadata enrichment off GitHub Actions and into the database's own
-- scheduler. Two things stop the Node script from being lifted verbatim into an
-- edge function, and this migration provides the replacement for both.
--
-- 1. Worklist ordering. `loadRecencyOrder()` pages through every one of the
--    user's ~101k listening events to sort unenriched tracks by last play. That
--    is fine on a laptop and fatal inside a function with a wall-clock budget,
--    so the ordering moves into SQL where it is one aggregate.
--
-- 2. Rollup refresh. A 40-track batch produced 367 affected dates on
--    2026-07-26, and refreshing them in a single 300-date call exceeded the
--    statement timeout — the tracks enriched, then the job failed and those
--    dates were left stale. Dates now go onto a queue that a separate, smaller
--    cron drains, so enrichment throughput and rollup cost are decoupled.

-- Makes the max(played_at) per track an index-only scan rather than a heap
-- lookup per row. listening_events_track_idx covers track_id alone.
create index if not exists listening_events_track_played_at_idx
  on public.listening_events (track_id, played_at desc);

-- Recency-ordered slice of the enrichment worklist. Mirrors the predicate in
-- loadUnenrichedTracks() plus the ordering from orderUnenrichedByRecency().
create or replace function public.next_unenriched_tracks(
  p_user_id uuid,
  batch_size integer default 30
)
returns table (
  id bigint,
  spotify_track_id text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select t.id, t.spotify_track_id
  from public.tracks t
  join (
    select e.track_id, max(e.played_at) as last_played
    from public.listening_events e
    where e.user_id = p_user_id
      and e.track_id is not null
    group by e.track_id
  ) lp on lp.track_id = t.id
  where t.spotify_track_id is not null
    and t.last_refreshed_at is null
  order by lp.last_played desc
  limit greatest(batch_size, 0);
$$;

revoke all on function public.next_unenriched_tracks(uuid, integer) from anon, authenticated;
grant execute on function public.next_unenriched_tracks(uuid, integer) to service_role;

-- Dates whose rollups are stale because enrichment repointed their events.
create table if not exists public.rollup_refresh_queue (
  user_id uuid not null,
  local_date date not null,
  queued_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

create index if not exists rollup_refresh_queue_queued_at_idx
  on public.rollup_refresh_queue (queued_at);

alter table public.rollup_refresh_queue enable row level security;

revoke all on table public.rollup_refresh_queue from anon, authenticated;
grant select, insert, update, delete on table public.rollup_refresh_queue to service_role;

-- Refreshes one user's oldest queued dates and removes them. Returns how many
-- were processed so a caller can tell a drained queue (0) from more work.
-- Deliberately handles a single user per call: refresh_user_public_stats is
-- per-user, and keeping each call small is the entire point of the queue.
create or replace function public.drain_rollup_refresh_queue(batch_size integer default 50)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid;
  v_dates date[];
begin
  select user_id
    into v_user
    from public.rollup_refresh_queue
   order by queued_at
   limit 1;

  if v_user is null then
    return 0;
  end if;

  select array_agg(local_date)
    into v_dates
    from (
      select local_date
        from public.rollup_refresh_queue
       where user_id = v_user
       order by queued_at
       limit greatest(batch_size, 1)
    ) s;

  if v_dates is null then
    return 0;
  end if;

  perform public.refresh_user_public_stats(v_user, v_dates);

  delete from public.rollup_refresh_queue
   where user_id = v_user
     and local_date = any(v_dates);

  return coalesce(array_length(v_dates, 1), 0);
end;
$$;

revoke all on function public.drain_rollup_refresh_queue(integer) from anon, authenticated;
grant execute on function public.drain_rollup_refresh_queue(integer) to service_role;

notify pgrst, 'reload schema';
