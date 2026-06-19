create or replace function public.refresh_activity_recent(limit_count integer default 100)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public_activity_recent
  where true;

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
