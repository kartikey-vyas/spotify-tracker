create table if not exists artists (
  id bigint generated always as identity primary key,
  spotify_artist_uri text unique,
  spotify_artist_id text unique,
  name text not null,
  image_url text,
  spotify_url text,
  first_seen_at timestamptz not null default now(),
  last_refreshed_at timestamptz
);

create unique index if not exists artists_name_fallback_uidx
  on artists (lower(name))
  where spotify_artist_uri is null
    and spotify_artist_id is null;

create table if not exists albums (
  id bigint generated always as identity primary key,
  spotify_album_uri text unique,
  spotify_album_id text unique,
  name text not null,
  album_type text,
  release_date text,
  release_date_precision text,
  image_url text,
  spotify_url text,
  first_seen_at timestamptz not null default now(),
  last_refreshed_at timestamptz
);

create unique index if not exists albums_name_fallback_uidx
  on albums (lower(name))
  where spotify_album_uri is null
    and spotify_album_id is null;

create table if not exists tracks (
  id bigint generated always as identity primary key,
  spotify_track_uri text unique,
  spotify_track_id text unique,
  name text not null,
  album_id bigint references albums(id),
  duration_ms integer,
  explicit boolean,
  isrc text,
  spotify_url text,
  first_seen_at timestamptz not null default now(),
  last_refreshed_at timestamptz
);

create table if not exists track_artists (
  track_id bigint not null references tracks(id) on delete cascade,
  artist_id bigint not null references artists(id) on delete cascade,
  artist_order smallint not null,
  primary key (track_id, artist_id)
);

create index if not exists track_artists_artist_idx
  on track_artists (artist_id);

create table if not exists artist_genres (
  artist_id bigint not null references artists(id) on delete cascade,
  genre text not null,
  primary key (artist_id, genre)
);

create index if not exists artist_genres_genre_idx
  on artist_genres (genre);

create table if not exists listening_events (
  id bigint generated always as identity primary key,

  played_at timestamptz not null,
  local_date date not null,

  source smallint not null,
  data_quality smallint not null,

  track_id bigint references tracks(id),
  primary_artist_id bigint references artists(id),
  album_id bigint references albums(id),

  ms_played integer,
  inferred_ms_played integer,

  skipped boolean,
  reason_start text,
  reason_end text,
  shuffle boolean,
  offline boolean,
  private_session boolean,

  context_uri text,
  context_type text,

  source_event_key text not null unique,

  created_at timestamptz not null default now(),

  constraint listening_events_source_check
    check (source in (1, 2, 3)),
  constraint listening_events_data_quality_check
    check (data_quality in (1, 2, 3)),
  constraint listening_events_ms_played_check
    check (ms_played is null or ms_played >= 0),
  constraint listening_events_inferred_ms_played_check
    check (inferred_ms_played is null or inferred_ms_played >= 0)
);

create index if not exists listening_events_played_at_idx
  on listening_events (played_at desc);

create index if not exists listening_events_local_date_idx
  on listening_events (local_date);

create index if not exists listening_events_track_idx
  on listening_events (track_id);

create index if not exists listening_events_artist_idx
  on listening_events (primary_artist_id);

create table if not exists sync_state (
  id smallint primary key default 1,

  recently_played_cursor_ms bigint,
  recently_played_last_success_at timestamptz,
  recently_played_last_error_at timestamptz,
  recently_played_last_error text,
  recently_played_gap_risk boolean not null default false,

  metadata_last_success_at timestamptz,
  metadata_last_error_at timestamptz,
  metadata_last_error text,

  latest_exact_export_event_at timestamptz,
  api_only_period_start timestamptz,

  updated_at timestamptz not null default now(),

  constraint sync_state_singleton check (id = 1)
);

insert into sync_state (id)
values (1)
on conflict (id) do nothing;

create table if not exists rollup_daily_entity_stats (
  local_date date not null,

  entity_type text not null,
  entity_id text not null,
  entity_name text not null,

  minutes_exact numeric not null default 0,
  minutes_inferred numeric not null default 0,
  plays integer not null default 0,
  qualified_plays integer not null default 0,
  unique_tracks integer not null default 0,

  skipped_count integer,
  known_skip_count integer,
  unknown_duration_plays integer not null default 0,

  updated_at timestamptz not null default now(),

  primary key (local_date, entity_type, entity_id),
  constraint rollup_daily_entity_type_check
    check (entity_type in ('artist', 'track', 'album', 'genre'))
);

create index if not exists rollup_entity_type_date_idx
  on rollup_daily_entity_stats (entity_type, local_date);

create index if not exists rollup_entity_id_idx
  on rollup_daily_entity_stats (entity_id);

create table if not exists overview_cache (
  key text primary key,
  payload jsonb not null,
  generated_at timestamptz not null default now()
);

create table if not exists public_activity_recent (
  id bigint primary key,
  played_at timestamptz not null,
  local_date date not null,
  track_id bigint,
  track_name text,
  artist_id bigint,
  artist_name text,
  album_id bigint,
  album_name text,
  source smallint not null,
  data_quality smallint not null,
  ms_played integer,
  inferred_ms_played integer,
  skipped boolean,
  context_uri text,
  context_type text
);

create index if not exists public_activity_recent_played_at_idx
  on public_activity_recent (played_at desc);

comment on table listening_events is
  'Private normalized listening history. Browser clients must not receive direct write access.';

comment on table rollup_daily_entity_stats is
  'Public daily precomputed rollups for dashboard and explorer queries.';

comment on table public_activity_recent is
  'Safe refreshed public subset of recent listening activity.';
