-- public_profile_album_top_tracks hit the 3s anon statement timeout for any
-- range longer than about a month (15s for six months).
--
-- Two causes:
-- 1. As a SQL function with `set search_path` it is never inlined, so Postgres
--    plans it once with the arguments unknown. That generic plan expects one
--    rollup row and rescans tracks (no album_id index) for each of the ~3.7k
--    track rows in six months.
-- 2. Even with the real values, joining on `t.id::text = r.entity_id` reads every
--    track row in the date range (89k for all time) and keeps the album's few.
--
-- The rewrite finds the album's track ids first, then reads only their rollup
-- rows through rollup_daily_entity_stats_user_entity_id_idx. It runs through
-- EXECUTE ... USING so each call gets a plan made with the real values; a
-- generic plan picks the (user_id, local_date, ...) index instead and takes 3s.
-- Measured as anon: 11ms for all time, down from 3.6s.
--
-- It reads the base table instead of public_profile_rollup_daily_entity_stats,
-- so it applies the view's two filters itself: the profile must be public and
-- archived rows are excluded. It stays security invoker, so the table's RLS
-- still applies on top.

create index if not exists tracks_album_id_idx on public.tracks (album_id);

create or replace function public.public_profile_album_top_tracks(
  p_slug text,
  p_album_id bigint,
  p_start_date date,
  p_end_date date,
  p_sort_metric text default 'plays',
  p_limit integer default 12
)
returns table (
  entity_id text,
  entity_name text,
  minutes numeric,
  plays integer,
  qualified_plays integer,
  unique_tracks integer,
  skipped_count integer,
  known_skip_count integer,
  unknown_duration_plays integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
begin
  return query execute $q$
    with aggregated as (
      select
        r.entity_id,
        max(r.entity_name) as entity_name,
        sum(coalesce(r.minutes_exact, 0) + coalesce(r.minutes_inferred, 0))::numeric as minutes,
        sum(r.plays)::integer as plays,
        sum(r.qualified_plays)::integer as qualified_plays,
        sum(r.unique_tracks)::integer as unique_tracks,
        sum(coalesce(r.skipped_count, 0))::integer as skipped_count,
        sum(coalesce(r.known_skip_count, 0))::integer as known_skip_count,
        sum(r.unknown_duration_plays)::integer as unknown_duration_plays
      from public.rollup_daily_entity_stats r
      where r.user_id = (
          select p.user_id from public.profiles p where p.slug = $1 and p.is_public
        )
        and r.archived_at is null
        and r.entity_type = 'track'
        and r.entity_id = any (
          (select array_agg(t.id::text) from public.tracks t where t.album_id = $2)::text[]
        )
        and r.local_date between $3 and $4
      group by r.entity_id
    )
    select
      aggregated.entity_id,
      aggregated.entity_name,
      aggregated.minutes,
      aggregated.plays,
      aggregated.qualified_plays,
      aggregated.unique_tracks,
      aggregated.skipped_count,
      aggregated.known_skip_count,
      aggregated.unknown_duration_plays
    from aggregated
    order by
      case when $5 = 'minutes' then aggregated.minutes end desc nulls last,
      case when $5 = 'qualified_plays' then aggregated.qualified_plays::numeric end desc nulls last,
      case when $5 = 'unique_tracks' then aggregated.unique_tracks::numeric end desc nulls last,
      case
        when $5 = 'skip_rate'
        then aggregated.skipped_count::numeric / nullif(aggregated.known_skip_count, 0)
      end desc nulls last,
      case
        when $5 is null
          or $5 not in ('minutes', 'qualified_plays', 'unique_tracks', 'skip_rate')
        then aggregated.plays::numeric
      end desc nulls last,
      aggregated.plays desc,
      aggregated.entity_name asc
    limit greatest(0, least(coalesce($6, 12), 100))
  $q$
  using p_slug, p_album_id, p_start_date, p_end_date, p_sort_metric, p_limit;
end;
$fn$;

revoke all on function public.public_profile_album_top_tracks(text, bigint, date, date, text, integer)
  from public;
grant execute on function public.public_profile_album_top_tracks(text, bigint, date, date, text, integer)
  to anon, authenticated;
