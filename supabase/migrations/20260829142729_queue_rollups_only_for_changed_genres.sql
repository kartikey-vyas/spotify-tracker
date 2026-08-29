-- Track and album tag reports can refresh the same primary artist many times.
-- Queueing every historic listening date after every refresh produced large
-- amounts of duplicate rollup work even when the public genre set did not
-- change. Snapshot the curated projection around the existing refresh and
-- enqueue only artists whose effective genre set actually changed.

create or replace function public.refresh_lastfm_artist_genres_and_queue(
  p_artist_ids bigint[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_artist_ids bigint[];
  v_before jsonb;
  v_after jsonb;
  v_changed_ids bigint[];
  v_genres_projected integer := 0;
  v_rollup_dates_queued integer := 0;
begin
  select coalesce(array_agg(distinct requested.artist_id order by requested.artist_id), '{}')
    into v_artist_ids
    from unnest(coalesce(p_artist_ids, '{}')) as requested(artist_id);

  if cardinality(v_artist_ids) = 0 then
    return jsonb_build_object(
      'artists_changed', 0,
      'genres_projected', 0,
      'rollup_dates_queued', 0
    );
  end if;

  select coalesce(jsonb_object_agg(snapshot.artist_id::text, snapshot.genres), '{}'::jsonb)
    into v_before
    from (
      select requested.artist_id,
             coalesce(
               to_jsonb(array_agg(ag.genre order by ag.genre) filter (where ag.genre is not null)),
               '[]'::jsonb
             ) as genres
        from unnest(v_artist_ids) as requested(artist_id)
        left join public.artist_genres ag on ag.artist_id = requested.artist_id
       group by requested.artist_id
    ) snapshot;

  v_genres_projected := public.refresh_lastfm_artist_genres(v_artist_ids);

  select coalesce(jsonb_object_agg(snapshot.artist_id::text, snapshot.genres), '{}'::jsonb)
    into v_after
    from (
      select requested.artist_id,
             coalesce(
               to_jsonb(array_agg(ag.genre order by ag.genre) filter (where ag.genre is not null)),
               '[]'::jsonb
             ) as genres
        from unnest(v_artist_ids) as requested(artist_id)
        left join public.artist_genres ag on ag.artist_id = requested.artist_id
       group by requested.artist_id
    ) snapshot;

  select coalesce(array_agg(requested.artist_id order by requested.artist_id), '{}')
    into v_changed_ids
    from unnest(v_artist_ids) as requested(artist_id)
   where (v_before -> requested.artist_id::text)
         is distinct from
         (v_after -> requested.artist_id::text);

  if cardinality(v_changed_ids) > 0 then
    v_rollup_dates_queued := public.queue_rollup_refresh_for_artists(v_changed_ids);
  end if;

  return jsonb_build_object(
    'artists_changed', cardinality(v_changed_ids),
    'genres_projected', v_genres_projected,
    'rollup_dates_queued', v_rollup_dates_queued
  );
end;
$$;

revoke all on function public.refresh_lastfm_artist_genres_and_queue(bigint[])
from public, anon, authenticated;
grant execute on function public.refresh_lastfm_artist_genres_and_queue(bigint[])
to service_role;

notify pgrst, 'reload schema';
