-- Remove the dormant invite_codes table and its admin-dashboard surface.
-- Password + email-invite auth no longer uses invite codes; no inbound FKs
-- reference invite_codes, and the only readers were these admin views.

-- 1. Drop the invite health view + its backing function.
drop view if exists public.admin_invite_health;
drop function if exists private.admin_invite_health_rows();

-- 2. Drop the system health view + function so the function's return signature
--    can change (a function's OUT columns cannot be altered by replace).
drop view if exists public.admin_system_health;
drop function if exists private.admin_system_health_rows();

-- 3. Recreate system health WITHOUT the five invite-count columns.
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
  tracks_missing_duration integer,
  albums_missing_image integer,
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
      (select count(*)::integer from public.tracks where duration_ms is null) as tracks_missing_duration,
      (select count(*)::integer from public.albums where image_url is null) as albums_missing_image,
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
    cat.tracks_missing_duration,
    cat.albums_missing_image,
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

-- 4. Drop the now-unused invite status helper.
drop function if exists private.admin_invite_status(integer, integer, timestamptz, timestamptz);

-- 5. Drop the table itself (RLS policies drop with it).
drop table if exists public.invite_codes;

notify pgrst, 'reload schema';
