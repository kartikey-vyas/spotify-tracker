create or replace function public.public_profile_rankings(
  p_slug text,
  p_entity_type text,
  p_start_date date,
  p_end_date date,
  p_sort_metric text default 'plays',
  p_limit integer default 50
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
language sql
stable
security invoker
set search_path = public
as $$
  with aggregated as (
    select
      r.entity_id::text as entity_id,
      max(r.entity_name) as entity_name,
      sum(coalesce(r.minutes_exact, 0) + coalesce(r.minutes_inferred, 0))::numeric as minutes,
      sum(r.plays)::integer as plays,
      sum(r.qualified_plays)::integer as qualified_plays,
      sum(r.unique_tracks)::integer as unique_tracks,
      sum(coalesce(r.skipped_count, 0))::integer as skipped_count,
      sum(coalesce(r.known_skip_count, 0))::integer as known_skip_count,
      sum(r.unknown_duration_plays)::integer as unknown_duration_plays
    from public_profile_rollup_daily_entity_stats r
    where r.slug = p_slug
      and r.entity_type = p_entity_type
      and r.local_date between p_start_date and p_end_date
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
    case when p_sort_metric = 'minutes' then aggregated.minutes end desc nulls last,
    case when p_sort_metric = 'qualified_plays' then aggregated.qualified_plays::numeric end desc nulls last,
    case when p_sort_metric = 'unique_tracks' then aggregated.unique_tracks::numeric end desc nulls last,
    case
      when p_sort_metric = 'skip_rate'
      then aggregated.skipped_count::numeric / nullif(aggregated.known_skip_count, 0)
    end desc nulls last,
    case
      when p_sort_metric is null
        or p_sort_metric not in ('minutes', 'qualified_plays', 'unique_tracks', 'skip_rate')
      then aggregated.plays::numeric
    end desc nulls last,
    aggregated.plays desc,
    aggregated.entity_name asc
  limit greatest(0, least(coalesce(p_limit, 50), 500));
$$;

revoke all on function public.public_profile_rankings(text, text, date, date, text, integer) from public;
grant execute on function public.public_profile_rankings(text, text, date, date, text, integer) to anon, authenticated;
