-- wikipedia_link_candidates took 8-14 s and hit the service statement timeout.
-- With "no link or a stale link" as one OR filter, the planner estimated one
-- row and nested-looped the played-artist aggregate (59M row pairs). An
-- anti-join keeps its estimates sane: 84 ms on 8.4k played artists.
create or replace function public.wikipedia_link_candidates(p_limit integer)
returns table (artist_id bigint, spotify_artist_id text)
language sql
stable
security invoker
set search_path = public
as $$
  with played as (
    select e.primary_artist_id as artist_id, count(*) as plays
    from listening_events e
    where e.archived_at is null
      and e.primary_artist_id is not null
    group by e.primary_artist_id
  )
  select a.id, a.spotify_artist_id
  from played p
  join artists a on a.id = p.artist_id
  where a.spotify_artist_id is not null
    and not exists (
      select 1
      from artist_wikipedia_links l
      where l.artist_id = a.id
        and l.checked_at >= now() - interval '90 days'
    )
  order by
    (select l.checked_at from artist_wikipedia_links l where l.artist_id = a.id) nulls first,
    p.plays desc,
    a.id
  limit greatest(p_limit, 0);
$$;

revoke all on function public.wikipedia_link_candidates(integer) from public, anon, authenticated;
grant execute on function public.wikipedia_link_candidates(integer) to service_role;

analyze public.artist_wikipedia_links;
analyze public.wikipedia_articles;
