-- Persist only the provider fields that have proved useful in the
-- MusicBrainz + Last.fm spike. Raw responses stay in gitignored analysis
-- files; these tables are the deliberately small, service-only projection.

create table public.musicbrainz_track_matches (
  track_id bigint not null references public.tracks(id) on delete cascade,
  recording_mbid uuid not null,
  recording_title text not null,
  artist_mbids uuid[] not null default '{}',
  artist_names text[] not null default '{}',
  duration_ms integer,
  duration_delta_ms integer,
  score smallint not null,
  confidence text not null,
  ambiguous boolean not null default false,
  is_selected boolean not null default false,
  match_reasons text[] not null default '{}',
  checked_at timestamptz not null,
  primary key (track_id, recording_mbid),
  constraint musicbrainz_track_matches_duration_check
    check (duration_ms is null or duration_ms >= 0),
  constraint musicbrainz_track_matches_duration_delta_check
    check (duration_delta_ms is null or duration_delta_ms >= 0),
  constraint musicbrainz_track_matches_confidence_check
    check (confidence in ('high', 'medium', 'low'))
);

-- A MusicBrainz recording can legitimately back more than one Spotify track,
-- but a track must never have two promoted recording matches.
create unique index musicbrainz_track_matches_selected_uidx
  on public.musicbrainz_track_matches (track_id)
  where is_selected;

create index musicbrainz_track_matches_recording_mbid_idx
  on public.musicbrainz_track_matches (recording_mbid);

-- Metadata, stats and tags share the same entity shape. Keeping real nullable
-- foreign keys (instead of an unenforced polymorphic entity_id) makes deletes
-- safe. The generated columns give PostgREST a normal unique conflict target.
create table public.external_music_metadata (
  id bigint generated always as identity primary key,
  source text not null,
  track_id bigint references public.tracks(id) on delete cascade,
  artist_id bigint references public.artists(id) on delete cascade,
  album_id bigint references public.albums(id) on delete cascade,
  entity_type text generated always as (
    case
      when track_id is not null then 'track'
      when artist_id is not null then 'artist'
      when album_id is not null then 'album'
    end
  ) stored,
  entity_id bigint generated always as (coalesce(track_id, artist_id, album_id)) stored,
  canonical_name text not null,
  canonical_artist_name text,
  source_url text,
  summary_html text,
  summary_published_at text,
  match_method text not null,
  fetched_at timestamptz not null,
  constraint external_music_metadata_one_entity_check
    check (num_nonnulls(track_id, artist_id, album_id) = 1),
  constraint external_music_metadata_source_check
    check (source = lower(source) and source ~ '^[a-z0-9_-]{1,32}$'),
  constraint external_music_metadata_name_check
    check (btrim(canonical_name) <> ''),
  constraint external_music_metadata_match_method_check
    check (match_method in ('mbid', 'name', 'name_fallback')),
  constraint external_music_metadata_entity_uidx
    unique (source, entity_type, entity_id)
);

create index external_music_metadata_track_idx
  on public.external_music_metadata (track_id)
  where track_id is not null;
create index external_music_metadata_artist_idx
  on public.external_music_metadata (artist_id)
  where artist_id is not null;
create index external_music_metadata_album_idx
  on public.external_music_metadata (album_id)
  where album_id is not null;

-- Last.fm listener/play counts change. One row per UTC observation day keeps
-- trend analysis possible without creating a row on every enrichment retry.
create table public.external_music_stats (
  id bigint generated always as identity primary key,
  source text not null,
  track_id bigint references public.tracks(id) on delete cascade,
  artist_id bigint references public.artists(id) on delete cascade,
  album_id bigint references public.albums(id) on delete cascade,
  entity_type text generated always as (
    case
      when track_id is not null then 'track'
      when artist_id is not null then 'artist'
      when album_id is not null then 'album'
    end
  ) stored,
  entity_id bigint generated always as (coalesce(track_id, artist_id, album_id)) stored,
  observed_on date not null,
  listeners bigint,
  playcount bigint,
  fetched_at timestamptz not null,
  constraint external_music_stats_one_entity_check
    check (num_nonnulls(track_id, artist_id, album_id) = 1),
  constraint external_music_stats_source_check
    check (source = lower(source) and source ~ '^[a-z0-9_-]{1,32}$'),
  constraint external_music_stats_values_check
    check (
      num_nonnulls(listeners, playcount) >= 1
      and (listeners is null or listeners >= 0)
      and (playcount is null or playcount >= 0)
    ),
  constraint external_music_stats_entity_day_uidx
    unique (source, entity_type, entity_id, observed_on)
);

create index external_music_stats_track_idx
  on public.external_music_stats (track_id, observed_on desc)
  where track_id is not null;
create index external_music_stats_artist_idx
  on public.external_music_stats (artist_id, observed_on desc)
  where artist_id is not null;
create index external_music_stats_album_idx
  on public.external_music_stats (album_id, observed_on desc)
  where album_id is not null;

create table public.external_music_tags (
  id bigint generated always as identity primary key,
  source text not null,
  track_id bigint references public.tracks(id) on delete cascade,
  artist_id bigint references public.artists(id) on delete cascade,
  album_id bigint references public.albums(id) on delete cascade,
  entity_type text generated always as (
    case
      when track_id is not null then 'track'
      when artist_id is not null then 'artist'
      when album_id is not null then 'album'
    end
  ) stored,
  entity_id bigint generated always as (coalesce(track_id, artist_id, album_id)) stored,
  raw_tag text not null,
  normalized_tag text not null,
  weight integer,
  rank smallint not null,
  fetched_at timestamptz not null,
  constraint external_music_tags_one_entity_check
    check (num_nonnulls(track_id, artist_id, album_id) = 1),
  constraint external_music_tags_source_check
    check (source = lower(source) and source ~ '^[a-z0-9_-]{1,32}$'),
  constraint external_music_tags_tag_check
    check (btrim(raw_tag) <> '' and btrim(normalized_tag) <> ''),
  constraint external_music_tags_weight_check
    check (weight is null or weight >= 0),
  constraint external_music_tags_rank_check
    check (rank > 0),
  constraint external_music_tags_entity_tag_uidx
    unique (source, entity_type, entity_id, raw_tag)
);

create index external_music_tags_track_idx
  on public.external_music_tags (track_id)
  where track_id is not null;
create index external_music_tags_artist_idx
  on public.external_music_tags (artist_id)
  where artist_id is not null;
create index external_music_tags_album_idx
  on public.external_music_tags (album_id)
  where album_id is not null;
create index external_music_tags_normalized_tag_idx
  on public.external_music_tags (normalized_tag);

-- The API commonly returns around 100 neighbours. Importers deliberately cap
-- this at 20 rows per source track; rank is the stable replacement boundary.
create table public.external_track_similarities (
  source text not null,
  track_id bigint not null references public.tracks(id) on delete cascade,
  rank smallint not null,
  related_artist_name text not null,
  related_track_name text not null,
  related_url text,
  match_score numeric(8, 7) not null,
  source_playcount bigint,
  fetched_at timestamptz not null,
  primary key (source, track_id, rank),
  constraint external_track_similarities_source_check
    check (source = lower(source) and source ~ '^[a-z0-9_-]{1,32}$'),
  constraint external_track_similarities_rank_check
    check (rank between 1 and 20),
  constraint external_track_similarities_names_check
    check (btrim(related_artist_name) <> '' and btrim(related_track_name) <> ''),
  constraint external_track_similarities_match_check
    check (match_score between 0 and 1),
  constraint external_track_similarities_playcount_check
    check (source_playcount is null or source_playcount >= 0)
);

create index external_track_similarities_track_idx
  on public.external_track_similarities (track_id);

-- `artist_genres` remains the small public projection used by rollups. This
-- service-only table records who contributed each genre, so refreshing Last.fm
-- cannot erase Spotify genres (and vice versa).
create table public.artist_genre_sources (
  artist_id bigint not null references public.artists(id) on delete cascade,
  genre text not null,
  source text not null,
  refreshed_at timestamptz not null default now(),
  primary key (artist_id, genre, source),
  constraint artist_genre_sources_genre_check
    check (btrim(genre) <> ''),
  constraint artist_genre_sources_source_check
    check (source in ('spotify', 'lastfm'))
);

create index artist_genre_sources_genre_idx
  on public.artist_genre_sources (genre);

insert into public.artist_genre_sources (artist_id, genre, source)
select artist_id, genre, 'spotify'
from public.artist_genres
on conflict do nothing;

-- A whitelist is safer than trying to blacklist Last.fm's locations, years,
-- artist names and social tags. Unreviewed tags remain evidence but never leak
-- into the genre projection.
create table public.genre_tag_rules (
  normalized_tag text primary key,
  decision text not null,
  genre text,
  notes text,
  updated_at timestamptz not null default now(),
  constraint genre_tag_rules_tag_check
    check (btrim(normalized_tag) <> ''),
  constraint genre_tag_rules_decision_check
    check (decision in ('include', 'exclude')),
  constraint genre_tag_rules_genre_check
    check (
      (decision = 'include' and genre is not null and btrim(genre) <> '')
      or (decision = 'exclude' and genre is null)
    )
);

insert into public.genre_tag_rules (normalized_tag, decision, genre, notes)
values
  ('hip hop', 'include', 'hip-hop', 'Collapses hip-hop punctuation variants.'),
  ('rap', 'include', 'hip-hop', 'Last.fm commonly uses rap beside hip-hop.'),
  ('electronic', 'include', 'electronic', null),
  ('experimental', 'include', 'experimental', null),
  ('rock', 'include', 'rock', null),
  ('rnb', 'include', 'r&b', null),
  ('r and b', 'include', 'r&b', null),
  ('alternative rnb', 'include', 'alternative r&b', null),
  ('alternative r and b', 'include', 'alternative r&b', null),
  ('indie', 'include', 'indie', null),
  ('alternative', 'include', 'alternative', null),
  ('pop rap', 'include', 'pop rap', null),
  ('experimental hip hop', 'include', 'experimental hip-hop', null),
  ('alternative rock', 'include', 'alternative rock', null),
  ('trap', 'include', 'trap', null),
  ('pop', 'include', 'pop', null),
  ('cloud rap', 'include', 'cloud rap', null),
  ('neo soul', 'include', 'neo-soul', null),
  ('soul', 'include', 'soul', null),
  ('hardcore hip hop', 'include', 'hardcore hip-hop', null),
  ('indie rock', 'include', 'indie rock', null),
  ('glitch hop', 'include', 'glitch hop', null),
  ('art rock', 'include', 'art rock', null),
  ('art pop', 'include', 'art pop', null),
  ('alternative hip hop', 'include', 'alternative hip-hop', null),
  ('west coast hip hop', 'include', 'west coast hip-hop', null),
  ('synth funk', 'include', 'synth-funk', null),
  ('singer songwriter', 'include', 'singer-songwriter', null),
  ('post punk', 'include', 'post-punk', null),
  ('jazz', 'include', 'jazz', null),
  ('industrial hip hop', 'include', 'industrial hip-hop', null),
  ('idm', 'include', 'idm', null),
  ('dance', 'include', 'dance', null),
  ('post punk revival', 'include', 'post-punk revival', null),
  ('wonky', 'include', 'wonky', null),
  ('underground hip hop', 'include', 'underground hip-hop', null),
  ('trap rap', 'include', 'trap', null),
  ('synthpop', 'include', 'synthpop', null),
  ('psychedelic', 'include', 'psychedelic', null),
  ('nu jazz', 'include', 'nu jazz', null),
  ('industrial', 'include', 'industrial', null),
  ('indie pop', 'include', 'indie pop', null),
  ('bedroom pop', 'include', 'bedroom pop', null),
  ('ambient', 'include', 'ambient', null),
  ('house', 'include', 'house', null),
  ('disco', 'include', 'disco', null),
  ('trip hop', 'include', 'trip-hop', null),
  ('trance', 'include', 'trance', null),
  ('techno', 'include', 'techno', null),
  ('synthwave', 'include', 'synthwave', null),
  ('shoegaze', 'include', 'shoegaze', null),
  ('noise', 'include', 'noise', null),
  ('new wave', 'include', 'new wave', null),
  ('jazz rap', 'include', 'jazz rap', null),
  ('jazz fusion', 'include', 'jazz fusion', null),
  ('instrumental hip hop', 'include', 'instrumental hip-hop', null),
  ('indie folk', 'include', 'indie folk', null),
  ('hip house', 'include', 'hip house', null),
  ('glitch', 'include', 'glitch', null),
  ('vocal trance', 'include', 'vocal trance', null),
  ('progressive trance', 'include', 'progressive trance', null),
  ('post britpop', 'include', 'post-Britpop', null),
  ('american', 'exclude', null, 'Nationality, not a genre.'),
  ('british', 'exclude', null, 'Nationality, not a genre.'),
  ('united states', 'exclude', null, 'Location, not a genre.'),
  ('favourite albums', 'exclude', null, 'Collection label, not a genre.'),
  ('male vocalists', 'exclude', null, 'Performer attribute, not a genre.'),
  ('remastered', 'exclude', null, 'Release attribute, not a genre.')
on conflict (normalized_tag) do nothing;

create or replace function public.replace_artist_genre_source(
  p_artist_id bigint,
  p_source text,
  p_genres text[]
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if p_source not in ('spotify', 'lastfm') then
    raise exception 'Unsupported artist genre source: %', p_source;
  end if;

  delete from public.artist_genre_sources
  where artist_id = p_artist_id
    and source = p_source;

  insert into public.artist_genre_sources (artist_id, genre, source, refreshed_at)
  select p_artist_id, genre, p_source, now()
  from (
    select distinct btrim(value) as genre
    from unnest(coalesce(p_genres, '{}')) as value
    where btrim(value) <> ''
  ) genres;

  delete from public.artist_genres
  where artist_id = p_artist_id;

  insert into public.artist_genres (artist_id, genre)
  select artist_id, genre
  from public.artist_genre_sources
  where artist_id = p_artist_id
  group by artist_id, genre;
end;
$$;

-- Artist tags are authoritative. Album/track tags only fill artists with no
-- mapped artist tags, and only through primary-artist relationships.
create or replace function public.refresh_lastfm_artist_genres(
  p_artist_ids bigint[] default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_artist_ids bigint[];
  v_count integer;
begin
  if p_artist_ids is null then
    select coalesce(array_agg(distinct artist_id), '{}')
    into v_artist_ids
    from (
      select artist_id
      from public.external_music_tags
      where source = 'lastfm' and artist_id is not null
      union
      select ta.artist_id
      from public.external_music_tags t
      join public.track_artists ta on ta.track_id = t.track_id and ta.artist_order = 0
      where t.source = 'lastfm' and t.track_id is not null
      union
      select ta.artist_id
      from public.external_music_tags t
      join public.tracks tr on tr.album_id = t.album_id
      join public.track_artists ta on ta.track_id = tr.id and ta.artist_order = 0
      where t.source = 'lastfm' and t.album_id is not null
    ) candidates;
  else
    select coalesce(array_agg(distinct artist_id), '{}')
    into v_artist_ids
    from unnest(p_artist_ids) artist_id;
  end if;

  if cardinality(v_artist_ids) = 0 then
    return 0;
  end if;

  delete from public.artist_genre_sources
  where source = 'lastfm'
    and artist_id = any(v_artist_ids);

  with direct_genres as (
    select distinct t.artist_id, r.genre
    from public.external_music_tags t
    join public.genre_tag_rules r
      on r.normalized_tag = t.normalized_tag
     and r.decision = 'include'
    where t.source = 'lastfm'
      and t.artist_id = any(v_artist_ids)
  ),
  artists_without_direct as (
    select artist_id
    from unnest(v_artist_ids) artist_id
    except
    select artist_id from direct_genres
  ),
  supplemental_genres as (
    select distinct ta.artist_id, r.genre
    from public.external_music_tags t
    join public.track_artists ta
      on ta.track_id = t.track_id
     and ta.artist_order = 0
    join artists_without_direct missing on missing.artist_id = ta.artist_id
    join public.genre_tag_rules r
      on r.normalized_tag = t.normalized_tag
     and r.decision = 'include'
    where t.source = 'lastfm'
      and t.track_id is not null
    union
    select distinct ta.artist_id, r.genre
    from public.external_music_tags t
    join public.tracks tr on tr.album_id = t.album_id
    join public.track_artists ta
      on ta.track_id = tr.id
     and ta.artist_order = 0
    join artists_without_direct missing on missing.artist_id = ta.artist_id
    join public.genre_tag_rules r
      on r.normalized_tag = t.normalized_tag
     and r.decision = 'include'
    where t.source = 'lastfm'
      and t.album_id is not null
  ),
  inserted as (
    insert into public.artist_genre_sources (artist_id, genre, source, refreshed_at)
    select artist_id, genre, 'lastfm', now()
    from (
      select * from direct_genres
      union
      select * from supplemental_genres
    ) genres
    returning 1
  )
  select count(*) into v_count from inserted;

  delete from public.artist_genres
  where artist_id = any(v_artist_ids);

  insert into public.artist_genres (artist_id, genre)
  select artist_id, genre
  from public.artist_genre_sources
  where artist_id = any(v_artist_ids)
  group by artist_id, genre;

  return v_count;
end;
$$;

-- Genre changes affect historic daily rollups. Queue those dates for the
-- existing small-batch drain job instead of rebuilding them inside an import.
create or replace function public.queue_rollup_refresh_for_artists(
  p_artist_ids bigint[]
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  if p_artist_ids is null or cardinality(p_artist_ids) = 0 then
    return 0;
  end if;

  insert into public.rollup_refresh_queue (user_id, local_date, queued_at)
  select distinct e.user_id, e.local_date, now()
  from public.listening_events e
  where e.primary_artist_id = any(p_artist_ids)
    and e.user_id is not null
  on conflict (user_id, local_date) do update
    set queued_at = least(public.rollup_refresh_queue.queued_at, excluded.queued_at);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.musicbrainz_track_matches enable row level security;
alter table public.external_music_metadata enable row level security;
alter table public.external_music_stats enable row level security;
alter table public.external_music_tags enable row level security;
alter table public.external_track_similarities enable row level security;
alter table public.artist_genre_sources enable row level security;
alter table public.genre_tag_rules enable row level security;

-- Explicit grants matter for projects where new public-schema tables are
-- automatically exposed by the Data API. There are intentionally no anon or
-- authenticated policies on any provider-evidence table.
revoke all on table
  public.musicbrainz_track_matches,
  public.external_music_metadata,
  public.external_music_stats,
  public.external_music_tags,
  public.external_track_similarities,
  public.artist_genre_sources,
  public.genre_tag_rules
from anon, authenticated;

grant select, insert, update, delete on table
  public.musicbrainz_track_matches,
  public.external_music_metadata,
  public.external_music_stats,
  public.external_music_tags,
  public.external_track_similarities,
  public.artist_genre_sources,
  public.genre_tag_rules
to service_role;

grant usage, select on sequence
  public.external_music_metadata_id_seq,
  public.external_music_stats_id_seq,
  public.external_music_tags_id_seq
to service_role;

revoke all on function public.replace_artist_genre_source(bigint, text, text[])
from public, anon, authenticated;
revoke all on function public.refresh_lastfm_artist_genres(bigint[])
from public, anon, authenticated;
revoke all on function public.queue_rollup_refresh_for_artists(bigint[])
from public, anon, authenticated;
grant execute on function public.replace_artist_genre_source(bigint, text, text[])
to service_role;
grant execute on function public.refresh_lastfm_artist_genres(bigint[])
to service_role;
grant execute on function public.queue_rollup_refresh_for_artists(bigint[])
to service_role;

notify pgrst, 'reload schema';
