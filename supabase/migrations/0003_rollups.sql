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
    from listening_events;
  else
    dates_to_refresh := target_dates;
  end if;

  delete from rollup_daily_entity_stats
  where target_dates is null
     or local_date = any(dates_to_refresh);

  insert into rollup_daily_entity_stats (
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
  where e.primary_artist_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, e.primary_artist_id, a.name;

  insert into rollup_daily_entity_stats (
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
  where e.track_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, e.track_id, t.name;

  insert into rollup_daily_entity_stats (
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
  where e.album_id is not null
    and (target_dates is null or e.local_date = any(dates_to_refresh))
  group by e.local_date, e.album_id, al.name;

  insert into rollup_daily_entity_stats (
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
  where e.primary_artist_id is not null
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
  delete from public_activity_recent;

  insert into public_activity_recent (
    id,
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
  order by e.played_at desc
  limit greatest(1, least(limit_count, 500));
end;
$$;

create or replace function public.refresh_overview_cache()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  melbourne_today date := (now() at time zone 'Australia/Melbourne')::date;
  week_start date := date_trunc('week', now() at time zone 'Australia/Melbourne')::date;
  payload jsonb;
begin
  select jsonb_build_object(
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
      where id = 1
    ),
    'today', jsonb_build_object(
      'minutes', coalesce((
        select sum(minutes_exact + minutes_inferred)
        from rollup_daily_entity_stats
        where entity_type = 'artist'
          and local_date = melbourne_today
      ), 0),
      'top_artist', (
        select entity_name
        from rollup_daily_entity_stats
        where entity_type = 'artist'
          and local_date = melbourne_today
        order by (minutes_exact + minutes_inferred) desc, plays desc
        limit 1
      ),
      'top_track', (
        select entity_name
        from rollup_daily_entity_stats
        where entity_type = 'track'
          and local_date = melbourne_today
        order by (minutes_exact + minutes_inferred) desc, plays desc
        limit 1
      ),
      'top_genre', (
        select entity_name
        from rollup_daily_entity_stats
        where entity_type = 'genre'
          and local_date = melbourne_today
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
            sum(plays)::integer as plays
          from rollup_daily_entity_stats
          where entity_type = 'genre'
            and local_date >= week_start
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
            sum(plays)::integer as plays
          from rollup_daily_entity_stats
          where entity_type = 'track'
            and local_date >= week_start
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
      ), 0),
      'top_artists', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.minutes desc, r.plays desc)
        from (
          select
            entity_id,
            entity_name,
            round(sum(minutes_exact + minutes_inferred), 2) as minutes,
            sum(plays)::integer as plays
          from rollup_daily_entity_stats
          where entity_type = 'artist'
            and local_date >= melbourne_today - 29
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
            sum(plays)::integer as plays
          from rollup_daily_entity_stats
          where entity_type = 'genre'
            and local_date >= melbourne_today - 29
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
          group by local_date
          order by local_date
        ) r
      ), '[]'::jsonb)
    )
  )
  into payload;

  insert into overview_cache (key, payload, generated_at)
  values ('public_home', payload, now())
  on conflict (key) do update
    set payload = excluded.payload,
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

create or replace function public.db_size_report()
returns jsonb
language sql
security invoker
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database()),
    'database_size_pretty', pg_size_pretty(pg_database_size(current_database())),
    'largest_tables', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.total_size_bytes desc)
      from (
        select
          schemaname,
          relname as table_name,
          pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) as total_size_bytes,
          pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)) as total_size,
          pg_relation_size(format('%I.%I', schemaname, relname)::regclass) as table_size_bytes,
          pg_size_pretty(pg_relation_size(format('%I.%I', schemaname, relname)::regclass)) as table_size,
          pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) - pg_relation_size(format('%I.%I', schemaname, relname)::regclass) as index_size_bytes,
          pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) - pg_relation_size(format('%I.%I', schemaname, relname)::regclass)) as index_size
        from pg_stat_user_tables
        order by pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) desc
        limit 20
      ) t
    ), '[]'::jsonb),
    'largest_indexes', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.index_size_bytes desc)
      from (
        select
          schemaname,
          relname as table_name,
          indexrelname as index_name,
          idx_scan,
          pg_relation_size(indexrelid) as index_size_bytes,
          pg_size_pretty(pg_relation_size(indexrelid)) as index_size
        from pg_stat_user_indexes
        order by pg_relation_size(indexrelid) desc
        limit 20
      ) i
    ), '[]'::jsonb),
    'unused_indexes', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.index_size_bytes desc)
      from (
        select
          schemaname,
          relname as table_name,
          indexrelname as index_name,
          pg_relation_size(indexrelid) as index_size_bytes,
          pg_size_pretty(pg_relation_size(indexrelid)) as index_size
        from pg_stat_user_indexes
        where idx_scan = 0
        order by pg_relation_size(indexrelid) desc
        limit 20
      ) i
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.refresh_rollups(date[]) from anon, authenticated;
revoke all on function public.refresh_activity_recent(integer) from anon, authenticated;
revoke all on function public.refresh_overview_cache() from anon, authenticated;
revoke all on function public.refresh_public_stats(date[]) from anon, authenticated;
revoke all on function public.db_size_report() from anon, authenticated;

grant execute on function public.refresh_rollups(date[]) to service_role;
grant execute on function public.refresh_activity_recent(integer) to service_role;
grant execute on function public.refresh_overview_cache() to service_role;
grant execute on function public.refresh_public_stats(date[]) to service_role;
grant execute on function public.db_size_report() to service_role;
