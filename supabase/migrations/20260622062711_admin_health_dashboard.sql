-- Imported verbatim from the production migration ledger (applied via the
-- Supabase dashboard). Captured into the repo to reconcile divergent history.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = (select auth.uid())
  );
$$;

revoke all on function private.current_user_is_admin() from public, anon, authenticated;
grant execute on function private.current_user_is_admin() to authenticated;

create or replace function private.admin_invite_status(
  use_count integer,
  max_uses integer,
  expires_at timestamptz,
  accepted_at timestamptz
)
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select case
    when expires_at is not null and expires_at <= now() and use_count < max_uses then 'expired'
    when use_count >= max_uses then 'exhausted'
    when accepted_at is not null then 'accepted'
    else 'pending'
  end;
$$;

revoke all on function private.admin_invite_status(integer, integer, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function private.admin_system_health_rows()
returns table (
  total_profiles integer,
  public_profile_count integer,
  private_profile_count integer,
  connected_user_count integer,
  sync_enabled_user_count integer,
  stale_sync_user_count integer,
  sync_error_user_count integer,
  total_invite_count integer,
  pending_invite_count integer,
  accepted_invite_count integer,
  expired_invite_count integer,
  exhausted_invite_count integer,
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
  invite_rows as (
    select private.admin_invite_status(use_count, max_uses, expires_at, accepted_at) as status
    from public.invite_codes
  ),
  invite_counts as (
    select
      count(*)::integer as total_invite_count,
      count(*) filter (where status = 'pending')::integer as pending_invite_count,
      count(*) filter (where status = 'accepted')::integer as accepted_invite_count,
      count(*) filter (where status = 'expired')::integer as expired_invite_count,
      count(*) filter (where status = 'exhausted')::integer as exhausted_invite_count
    from invite_rows
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
    ic.total_invite_count,
    ic.pending_invite_count,
    ic.accepted_invite_count,
    ic.expired_invite_count,
    ic.exhausted_invite_count,
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
  cross join invite_counts ic
  cross join catalog_counts cat
  cross join metadata_state ms
  cross join cron_summary cs
  where g.ok;
$$;

revoke all on function private.admin_system_health_rows() from public, anon, authenticated;
grant execute on function private.admin_system_health_rows() to authenticated;

drop view if exists public.admin_user_health;
drop function if exists private.admin_user_health_rows();

create or replace function private.admin_user_health_rows()
returns table (
  user_id uuid,
  slug text,
  display_name text,
  is_public boolean,
  onboarding_completed_at timestamptz,
  onboarding_state text,
  spotify_connected boolean,
  spotify_user_id text,
  spotify_display_name text,
  sync_enabled boolean,
  connected_at timestamptz,
  connection_last_error_at timestamptz,
  connection_last_error text,
  recently_played_last_success_at timestamptz,
  recently_played_last_error_at timestamptz,
  recently_played_last_error text,
  recently_played_gap_risk boolean,
  latest_exact_export_event_at timestamptz,
  api_only_period_start timestamptz,
  latest_stored_event_at timestamptz,
  exact_play_count integer,
  api_play_count integer,
  total_play_count integer,
  overview_generated_at timestamptz,
  latest_rollup_updated_at timestamptz
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
    p.user_id,
    p.slug,
    p.display_name,
    p.is_public,
    p.onboarding_completed_at,
    case when p.onboarding_completed_at is null then 'pending' else 'complete' end as onboarding_state,
    (c.user_id is not null) as spotify_connected,
    c.spotify_user_id,
    c.spotify_display_name,
    coalesce(c.sync_enabled, false) as sync_enabled,
    c.connected_at,
    c.last_error_at as connection_last_error_at,
    c.last_error as connection_last_error,
    s.recently_played_last_success_at,
    s.recently_played_last_error_at,
    s.recently_played_last_error,
    coalesce(s.recently_played_gap_risk, false) as recently_played_gap_risk,
    s.latest_exact_export_event_at,
    s.api_only_period_start,
    events.latest_stored_event_at,
    events.exact_play_count,
    events.api_play_count,
    events.total_play_count,
    oc.generated_at as overview_generated_at,
    rollups.latest_rollup_updated_at
  from gate g
  cross join public.profiles p
  left join public.spotify_connections c on c.user_id = p.user_id
  left join public.sync_state s on s.user_id = p.user_id
  left join public.overview_cache oc
    on oc.user_id = p.user_id
   and oc.key = 'public_home:' || p.user_id::text
   and oc.archived_at is null
  left join lateral (
    select
      max(e.played_at) as latest_stored_event_at,
      count(*) filter (where e.data_quality = 1)::integer as exact_play_count,
      count(*) filter (where e.source = 2 or e.data_quality = 2)::integer as api_play_count,
      count(*)::integer as total_play_count
    from public.listening_events e
    where e.user_id = p.user_id
      and e.archived_at is null
  ) events on true
  left join lateral (
    select max(r.updated_at) as latest_rollup_updated_at
    from public.rollup_daily_entity_stats r
    where r.user_id = p.user_id
      and r.archived_at is null
  ) rollups on true
  where g.ok
  order by lower(p.display_name), p.slug;
$$;

revoke all on function private.admin_user_health_rows() from public, anon, authenticated;
grant execute on function private.admin_user_health_rows() to authenticated;

create or replace function private.admin_invite_health_rows()
returns table (
  label text,
  created_at timestamptz,
  expires_at timestamptz,
  last_used_at timestamptz,
  accepted_at timestamptz,
  accepted_email text,
  accepted_user_id uuid,
  use_count integer,
  max_uses integer,
  status text
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
    i.label,
    i.created_at,
    i.expires_at,
    i.last_used_at,
    i.accepted_at,
    i.accepted_email,
    i.accepted_user_id,
    i.use_count,
    i.max_uses,
    private.admin_invite_status(i.use_count, i.max_uses, i.expires_at, i.accepted_at) as status
  from gate g
  cross join public.invite_codes i
  where g.ok
  order by i.created_at desc;
$$;

revoke all on function private.admin_invite_health_rows() from public, anon, authenticated;
grant execute on function private.admin_invite_health_rows() to authenticated;

create or replace view public.admin_system_health
with (security_invoker = true)
as
select * from private.admin_system_health_rows();

create or replace view public.admin_user_health
with (security_invoker = true)
as
select * from private.admin_user_health_rows();

create or replace view public.admin_invite_health
with (security_invoker = true)
as
select * from private.admin_invite_health_rows();

revoke all on table
  public.admin_system_health,
  public.admin_user_health,
  public.admin_invite_health
from anon, authenticated;

grant select on table
  public.admin_system_health,
  public.admin_user_health,
  public.admin_invite_health
to authenticated;

drop policy if exists "Admins read all profiles" on public.profiles;
drop policy if exists "Admins read all sync state" on public.sync_state;

notify pgrst, 'reload schema';
