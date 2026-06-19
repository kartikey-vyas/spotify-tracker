create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slug text not null unique,
  display_name text not null,
  is_public boolean not null default false,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_slug_format_check
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
);

create table if not exists invite_codes (
  code_hash text primary key,
  label text,
  max_uses integer not null default 1,
  use_count integer not null default 0,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),

  constraint invite_codes_max_uses_check check (max_uses > 0),
  constraint invite_codes_use_count_check check (use_count >= 0 and use_count <= max_uses)
);

create table if not exists spotify_connections (
  user_id uuid primary key references profiles(user_id) on delete cascade,
  spotify_user_id text,
  spotify_display_name text,
  scopes text[] not null default array[]::text[],
  refresh_token_ciphertext text not null,
  refresh_token_nonce text not null,
  token_encrypted_at timestamptz not null default now(),
  sync_enabled boolean not null default true,
  connected_at timestamptz not null default now(),
  last_token_refresh_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create unique index if not exists spotify_connections_spotify_user_uidx
  on spotify_connections (spotify_user_id)
  where spotify_user_id is not null;

create table if not exists spotify_oauth_states (
  state_hash text primary key,
  user_id uuid not null references profiles(user_id) on delete cascade,
  redirect_to text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists spotify_oauth_states_user_idx
  on spotify_oauth_states (user_id);

create index if not exists spotify_oauth_states_expires_idx
  on spotify_oauth_states (expires_at);

alter table listening_events
  add column if not exists user_id uuid references profiles(user_id) on delete cascade;

alter table rollup_daily_entity_stats
  add column if not exists user_id uuid references profiles(user_id) on delete cascade;

alter table sync_state
  add column if not exists user_id uuid references profiles(user_id) on delete cascade;

alter table overview_cache
  add column if not exists user_id uuid references profiles(user_id) on delete cascade;

alter table public_activity_recent
  add column if not exists user_id uuid references profiles(user_id) on delete cascade;

alter table listening_events
  drop constraint if exists listening_events_source_event_key_key;

alter table rollup_daily_entity_stats
  drop constraint if exists rollup_daily_entity_stats_pkey;

alter table sync_state
  drop constraint if exists sync_state_singleton;

alter table sync_state
  drop constraint if exists sync_state_pkey;

create unique index if not exists listening_events_user_source_event_key_uidx
  on listening_events (user_id, source_event_key)
  where user_id is not null;

create unique index if not exists listening_events_user_source_event_key_all_uidx
  on listening_events (user_id, source_event_key);

create unique index if not exists listening_events_legacy_source_event_key_uidx
  on listening_events (source_event_key)
  where user_id is null;

create index if not exists listening_events_user_played_at_idx
  on listening_events (user_id, played_at desc);

create index if not exists listening_events_user_local_date_idx
  on listening_events (user_id, local_date);

create index if not exists listening_events_user_artist_idx
  on listening_events (user_id, primary_artist_id);

create unique index if not exists rollup_daily_entity_stats_user_day_entity_uidx
  on rollup_daily_entity_stats (user_id, local_date, entity_type, entity_id)
  where user_id is not null;

create unique index if not exists rollup_daily_entity_stats_legacy_day_entity_uidx
  on rollup_daily_entity_stats (local_date, entity_type, entity_id)
  where user_id is null;

create index if not exists rollup_daily_entity_stats_user_entity_date_idx
  on rollup_daily_entity_stats (user_id, entity_type, local_date);

create index if not exists rollup_daily_entity_stats_user_entity_id_idx
  on rollup_daily_entity_stats (user_id, entity_id);

create unique index if not exists sync_state_user_id_uidx
  on sync_state (user_id)
  where user_id is not null;

create unique index if not exists sync_state_user_id_all_uidx
  on sync_state (user_id);

create unique index if not exists sync_state_legacy_singleton_uidx
  on sync_state ((1))
  where user_id is null;

create index if not exists overview_cache_user_key_idx
  on overview_cache (user_id, key);

create index if not exists public_activity_recent_user_played_at_idx
  on public_activity_recent (user_id, played_at desc);

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
where p.is_public = true;

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
where p.is_public = true;

create or replace function public.refresh_rollups(target_dates date[] default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  dates_to_refresh date[];
begin
  if target_dates is null then
    select coalesce(array_agg(distinct local_date), array[]::date[])
    into dates_to_refresh
    from listening_events
    where user_id is null;
  else
    dates_to_refresh := target_dates;
  end if;

  delete from rollup_daily_entity_stats
  where user_id is null
    and (target_dates is null or local_date = any(dates_to_refresh));

  insert into rollup_daily_entity_stats (
    user_id,
    local_date,
    entity_type,
    entity_id,
    entity_name,
    minutes_exact,
    minutes_inferred,
    plays,
    qualified_plays,
    unique_tracks,
    skipped_count,
    known_skip_count,
    unknown_duration_plays
  )
  select
    null::uuid,
    e.local_date,
    'artist',
    e.primary_artist_id::text,
    a.name,
    sum(coalesce(e.ms_played, 0))::numeric / 60000,
    sum(coalesce(e.inferred_ms_played, 0))::numeric / 60000,
    count(*)::integer,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000),
    count(distinct e.track_id)::integer,
    count(*) filter (where e.skipped is true),
    count(e.skipped)::integer,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)
  from listening_events e
  join artists a on a.id = e.primary_artist_id
  where e.user_id is null
    and e.primary_artist_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, e.primary_artist_id, a.name;

  insert into rollup_daily_entity_stats (
    user_id,
    local_date,
    entity_type,
    entity_id,
    entity_name,
    minutes_exact,
    minutes_inferred,
    plays,
    qualified_plays,
    unique_tracks,
    skipped_count,
    known_skip_count,
    unknown_duration_plays
  )
  select
    null::uuid,
    e.local_date,
    'track',
    e.track_id::text,
    t.name,
    sum(coalesce(e.ms_played, 0))::numeric / 60000,
    sum(coalesce(e.inferred_ms_played, 0))::numeric / 60000,
    count(*)::integer,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000),
    count(distinct e.track_id)::integer,
    count(*) filter (where e.skipped is true),
    count(e.skipped)::integer,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)
  from listening_events e
  join tracks t on t.id = e.track_id
  where e.user_id is null
    and e.track_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, e.track_id, t.name;

  insert into rollup_daily_entity_stats (
    user_id,
    local_date,
    entity_type,
    entity_id,
    entity_name,
    minutes_exact,
    minutes_inferred,
    plays,
    qualified_plays,
    unique_tracks,
    skipped_count,
    known_skip_count,
    unknown_duration_plays
  )
  select
    null::uuid,
    e.local_date,
    'album',
    e.album_id::text,
    al.name,
    sum(coalesce(e.ms_played, 0))::numeric / 60000,
    sum(coalesce(e.inferred_ms_played, 0))::numeric / 60000,
    count(*)::integer,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000),
    count(distinct e.track_id)::integer,
    count(*) filter (where e.skipped is true),
    count(e.skipped)::integer,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)
  from listening_events e
  join albums al on al.id = e.album_id
  where e.user_id is null
    and e.album_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, e.album_id, al.name;

  insert into rollup_daily_entity_stats (
    user_id,
    local_date,
    entity_type,
    entity_id,
    entity_name,
    minutes_exact,
    minutes_inferred,
    plays,
    qualified_plays,
    unique_tracks,
    skipped_count,
    known_skip_count,
    unknown_duration_plays
  )
  select
    null::uuid,
    e.local_date,
    'genre',
    ag.genre,
    ag.genre,
    sum(coalesce(e.ms_played, 0)::numeric / nullif(gc.genre_count, 0)) / 60000,
    sum(coalesce(e.inferred_ms_played, 0)::numeric / nullif(gc.genre_count, 0)) / 60000,
    count(*)::integer,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000),
    count(distinct e.track_id)::integer,
    count(*) filter (where e.skipped is true),
    count(e.skipped)::integer,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)
  from listening_events e
  join artist_genres ag on ag.artist_id = e.primary_artist_id
  join (
    select artist_id, count(*)::numeric as genre_count
    from artist_genres
    group by artist_id
  ) gc on gc.artist_id = e.primary_artist_id
  where e.user_id is null
    and e.primary_artist_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, ag.genre;
end;
$$;

create or replace function public.refresh_user_rollups(p_user_id uuid, target_dates date[] default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  dates_to_refresh date[];
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if target_dates is null then
    select coalesce(array_agg(distinct local_date), array[]::date[])
    into dates_to_refresh
    from listening_events
    where user_id = p_user_id;
  else
    dates_to_refresh := target_dates;
  end if;

  delete from rollup_daily_entity_stats
  where user_id = p_user_id
    and (target_dates is null or local_date = any(dates_to_refresh));

  insert into rollup_daily_entity_stats (
    user_id,
    local_date,
    entity_type,
    entity_id,
    entity_name,
    minutes_exact,
    minutes_inferred,
    plays,
    qualified_plays,
    unique_tracks,
    skipped_count,
    known_skip_count,
    unknown_duration_plays
  )
  select
    p_user_id,
    e.local_date,
    'artist',
    e.primary_artist_id::text,
    a.name,
    sum(coalesce(e.ms_played, 0))::numeric / 60000,
    sum(coalesce(e.inferred_ms_played, 0))::numeric / 60000,
    count(*)::integer,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000),
    count(distinct e.track_id)::integer,
    count(*) filter (where e.skipped is true),
    count(e.skipped)::integer,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)
  from listening_events e
  join artists a on a.id = e.primary_artist_id
  where e.user_id = p_user_id
    and e.primary_artist_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, e.primary_artist_id, a.name;

  insert into rollup_daily_entity_stats (
    user_id,
    local_date,
    entity_type,
    entity_id,
    entity_name,
    minutes_exact,
    minutes_inferred,
    plays,
    qualified_plays,
    unique_tracks,
    skipped_count,
    known_skip_count,
    unknown_duration_plays
  )
  select
    p_user_id,
    e.local_date,
    'track',
    e.track_id::text,
    t.name,
    sum(coalesce(e.ms_played, 0))::numeric / 60000,
    sum(coalesce(e.inferred_ms_played, 0))::numeric / 60000,
    count(*)::integer,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000),
    count(distinct e.track_id)::integer,
    count(*) filter (where e.skipped is true),
    count(e.skipped)::integer,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)
  from listening_events e
  join tracks t on t.id = e.track_id
  where e.user_id = p_user_id
    and e.track_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, e.track_id, t.name;

  insert into rollup_daily_entity_stats (
    user_id,
    local_date,
    entity_type,
    entity_id,
    entity_name,
    minutes_exact,
    minutes_inferred,
    plays,
    qualified_plays,
    unique_tracks,
    skipped_count,
    known_skip_count,
    unknown_duration_plays
  )
  select
    p_user_id,
    e.local_date,
    'album',
    e.album_id::text,
    al.name,
    sum(coalesce(e.ms_played, 0))::numeric / 60000,
    sum(coalesce(e.inferred_ms_played, 0))::numeric / 60000,
    count(*)::integer,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000),
    count(distinct e.track_id)::integer,
    count(*) filter (where e.skipped is true),
    count(e.skipped)::integer,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)
  from listening_events e
  join albums al on al.id = e.album_id
  where e.user_id = p_user_id
    and e.album_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, e.album_id, al.name;

  insert into rollup_daily_entity_stats (
    user_id,
    local_date,
    entity_type,
    entity_id,
    entity_name,
    minutes_exact,
    minutes_inferred,
    plays,
    qualified_plays,
    unique_tracks,
    skipped_count,
    known_skip_count,
    unknown_duration_plays
  )
  select
    p_user_id,
    e.local_date,
    'genre',
    ag.genre,
    ag.genre,
    sum(coalesce(e.ms_played, 0)::numeric / nullif(gc.genre_count, 0)) / 60000,
    sum(coalesce(e.inferred_ms_played, 0)::numeric / nullif(gc.genre_count, 0)) / 60000,
    count(*)::integer,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000),
    count(distinct e.track_id)::integer,
    count(*) filter (where e.skipped is true),
    count(e.skipped)::integer,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)
  from listening_events e
  join artist_genres ag on ag.artist_id = e.primary_artist_id
  join (
    select artist_id, count(*)::numeric as genre_count
    from artist_genres
    group by artist_id
  ) gc on gc.artist_id = e.primary_artist_id
  where e.user_id = p_user_id
    and e.primary_artist_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, ag.genre;
end;
$$;

create or replace function public.refresh_activity_recent(limit_count integer default 100)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public_activity_recent
  where user_id is null;

  insert into public_activity_recent (
    id,
    user_id,
    played_at,
    local_date,
    track_id,
    track_name,
    artist_id,
    artist_name,
    album_id,
    album_name,
    source,
    data_quality,
    ms_played,
    inferred_ms_played,
    skipped,
    context_uri,
    context_type
  )
  select
    e.id,
    null::uuid,
    e.played_at,
    e.local_date,
    e.track_id,
    t.name,
    e.primary_artist_id,
    a.name,
    e.album_id,
    al.name,
    e.source,
    e.data_quality,
    e.ms_played,
    e.inferred_ms_played,
    e.skipped,
    e.context_uri,
    e.context_type
  from listening_events e
  left join tracks t on t.id = e.track_id
  left join artists a on a.id = e.primary_artist_id
  left join albums al on al.id = e.album_id
  where e.user_id is null
  order by e.played_at desc
  limit greatest(1, least(limit_count, 500));
end;
$$;

create or replace function public.refresh_user_activity_recent(p_user_id uuid, limit_count integer default 100)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  delete from public_activity_recent
  where user_id = p_user_id;

  insert into public_activity_recent (
    id,
    user_id,
    played_at,
    local_date,
    track_id,
    track_name,
    artist_id,
    artist_name,
    album_id,
    album_name,
    source,
    data_quality,
    ms_played,
    inferred_ms_played,
    skipped,
    context_uri,
    context_type
  )
  select
    e.id,
    p_user_id,
    e.played_at,
    e.local_date,
    e.track_id,
    t.name,
    e.primary_artist_id,
    a.name,
    e.album_id,
    al.name,
    e.source,
    e.data_quality,
    e.ms_played,
    e.inferred_ms_played,
    e.skipped,
    e.context_uri,
    e.context_type
  from listening_events e
  left join tracks t on t.id = e.track_id
  left join artists a on a.id = e.primary_artist_id
  left join albums al on al.id = e.album_id
  where e.user_id = p_user_id
  order by e.played_at desc
  limit greatest(1, least(limit_count, 500));
end;
$$;

create or replace function public.build_overview_payload(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  melbourne_today date := (now() at time zone 'Australia/Melbourne')::date;
  week_start date := date_trunc('week', now() at time zone 'Australia/Melbourne')::date;
begin
  return jsonb_build_object(
    'generated_at', now(),
    'timezone', 'Australia/Melbourne',
    'sync', (
      select jsonb_build_object(
        'last_success_at', recently_played_last_success_at,
        'gap_risk', recently_played_gap_risk,
        'latest_exact_export_event_at', latest_exact_export_event_at,
        'api_only_period_start', api_only_period_start
      )
      from sync_state
      where (
        (p_user_id is null and user_id is null)
        or user_id = p_user_id
      )
      order by updated_at desc nulls last
      limit 1
    ),
    'today', jsonb_build_object(
      'minutes', coalesce((
        select sum(minutes_exact + minutes_inferred)
        from rollup_daily_entity_stats
        where entity_type = 'artist'
          and local_date = melbourne_today
          and ((p_user_id is null and user_id is null) or user_id = p_user_id)
      ), 0),
      'top_artist', (
        select entity_name
        from rollup_daily_entity_stats
        where entity_type = 'artist'
          and local_date = melbourne_today
          and ((p_user_id is null and user_id is null) or user_id = p_user_id)
        order by (minutes_exact + minutes_inferred) desc, plays desc
        limit 1
      ),
      'top_track', (
        select entity_name
        from rollup_daily_entity_stats
        where entity_type = 'track'
          and local_date = melbourne_today
          and ((p_user_id is null and user_id is null) or user_id = p_user_id)
        order by (minutes_exact + minutes_inferred) desc, plays desc
        limit 1
      ),
      'top_genre', (
        select entity_name
        from rollup_daily_entity_stats
        where entity_type = 'genre'
          and local_date = melbourne_today
          and ((p_user_id is null and user_id is null) or user_id = p_user_id)
        order by (minutes_exact + minutes_inferred) desc, plays desc
        limit 1
      )
    ),
    'this_week', jsonb_build_object(
      'minutes', coalesce((
        select sum(minutes_exact + minutes_inferred)
        from rollup_daily_entity_stats
        where entity_type = 'artist'
          and local_date >= week_start
          and ((p_user_id is null and user_id is null) or user_id = p_user_id)
      ), 0),
      'top_artists', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.minutes desc, r.plays desc)
        from (
          select
            entity_id,
            entity_name,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays,
            sum(unique_tracks)::integer as unique_tracks,
            sum(unknown_duration_plays)::integer as unknown_duration_plays
          from rollup_daily_entity_stats
          where entity_type = 'artist'
            and local_date >= week_start
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by entity_id, entity_name
          order by minutes desc, plays desc
          limit 10
        ) r
      ), '[]'::jsonb),
      'top_genres', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.minutes desc, r.plays desc)
        from (
          select
            entity_id,
            entity_name,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays,
            sum(unknown_duration_plays)::integer as unknown_duration_plays
          from rollup_daily_entity_stats
          where entity_type = 'genre'
            and local_date >= week_start
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by entity_id, entity_name
          order by minutes desc, plays desc
          limit 10
        ) r
      ), '[]'::jsonb),
      'top_tracks', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.minutes desc, r.plays desc)
        from (
          select
            entity_id,
            entity_name,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays,
            sum(unknown_duration_plays)::integer as unknown_duration_plays
          from rollup_daily_entity_stats
          where entity_type = 'track'
            and local_date >= week_start
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by entity_id, entity_name
          order by minutes desc, plays desc
          limit 10
        ) r
      ), '[]'::jsonb)
    ),
    'last_30_days', jsonb_build_object(
      'minutes', coalesce((
        select sum(minutes_exact + minutes_inferred)
        from rollup_daily_entity_stats
        where entity_type = 'artist'
          and local_date >= melbourne_today - 29
          and ((p_user_id is null and user_id is null) or user_id = p_user_id)
      ), 0),
      'top_artists', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.minutes desc, r.plays desc)
        from (
          select
            entity_id,
            entity_name,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays,
            sum(unknown_duration_plays)::integer as unknown_duration_plays
          from rollup_daily_entity_stats
          where entity_type = 'artist'
            and local_date >= melbourne_today - 29
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by entity_id, entity_name
          order by minutes desc, plays desc
          limit 10
        ) r
      ), '[]'::jsonb),
      'top_genres', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.minutes desc, r.plays desc)
        from (
          select
            entity_id,
            entity_name,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays,
            sum(unknown_duration_plays)::integer as unknown_duration_plays
          from rollup_daily_entity_stats
          where entity_type = 'genre'
            and local_date >= melbourne_today - 29
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by entity_id, entity_name
          order by minutes desc, plays desc
          limit 10
        ) r
      ), '[]'::jsonb)
    ),
    'calendar', jsonb_build_object(
      'last_365_days', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.local_date)
        from (
          select
            local_date,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays
          from rollup_daily_entity_stats
          where entity_type = 'artist'
            and local_date >= melbourne_today - 364
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by local_date
          order by local_date
        ) r
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.refresh_overview_cache()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  payload jsonb;
begin
  payload := public.build_overview_payload(null);

  insert into overview_cache (key, user_id, payload, generated_at)
  values ('public_home', null, payload, now())
  on conflict (key) do update
    set user_id = excluded.user_id,
        payload = excluded.payload,
        generated_at = excluded.generated_at;
end;
$$;

create or replace function public.refresh_user_overview_cache(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  payload jsonb;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  payload := public.build_overview_payload(p_user_id);

  insert into overview_cache (key, user_id, payload, generated_at)
  values ('public_home:' || p_user_id::text, p_user_id, payload, now())
  on conflict (key) do update
    set user_id = excluded.user_id,
        payload = excluded.payload,
        generated_at = excluded.generated_at;
end;
$$;

create or replace function public.refresh_public_stats(target_dates date[] default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.refresh_rollups(target_dates);
  perform public.refresh_activity_recent(100);
  perform public.refresh_overview_cache();
end;
$$;

create or replace function public.refresh_user_public_stats(p_user_id uuid, target_dates date[] default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.refresh_user_rollups(p_user_id, target_dates);
  perform public.refresh_user_activity_recent(p_user_id, 100);
  perform public.refresh_user_overview_cache(p_user_id);
end;
$$;

alter table profiles enable row level security;
alter table invite_codes enable row level security;
alter table spotify_connections enable row level security;
alter table spotify_oauth_states enable row level security;

revoke all on table
  profiles,
  invite_codes,
  spotify_connections,
  spotify_oauth_states,
  listening_events,
  sync_state,
  rollup_daily_entity_stats,
  overview_cache,
  public_activity_recent
from anon, authenticated;

grant select on table profiles to anon, authenticated;
grant update (slug, display_name, is_public, updated_at) on table profiles to authenticated;

grant select (user_id, spotify_user_id, spotify_display_name, scopes, sync_enabled, connected_at, last_token_refresh_at, last_error_at, last_error, updated_at)
  on table spotify_connections to authenticated;
grant update (sync_enabled, updated_at)
  on table spotify_connections to authenticated;

grant select on table listening_events to authenticated;
grant select on table sync_state to authenticated;
grant select on table rollup_daily_entity_stats to anon, authenticated;
grant select on table overview_cache to anon, authenticated;
grant select on table public_activity_recent to anon, authenticated;
grant select on table public_profile_overview to anon, authenticated;
grant select on table public_profile_rollup_daily_entity_stats to anon, authenticated;
grant select on table public_profile_activity_recent to anon, authenticated;

grant select, insert, update, delete on table
  profiles,
  invite_codes,
  spotify_connections,
  spotify_oauth_states,
  listening_events,
  sync_state,
  rollup_daily_entity_stats,
  overview_cache,
  public_activity_recent
to service_role;

drop policy if exists "Profiles are visible to owner or public" on profiles;
create policy "Profiles are visible to owner or public"
  on profiles for select
  to anon, authenticated
  using (is_public = true or user_id = (select auth.uid()));

drop policy if exists "Users update own profile" on profiles;
create policy "Users update own profile"
  on profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users read own Spotify connection" on spotify_connections;
create policy "Users read own Spotify connection"
  on spotify_connections for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users toggle own Spotify sync" on spotify_connections;
create policy "Users toggle own Spotify sync"
  on spotify_connections for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users read own listening events" on listening_events;
create policy "Users read own listening events"
  on listening_events for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users read own sync state" on sync_state;
create policy "Users read own sync state"
  on sync_state for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Public read daily rollups" on rollup_daily_entity_stats;
drop policy if exists "Users and public profiles read rollups" on rollup_daily_entity_stats;
create policy "Users and public profiles read rollups"
  on rollup_daily_entity_stats for select
  to anon, authenticated
  using (
    user_id is null
    or user_id = (select auth.uid())
    or exists (
      select 1
      from profiles p
      where p.user_id = rollup_daily_entity_stats.user_id
        and p.is_public = true
    )
  );

drop policy if exists "Public read overview cache" on overview_cache;
drop policy if exists "Users and public profiles read overview cache" on overview_cache;
create policy "Users and public profiles read overview cache"
  on overview_cache for select
  to anon, authenticated
  using (
    user_id is null
    or user_id = (select auth.uid())
    or exists (
      select 1
      from profiles p
      where p.user_id = overview_cache.user_id
        and p.is_public = true
    )
  );

drop policy if exists "Public read recent activity" on public_activity_recent;
drop policy if exists "Users and public profiles read recent activity" on public_activity_recent;
create policy "Users and public profiles read recent activity"
  on public_activity_recent for select
  to anon, authenticated
  using (
    user_id is null
    or user_id = (select auth.uid())
    or exists (
      select 1
      from profiles p
      where p.user_id = public_activity_recent.user_id
        and p.is_public = true
    )
  );

drop policy if exists "No direct invite code access" on invite_codes;
create policy "No direct invite code access"
  on invite_codes
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "No direct oauth state access" on spotify_oauth_states;
create policy "No direct oauth state access"
  on spotify_oauth_states
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on function public.refresh_user_rollups(uuid, date[]) from anon, authenticated;
revoke all on function public.refresh_user_activity_recent(uuid, integer) from anon, authenticated;
revoke all on function public.build_overview_payload(uuid) from anon, authenticated;
revoke all on function public.refresh_user_overview_cache(uuid) from anon, authenticated;
revoke all on function public.refresh_user_public_stats(uuid, date[]) from anon, authenticated;

grant execute on function public.refresh_user_rollups(uuid, date[]) to service_role;
grant execute on function public.refresh_user_activity_recent(uuid, integer) to service_role;
grant execute on function public.build_overview_payload(uuid) to service_role;
grant execute on function public.refresh_user_overview_cache(uuid) to service_role;
grant execute on function public.refresh_user_public_stats(uuid, date[]) to service_role;
