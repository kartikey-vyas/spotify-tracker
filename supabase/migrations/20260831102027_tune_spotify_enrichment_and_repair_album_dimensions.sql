-- Tune Spotify enrichment from measured production capacity, repair historical
-- event dimensions, and expose artwork coverage that reflects what the app
-- actually renders rather than every orphaned fallback album row.

-- Production has settled at twenty successful 30-track batches per day before
-- Spotify returns a long Retry-After. Twelve evenly spaced batches retain 40%
-- headroom while exceeding recent unique-track arrivals by several times.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'enrich-backfill'),
  schedule := '0 */2 * * *'
);

-- Canonicalize event dimensions from the shared track row. Both the recently
-- played sync and the export importer call this after resolving a track, so a
-- track that Spotify has already enriched cannot leave historical events on a
-- name-only fallback album. Return distinct active user/date pairs so callers
-- can refresh exactly the rollups made stale by the repair.
create or replace function public.repoint_listening_events_from_tracks(
  p_track_ids bigint[],
  p_user_id uuid default null
)
returns table (
  affected_user_id uuid,
  affected_local_date date
)
language sql
volatile
security invoker
set search_path = public, pg_catalog
as $$
  with canonical as (
    select
      t.id as track_id,
      t.album_id,
      primary_artist.artist_id as primary_artist_id
    from public.tracks t
    left join lateral (
      select ta.artist_id
      from public.track_artists ta
      join public.artists ar on ar.id = ta.artist_id
      where ta.track_id = t.id
      order by
        ta.artist_order,
        (ar.spotify_artist_id is not null) desc,
        ta.artist_id
      limit 1
    ) primary_artist on true
    where t.id = any(p_track_ids)
  ),
  updated as (
    update public.listening_events e
    set
      album_id = canonical.album_id,
      primary_artist_id = canonical.primary_artist_id
    from canonical
    where e.track_id = canonical.track_id
      and (p_user_id is null or e.user_id = p_user_id)
      and (
        e.album_id is distinct from canonical.album_id
        or e.primary_artist_id is distinct from canonical.primary_artist_id
      )
    returning e.user_id, e.local_date, e.archived_at
  )
  select distinct
    updated.user_id as affected_user_id,
    updated.local_date as affected_local_date
  from updated
  where updated.user_id is not null
    and updated.archived_at is null;
$$;

revoke all on function public.repoint_listening_events_from_tracks(bigint[], uuid)
  from public, anon, authenticated;
grant execute on function public.repoint_listening_events_from_tracks(bigint[], uuid)
  to service_role;

-- Repair current rows once. Rollups are queued rather than rebuilt inside this
-- migration: the queue exists specifically to keep large historical refreshes
-- below the statement timeout.
insert into public.rollup_refresh_queue (user_id, local_date)
select repaired.affected_user_id, repaired.affected_local_date
from public.repoint_listening_events_from_tracks(
  array(select id from public.tracks order by id),
  null
) repaired
on conflict (user_id, local_date) do nothing;

-- Adding artwork columns changes the return type, so rebuild the gated helper
-- and dependent security-invoker view. The raw missing count remains available
-- as a catalog diagnostic; the new counts describe track references and actual
-- non-archived listening events.
drop view if exists public.admin_system_health;
drop function if exists private.admin_system_health_rows();

create function private.admin_system_health_rows()
returns table (
  total_profiles integer,
  public_profile_count integer,
  private_profile_count integer,
  connected_user_count integer,
  sync_enabled_user_count integer,
  stale_sync_user_count integer,
  sync_error_user_count integer,
  artist_count integer,
  album_count integer,
  track_count integer,
  tracks_enriched integer,
  tracks_unenriched integer,
  tracks_missing_duration integer,
  albums_missing_image integer,
  albums_referenced_by_tracks integer,
  referenced_albums_missing_image integer,
  active_listening_event_count integer,
  active_events_missing_album_image integer,
  artists_stale_or_unrefreshed integer,
  metadata_last_success_at timestamptz,
  metadata_last_error_at timestamptz,
  metadata_last_error text,
  cron_job_active boolean,
  cron_last_run_at timestamptz,
  cron_last_status text,
  cron_last_success_at timestamptz,
  cron_recent_failures integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with gate as (
    select private.current_user_is_admin() as ok
  ),
  profile_counts as (
    select
      count(*)::integer as total_profiles,
      count(*) filter (where is_public)::integer as public_profile_count,
      count(*) filter (where not is_public)::integer as private_profile_count
    from public.profiles
  ),
  connection_counts as (
    select
      count(*)::integer as connected_user_count,
      count(*) filter (where c.sync_enabled)::integer as sync_enabled_user_count,
      count(*) filter (
        where c.sync_enabled
          and (
            s.recently_played_last_success_at is null
            or s.recently_played_last_success_at < now() - interval '60 minutes'
          )
      )::integer as stale_sync_user_count,
      count(*) filter (
        where c.sync_enabled
          and (
            s.recently_played_last_error_at is not null
            or c.last_error_at is not null
          )
      )::integer as sync_error_user_count
    from public.spotify_connections c
    left join public.sync_state s on s.user_id = c.user_id
  ),
  catalog_counts as (
    select
      (select count(*)::integer from public.artists) as artist_count,
      (select count(*)::integer from public.albums) as album_count,
      (select count(*)::integer from public.tracks) as track_count,
      (
        select count(*)::integer
        from public.tracks
        where spotify_track_id is not null
          and last_refreshed_at is not null
      ) as tracks_enriched,
      (
        select count(*)::integer
        from public.tracks
        where spotify_track_id is not null
          and last_refreshed_at is null
      ) as tracks_unenriched,
      (select count(*)::integer from public.tracks where duration_ms is null) as tracks_missing_duration,
      (
        select count(*)::integer
        from public.albums
        where nullif(btrim(image_url), '') is null
      ) as albums_missing_image,
      (
        select count(distinct t.album_id)::integer
        from public.tracks t
        where t.album_id is not null
      ) as albums_referenced_by_tracks,
      (
        select count(distinct t.album_id)::integer
        from public.tracks t
        join public.albums al on al.id = t.album_id
        where nullif(btrim(al.image_url), '') is null
      ) as referenced_albums_missing_image,
      (
        select count(*)::integer
        from public.listening_events e
        where e.archived_at is null
      ) as active_listening_event_count,
      (
        select count(*)::integer
        from public.listening_events e
        left join public.albums al on al.id = e.album_id
        where e.archived_at is null
          and nullif(btrim(al.image_url), '') is null
      ) as active_events_missing_album_image,
      (
        select count(*)::integer
        from public.artists
        where last_refreshed_at is null
          or last_refreshed_at < now() - interval '90 days'
      ) as artists_stale_or_unrefreshed
  ),
  metadata_state as (
    select
      max(metadata_last_success_at) as metadata_last_success_at,
      max(metadata_last_error_at) as metadata_last_error_at,
      (array_agg(metadata_last_error order by metadata_last_error_at desc nulls last))[1] as metadata_last_error
    from public.sync_state
  ),
  cron_runs as (
    select
      d.start_time,
      d.end_time,
      d.status
    from cron.job j
    left join cron.job_run_details d on d.jobid = j.jobid
    where j.jobname = 'sync-due-users'
  ),
  cron_latest as (
    select
      coalesce(end_time, start_time) as cron_last_run_at,
      status as cron_last_status
    from cron_runs
    where start_time is not null
    order by start_time desc
    limit 1
  ),
  cron_summary as (
    select
      exists (
        select 1
        from cron.job
        where jobname = 'sync-due-users'
          and active
      ) as cron_job_active,
      (select cron_last_run_at from cron_latest) as cron_last_run_at,
      (select cron_last_status from cron_latest) as cron_last_status,
      max(coalesce(end_time, start_time)) filter (where status = 'succeeded') as cron_last_success_at,
      count(*) filter (
        where start_time >= now() - interval '24 hours'
          and coalesce(status, '') <> 'succeeded'
      )::integer as cron_recent_failures
    from cron_runs
  )
  select
    pc.total_profiles,
    pc.public_profile_count,
    pc.private_profile_count,
    cc.connected_user_count,
    cc.sync_enabled_user_count,
    cc.stale_sync_user_count,
    cc.sync_error_user_count,
    cat.artist_count,
    cat.album_count,
    cat.track_count,
    cat.tracks_enriched,
    cat.tracks_unenriched,
    cat.tracks_missing_duration,
    cat.albums_missing_image,
    cat.albums_referenced_by_tracks,
    cat.referenced_albums_missing_image,
    cat.active_listening_event_count,
    cat.active_events_missing_album_image,
    cat.artists_stale_or_unrefreshed,
    ms.metadata_last_success_at,
    ms.metadata_last_error_at,
    ms.metadata_last_error,
    cs.cron_job_active,
    cs.cron_last_run_at,
    cs.cron_last_status,
    cs.cron_last_success_at,
    cs.cron_recent_failures
  from gate g
  cross join profile_counts pc
  cross join connection_counts cc
  cross join catalog_counts cat
  cross join metadata_state ms
  cross join cron_summary cs
  where g.ok;
$$;

revoke all on function private.admin_system_health_rows() from public, anon, authenticated;
grant execute on function private.admin_system_health_rows() to authenticated;

create view public.admin_system_health
with (security_invoker = true)
as
select * from private.admin_system_health_rows();

revoke all on table public.admin_system_health from anon, authenticated;
grant select on table public.admin_system_health to authenticated;

notify pgrst, 'reload schema';
