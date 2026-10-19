-- public_profile_rankings read public_profile_rollup_daily_entity_stats as
-- security invoker, so the table's RLS policy ran a profiles lookup for every
-- rollup row it read. An all-time track ranking reads ~89k rows: 0.4s warm and
-- 2.5s cold, close to the 3s anon statement timeout.
--
-- The rewrite checks once that the slug belongs to a public profile, then reads
-- that user's rows from rollup_daily_entity_stats directly (86ms for the same
-- ranking). It is security definer so RLS is not re-checked per row; it applies
-- the view's filters itself, which is everything the view and RLS together let
-- anon read: the profile must be public, and archived rows are excluded.
--
-- It runs through EXECUTE ... USING so each call is planned with the real
-- values, the same as public_profile_album_top_tracks (20261019090000).

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
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid;
begin
  select p.user_id into v_user_id
  from public.profiles p
  where p.slug = p_slug and p.is_public;

  if v_user_id is null then
    return;
  end if;

  return query execute $q$
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
      from public.rollup_daily_entity_stats r
      where r.user_id = $1
        and r.archived_at is null
        and r.entity_type = $2
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
      aggregated.entity_name asc,
      -- Two entities can share a name and a count (two "Everybody Knows"
      -- tracks); without this their order changed between calls.
      aggregated.entity_id asc
    limit greatest(0, least(coalesce($6, 50), 500))
  $q$
  using v_user_id, p_entity_type, p_start_date, p_end_date, p_sort_metric, p_limit;
end;
$fn$;

revoke all on function public.public_profile_rankings(text, text, date, date, text, integer) from public;
grant execute on function public.public_profile_rankings(text, text, date, date, text, integer) to anon, authenticated;
