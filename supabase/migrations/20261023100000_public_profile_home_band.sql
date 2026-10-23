-- The homepage band (top artists, top tracks and the album cover wall) took
-- two dependent round trips from the browser: three public_profile_rankings
-- calls, then albums and tracks->track_artists->artists for the covers and
-- each album's artist. The database is in Mumbai and the readers are in
-- Melbourne, so each round trip costs ~300ms regardless of query time.
--
-- This returns the whole band in one call. The rankings come from
-- public_profile_rankings unchanged, so the public-profile check and the
-- ordering rules stay in one place. The album artist is the most frequent
-- first-listed artist across the album's stored tracks, the same rule as
-- fetchAlbumArtists in src/lib/queries/images.ts, with ties broken by name so
-- the result does not change between calls.
--
-- It is stable, so PostgREST also serves it over GET. The homepage boot script
-- uses GET with the key in the query string, which needs no CORS preflight.

create or replace function public.public_profile_home_band(
  p_slug text,
  p_start_date date,
  p_end_date date,
  p_list_limit integer default 8,
  p_album_limit integer default 36
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_artists jsonb;
  v_tracks jsonb;
  v_albums jsonb;
  v_album_ids bigint[];
begin
  select coalesce(jsonb_agg(to_jsonb(r) - 'ord' order by r.ord), '[]'::jsonb)
  into v_artists
  from public.public_profile_rankings(
    p_slug, 'artist', p_start_date, p_end_date, 'plays', p_list_limit
  ) with ordinality as r(
    entity_id, entity_name, minutes, plays, qualified_plays, unique_tracks,
    skipped_count, known_skip_count, unknown_duration_plays, ord
  );

  select coalesce(jsonb_agg(to_jsonb(r) - 'ord' order by r.ord), '[]'::jsonb)
  into v_tracks
  from public.public_profile_rankings(
    p_slug, 'track', p_start_date, p_end_date, 'plays', p_list_limit
  ) with ordinality as r(
    entity_id, entity_name, minutes, plays, qualified_plays, unique_tracks,
    skipped_count, known_skip_count, unknown_duration_plays, ord
  );

  select coalesce(jsonb_agg(to_jsonb(r) - 'ord' order by r.ord), '[]'::jsonb)
  into v_albums
  from public.public_profile_rankings(
    p_slug, 'album', p_start_date, p_end_date, 'plays', p_album_limit
  ) with ordinality as r(
    entity_id, entity_name, minutes, plays, qualified_plays, unique_tracks,
    skipped_count, known_skip_count, unknown_duration_plays, ord
  );

  v_album_ids := array(
    select (album->>'entity_id')::bigint
    from jsonb_array_elements(v_albums) as album
    where album->>'entity_id' ~ '^[0-9]+$'
  );

  -- The album ids go in as an array through EXECUTE ... USING so the plan
  -- sees the real ids. Joined against the rankings set function instead, the
  -- planner guessed ~4k tracks rather than ~300 and sequentially scanned all of
  -- track_artists (285ms against 33ms).
  execute $q$
    with track_primary_artists as (
      select distinct on (t.id) t.album_id, ar.name
      from public.tracks t
      join public.track_artists ta on ta.track_id = t.id
      join public.artists ar on ar.id = ta.artist_id
      where t.album_id = any($2)
      order by t.id, ta.artist_order
    ),
    album_artists as (
      select distinct on (tpa.album_id) tpa.album_id, tpa.name
      from track_primary_artists tpa
      group by tpa.album_id, tpa.name
      order by tpa.album_id, count(*) desc, tpa.name
    )
    select coalesce(
      jsonb_agg(
        album.value || jsonb_build_object('image_url', al.image_url, 'artist_name', aa.name)
        order by album.ordinality
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements($1) with ordinality as album
    left join public.albums al
      on al.id = case when album.value->>'entity_id' ~ '^[0-9]+$' then (album.value->>'entity_id')::bigint end
    left join album_artists aa on aa.album_id = al.id
  $q$
  into v_albums
  using v_albums, v_album_ids;

  return jsonb_build_object('artists', v_artists, 'tracks', v_tracks, 'albums', v_albums);
end;
$fn$;

revoke all on function public.public_profile_home_band(text, date, date, integer, integer) from public;
grant execute on function public.public_profile_home_band(text, date, date, integer, integer) to anon, authenticated;
