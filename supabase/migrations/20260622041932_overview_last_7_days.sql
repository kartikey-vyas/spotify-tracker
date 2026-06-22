create or replace function public.build_overview_payload(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  melbourne_today date := (now() at time zone 'Australia/Melbourne')::date;
  last_7_days_start date := melbourne_today - 6;
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
          and local_date >= last_7_days_start
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
            and local_date >= last_7_days_start
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
            and local_date >= last_7_days_start
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
            and local_date >= last_7_days_start
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

do $$
declare
  profile_record record;
begin
  perform public.refresh_overview_cache();

  for profile_record in select user_id from profiles loop
    perform public.refresh_user_overview_cache(profile_record.user_id);
  end loop;
end;
$$;
