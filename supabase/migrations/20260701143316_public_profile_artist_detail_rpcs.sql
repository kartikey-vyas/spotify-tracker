create or replace function public.public_profile_artist_summary(
  p_slug text,
  p_artist_id bigint,
  p_start_date date,
  p_end_date date
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
security definer
set search_path = public
as $$
  select
    e.primary_artist_id::text as entity_id,
    a.name as entity_name,
    sum(coalesce(e.ms_played, 0) + coalesce(e.inferred_ms_played, 0))::numeric / 60000 as minutes,
    count(*)::integer as plays,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000)::integer as qualified_plays,
    count(distinct e.track_id)::integer as unique_tracks,
    count(*) filter (where e.skipped is true)::integer as skipped_count,
    count(e.skipped)::integer as known_skip_count,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)::integer as unknown_duration_plays
  from profiles p
  join listening_events e on e.user_id = p.user_id
  join artists a on a.id = e.primary_artist_id
  where p.slug = p_slug
    and p.is_public = true
    and e.primary_artist_id = p_artist_id
    and e.local_date between p_start_date and p_end_date
    and e.archived_at is null
  group by e.primary_artist_id, a.name;
$$;

create or replace function public.public_profile_artist_top_albums(
  p_slug text,
  p_artist_id bigint,
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
language sql
stable
security definer
set search_path = public
as $$
  select
    e.album_id::text as entity_id,
    al.name as entity_name,
    sum(coalesce(e.ms_played, 0) + coalesce(e.inferred_ms_played, 0))::numeric / 60000 as minutes,
    count(*)::integer as plays,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000)::integer as qualified_plays,
    count(distinct e.track_id)::integer as unique_tracks,
    count(*) filter (where e.skipped is true)::integer as skipped_count,
    count(e.skipped)::integer as known_skip_count,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)::integer as unknown_duration_plays
  from profiles p
  join listening_events e on e.user_id = p.user_id
  join albums al on al.id = e.album_id
  where p.slug = p_slug
    and p.is_public = true
    and e.primary_artist_id = p_artist_id
    and e.album_id is not null
    and e.local_date between p_start_date and p_end_date
    and e.archived_at is null
  group by e.album_id, al.name
  order by
    case when p_sort_metric = 'minutes' then sum(coalesce(e.ms_played, 0) + coalesce(e.inferred_ms_played, 0))::numeric / 60000 end desc nulls last,
    case when p_sort_metric = 'qualified_plays' then count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000)::numeric end desc nulls last,
    case when p_sort_metric = 'unique_tracks' then count(distinct e.track_id)::numeric end desc nulls last,
    case when p_sort_metric = 'skip_rate' then (count(*) filter (where e.skipped is true))::numeric / nullif(count(e.skipped), 0) end desc nulls last,
    case when p_sort_metric is null or p_sort_metric not in ('minutes', 'qualified_plays', 'unique_tracks', 'skip_rate') then count(*)::numeric end desc nulls last,
    count(*) desc,
    al.name asc
  limit greatest(0, least(coalesce(p_limit, 12), 100));
$$;

create or replace function public.public_profile_artist_top_tracks(
  p_slug text,
  p_artist_id bigint,
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
language sql
stable
security definer
set search_path = public
as $$
  select
    e.track_id::text as entity_id,
    t.name as entity_name,
    sum(coalesce(e.ms_played, 0) + coalesce(e.inferred_ms_played, 0))::numeric / 60000 as minutes,
    count(*)::integer as plays,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000)::integer as qualified_plays,
    count(distinct e.track_id)::integer as unique_tracks,
    count(*) filter (where e.skipped is true)::integer as skipped_count,
    count(e.skipped)::integer as known_skip_count,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)::integer as unknown_duration_plays
  from profiles p
  join listening_events e on e.user_id = p.user_id
  join tracks t on t.id = e.track_id
  where p.slug = p_slug
    and p.is_public = true
    and e.primary_artist_id = p_artist_id
    and e.track_id is not null
    and e.local_date between p_start_date and p_end_date
    and e.archived_at is null
  group by e.track_id, t.name
  order by
    case when p_sort_metric = 'minutes' then sum(coalesce(e.ms_played, 0) + coalesce(e.inferred_ms_played, 0))::numeric / 60000 end desc nulls last,
    case when p_sort_metric = 'qualified_plays' then count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000)::numeric end desc nulls last,
    case when p_sort_metric = 'unique_tracks' then count(distinct e.track_id)::numeric end desc nulls last,
    case when p_sort_metric = 'skip_rate' then (count(*) filter (where e.skipped is true))::numeric / nullif(count(e.skipped), 0) end desc nulls last,
    case when p_sort_metric is null or p_sort_metric not in ('minutes', 'qualified_plays', 'unique_tracks', 'skip_rate') then count(*)::numeric end desc nulls last,
    count(*) desc,
    t.name asc
  limit greatest(0, least(coalesce(p_limit, 12), 100));
$$;

create or replace function public.public_profile_artist_monthly_timeline(
  p_slug text,
  p_artist_id bigint,
  p_start_date date,
  p_end_date date
)
returns table (
  month_start date,
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
security definer
set search_path = public
as $$
  select
    date_trunc('month', e.local_date)::date as month_start,
    sum(coalesce(e.ms_played, 0) + coalesce(e.inferred_ms_played, 0))::numeric / 60000 as minutes,
    count(*)::integer as plays,
    count(*) filter (where coalesce(e.ms_played, e.inferred_ms_played, 0) >= 30000)::integer as qualified_plays,
    count(distinct e.track_id)::integer as unique_tracks,
    count(*) filter (where e.skipped is true)::integer as skipped_count,
    count(e.skipped)::integer as known_skip_count,
    count(*) filter (where e.ms_played is null and e.inferred_ms_played is null)::integer as unknown_duration_plays
  from profiles p
  join listening_events e on e.user_id = p.user_id
  where p.slug = p_slug
    and p.is_public = true
    and e.primary_artist_id = p_artist_id
    and e.local_date between p_start_date and p_end_date
    and e.archived_at is null
  group by date_trunc('month', e.local_date)::date
  order by month_start asc;
$$;

revoke all on function public.public_profile_artist_summary(text, bigint, date, date) from public;
revoke all on function public.public_profile_artist_top_albums(text, bigint, date, date, text, integer) from public;
revoke all on function public.public_profile_artist_top_tracks(text, bigint, date, date, text, integer) from public;
revoke all on function public.public_profile_artist_monthly_timeline(text, bigint, date, date) from public;

grant execute on function public.public_profile_artist_summary(text, bigint, date, date) to anon, authenticated;
grant execute on function public.public_profile_artist_top_albums(text, bigint, date, date, text, integer) to anon, authenticated;
grant execute on function public.public_profile_artist_top_tracks(text, bigint, date, date, text, integer) to anon, authenticated;
grant execute on function public.public_profile_artist_monthly_timeline(text, bigint, date, date) to anon, authenticated;
