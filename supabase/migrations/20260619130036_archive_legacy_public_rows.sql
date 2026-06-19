alter table public.listening_events
  add column if not exists archived_at timestamptz;

alter table public.rollup_daily_entity_stats
  add column if not exists archived_at timestamptz;

alter table public.overview_cache
  add column if not exists archived_at timestamptz;

alter table public.public_activity_recent
  add column if not exists archived_at timestamptz;

alter table public.sync_state
  add column if not exists archived_at timestamptz;

update public.profiles
set is_public = true,
    updated_at = now()
where slug = 'kartikey'
  and is_public = false;

update public.listening_events
set archived_at = now()
where user_id is null
  and archived_at is null;

update public.rollup_daily_entity_stats
set archived_at = now()
where user_id is null
  and archived_at is null;

update public.overview_cache
set archived_at = now()
where user_id is null
  and archived_at is null;

update public.public_activity_recent
set archived_at = now()
where user_id is null
  and archived_at is null;

update public.sync_state
set archived_at = now()
where user_id is null
  and archived_at is null;

create or replace view public_profile_overview
with (security_invoker = true)
as
select
  p.user_id,
  p.slug,
  p.display_name,
  p.is_public,
  oc.payload,
  oc.generated_at
from profiles p
join overview_cache oc on oc.user_id = p.user_id
where p.is_public = true
  and oc.archived_at is null
  and oc.key = 'public_home:' || p.user_id::text;

create or replace view public_profile_rollup_daily_entity_stats
with (security_invoker = true)
as
select
  p.slug,
  p.display_name,
  r.local_date,
  r.entity_type,
  r.entity_id,
  r.entity_name,
  r.minutes_exact,
  r.minutes_inferred,
  r.plays,
  r.qualified_plays,
  r.unique_tracks,
  r.skipped_count,
  r.known_skip_count,
  r.unknown_duration_plays,
  r.updated_at
from profiles p
join rollup_daily_entity_stats r on r.user_id = p.user_id
where p.is_public = true
  and r.archived_at is null;

create or replace view public_profile_activity_recent
with (security_invoker = true)
as
select
  p.slug,
  p.display_name,
  a.id,
  a.played_at,
  a.local_date,
  a.track_id,
  a.track_name,
  a.artist_id,
  a.artist_name,
  a.album_id,
  a.album_name,
  a.source,
  a.data_quality,
  a.context_uri,
  a.context_type
from profiles p
join public_activity_recent a on a.user_id = p.user_id
where p.is_public = true
  and a.archived_at is null;

create or replace function public.refresh_overview_cache()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- The anonymous public_home feed is archived; connected profiles use
  -- refresh_user_overview_cache(user_id) instead.
  return;
end;
$$;

create or replace function public.refresh_public_stats(target_dates date[] default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- The anonymous public_home feed is archived; connected profiles use
  -- refresh_user_public_stats(user_id, target_dates) instead.
  return;
end;
$$;

drop policy if exists "Users and public profiles read rollups" on rollup_daily_entity_stats;
create policy "Users and public profiles read rollups"
  on rollup_daily_entity_stats for select
  to anon, authenticated
  using (
    (user_id is null and archived_at is null)
    or user_id = (select auth.uid())
    or exists (
      select 1
      from profiles p
      where p.user_id = rollup_daily_entity_stats.user_id
        and p.is_public = true
        and rollup_daily_entity_stats.archived_at is null
    )
  );

drop policy if exists "Users and public profiles read overview cache" on overview_cache;
create policy "Users and public profiles read overview cache"
  on overview_cache for select
  to anon, authenticated
  using (
    (user_id is null and archived_at is null)
    or user_id = (select auth.uid())
    or exists (
      select 1
      from profiles p
      where p.user_id = overview_cache.user_id
        and p.is_public = true
        and overview_cache.archived_at is null
    )
  );

drop policy if exists "Users and public profiles read recent activity" on public_activity_recent;
create policy "Users and public profiles read recent activity"
  on public_activity_recent for select
  to anon, authenticated
  using (
    (user_id is null and archived_at is null)
    or user_id = (select auth.uid())
    or exists (
      select 1
      from profiles p
      where p.user_id = public_activity_recent.user_id
        and p.is_public = true
        and public_activity_recent.archived_at is null
    )
  );
