-- Simplify the listening clock to an hour-only profile.
--
-- The radial clock shows time-of-day only, so the `clock` aggregation drops the
-- weekday (dow) dimension and groups by hour alone — smaller payload, simpler
-- type. Also hoist the release-year cutoff into a declared constant instead of
-- recomputing it in the WHERE clause. Everything else in build_overview_payload
-- is unchanged from 20260630230000_overview_clock_last_30_days.sql.
create or replace function public.build_overview_payload(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  melbourne_today date := (now() at time zone 'Australia/Melbourne')::date;
  last_7_days_start date := melbourne_today - 6;
  max_release_year int := extract(year from now())::int + 1;
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
        order by plays desc, (minutes_exact + minutes_inferred) desc
        limit 1
      ),
      'top_track', (
        select entity_name
        from rollup_daily_entity_stats
        where entity_type = 'track'
          and local_date = melbourne_today
          and ((p_user_id is null and user_id is null) or user_id = p_user_id)
        order by plays desc, (minutes_exact + minutes_inferred) desc
        limit 1
      ),
      'top_genre', (
        select entity_name
        from rollup_daily_entity_stats
        where entity_type = 'genre'
          and local_date = melbourne_today
          and ((p_user_id is null and user_id is null) or user_id = p_user_id)
        order by plays desc, (minutes_exact + minutes_inferred) desc
        limit 1
      )
    ),
    'this_week', jsonb_build_object(
      'minutes', coalesce((
        select sum(minutes_exact + minutes_inferred)
        from rollup_daily_entity_stats
        where entity_type = 'artist'
          and local_date >= last_7_days_start
          and ((p_user_id is null and user_id is null) or user_id = p_user_id)
      ), 0),
      'top_artists', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.plays desc, r.minutes desc)
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
            and local_date >= last_7_days_start
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by entity_id, entity_name
          order by plays desc, minutes desc
          limit 10
        ) r
      ), '[]'::jsonb),
      'top_genres', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.plays desc, r.minutes desc)
        from (
          select
            entity_id,
            entity_name,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays,
            sum(unknown_duration_plays)::integer as unknown_duration_plays
          from rollup_daily_entity_stats
          where entity_type = 'genre'
            and local_date >= last_7_days_start
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by entity_id, entity_name
          order by plays desc, minutes desc
          limit 10
        ) r
      ), '[]'::jsonb),
      'top_tracks', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.plays desc, r.minutes desc)
        from (
          select
            entity_id,
            entity_name,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays,
            sum(unknown_duration_plays)::integer as unknown_duration_plays
          from rollup_daily_entity_stats
          where entity_type = 'track'
            and local_date >= last_7_days_start
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by entity_id, entity_name
          order by plays desc, minutes desc
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
        select jsonb_agg(to_jsonb(r) order by r.plays desc, r.minutes desc)
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
          order by plays desc, minutes desc
          limit 10
        ) r
      ), '[]'::jsonb),
      'top_genres', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.plays desc, r.minutes desc)
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
          order by plays desc, minutes desc
          limit 10
        ) r
      ), '[]'::jsonb)
    ),
    'calendar', jsonb_build_object(
      'daily', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.local_date)
        from (
          select
            local_date,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays
          from rollup_daily_entity_stats
          where entity_type = 'artist'
            and ((p_user_id is null and user_id is null) or user_id = p_user_id)
          group by local_date
          order by local_date
        ) r
      ), '[]'::jsonb)
    ),
    'clock', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.hour)
      from (
        select
          extract(hour from (played_at at time zone 'Australia/Melbourne'))::int as hour,
          count(*)::int as plays
        from listening_events
        where ((p_user_id is null and user_id is null) or user_id = p_user_id)
          and local_date >= melbourne_today - 29
        group by 1
      ) r
    ), '[]'::jsonb),
    'release_years', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.year)
      from (
        select
          left(al.release_date, 4)::int as year,
          count(*)::int as plays
        from listening_events e
        join albums al on al.id = e.album_id
        where ((p_user_id is null and user_id is null) or e.user_id = p_user_id)
          and al.album_type is distinct from 'compilation'
          and al.release_date ~ '^[0-9]{4}'
          and left(al.release_date, 4)::int between 1900 and max_release_year
        group by 1
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

-- Rebuild every cached overview so the new fields appear immediately.
do $$
declare
  profile_record record;
begin
  for profile_record in select user_id from profiles loop
    perform public.refresh_user_overview_cache(profile_record.user_id);
  end loop;
end;
$$;
