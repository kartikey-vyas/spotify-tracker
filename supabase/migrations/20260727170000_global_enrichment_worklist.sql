-- Make enrichment global rather than scoped to one user's play history.
--
-- `tracks` is shared metadata with no `user_id`, and enrich-backfill stamps
-- `tracks.last_refreshed_at` globally — but it was repointing events with
-- `.eq('user_id', …)` and drawing its worklist from a single user's plays. That
-- combination is a trap: once a second user has played a track this job
-- enriches, their `listening_events` keep null `album_id`/`primary_artist_id`
-- while the track reads as enriched, so it is excluded from every future
-- worklist. Their rollups would stay wrong with no repair path short of
-- manually nulling `last_refreshed_at`.
--
-- Inert while only one user has unenriched tracks, which is why it shipped, but
-- the fix is small and the failure is silent, so it should not wait for a
-- second user to arrive.
--
-- Dropping the user predicate also fixes the index. 20260727140000 led with
-- `user_id` precisely because the query filtered on it; with no filter, the
-- covering index for `max(played_at) group by track_id` is (track_id,
-- played_at desc) — the shape 20260727120000 originally created.

drop index if exists public.listening_events_user_track_played_at_idx;

create index if not exists listening_events_track_played_at_idx
  on public.listening_events (track_id, played_at desc);

-- Signature changes (p_user_id is gone), so the old overload must be dropped
-- rather than replaced, or both would resolve.
drop function if exists public.next_unenriched_tracks(uuid, integer);

create or replace function public.next_unenriched_tracks(batch_size integer default 30)
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
    where e.track_id is not null
      -- Archived legacy rows are hidden from every read path; enriching tracks
      -- only they reference would spend Spotify quota on invisible data.
      and e.archived_at is null
    group by e.track_id
  ) lp on lp.track_id = t.id
  where t.spotify_track_id is not null
    and t.last_refreshed_at is null
  order by lp.last_played desc
  limit batch_size;
$$;

revoke all on function public.next_unenriched_tracks(integer) from anon, authenticated;
grant execute on function public.next_unenriched_tracks(integer) to service_role;

notify pgrst, 'reload schema';
