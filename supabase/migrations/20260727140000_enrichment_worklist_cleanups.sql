-- Follow-ups to 20260727120000, which is already applied and so cannot be
-- edited in place.
--
-- 1. The index added there, (track_id, played_at desc), cannot serve
--    next_unenriched_tracks: that query filters on user_id, which the index
--    does not carry, so every candidate entry needs a heap fetch just to test
--    the predicate — the opposite of the index-only scan its comment claimed.
--    Leading with user_id makes it genuinely covering.
-- 2. drain_rollup_refresh_queue picked its user, then re-queried for that
--    user's dates, then deleted them in a third statement, guarding against a
--    null aggregate that the primary key makes unreachable. One CTE does the
--    same work in a single scan, and dequeues atomically with the refresh: if
--    refresh_user_public_stats raises, the delete rolls back with it and the
--    dates stay queued instead of being silently dropped.
-- 3. next_unenriched_tracks clamped its limit with greatest(batch_size, 0)
--    while the drain used greatest(batch_size, 1) — two different meanings for
--    batch_size = 0, neither reachable from any caller.

drop index if exists public.listening_events_track_played_at_idx;

create index if not exists listening_events_user_track_played_at_idx
  on public.listening_events (user_id, track_id, played_at desc);

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
  limit batch_size;
$$;

revoke all on function public.next_unenriched_tracks(uuid, integer) from anon, authenticated;
grant execute on function public.next_unenriched_tracks(uuid, integer) to service_role;

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
  with picked as (
    select q.user_id, q.local_date
      from public.rollup_refresh_queue q
     where q.user_id = (
             select user_id
               from public.rollup_refresh_queue
              order by queued_at
              limit 1
           )
     order by q.queued_at
     limit batch_size
  ),
  dequeued as (
    delete from public.rollup_refresh_queue q
     using picked p
     where q.user_id = p.user_id
       and q.local_date = p.local_date
    returning q.user_id, q.local_date
  )
  select d.user_id, array_agg(d.local_date)
    into v_user, v_dates
    from dequeued d
   group by d.user_id;

  if v_user is null then
    return 0;
  end if;

  perform public.refresh_user_public_stats(v_user, v_dates);

  return array_length(v_dates, 1);
end;
$$;

revoke all on function public.drain_rollup_refresh_queue(integer) from anon, authenticated;
grant execute on function public.drain_rollup_refresh_queue(integer) to service_role;

notify pgrst, 'reload schema';
