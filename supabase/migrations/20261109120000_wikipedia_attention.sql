-- Popularity at the time of play, from English Wikipedia page views.
--
-- Last.fm keeps no history, so the popularity score uses today's listener
-- counts. This adds a second score: today's listeners times a multiplier for
-- the month of play, from how much attention the artist's Wikipedia article
-- had then compared with the last 12 months. The evidence and the formula
-- choice are in docs/popularity-score-plan.md ("Attention-adjusted score").
--
-- Data flow:
--   1. The refresh-wikipedia-attention Edge Function (pg_cron, every 15
--      minutes; the local scripts/wikipedia-attention.ts for the first
--      backfill) links played artists to articles through Wikidata P1902
--      (Spotify artist ID), finds redirects that name the same artist, and fetches
--      monthly user page views per article from July 2015.
--   2. refresh_wikipedia_attention() turns views into one multiplier per
--      article and month. The function calls it when no fetch work is left.
--   3. build_insights_payload() reads the multipliers. Plays without an
--      article keep today's listener count.
--
-- Monthly views are stored as one integer array per article (a few MB in
-- total), because the database is close to its size limit.
-- All tables here are service-only. The browser sees the finished aggregates
-- in the insights cache.

-- 1. Tables.
create table public.wikipedia_articles (
  id bigint generated always as identity primary key,
  -- Current English Wikipedia title, with spaces.
  title text not null unique,
  wikidata_qid text,
  -- Redirects whose title names the same artist (mostly former titles from
  -- page moves). Their views count for the article; without them a renamed
  -- article looks new. The column name predates that wider rule.
  former_titles text[] not null default '{}',
  redirects_checked_at timestamptz,
  -- views[1] is the month views_from; one element per month, zeros included.
  views_from date,
  views integer[] not null default '{}',
  -- The last month fetched. Set even when the article has no views.
  views_through date,
  -- Aligned with views. Null elements fall back to today's listener count.
  multipliers real[],
  multipliers_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wikipedia_articles_title_check check (btrim(title) <> ''),
  constraint wikipedia_articles_months_check check (
    (views_from is null or views_from = date_trunc('month', views_from)::date)
    and (views_through is null or views_through = date_trunc('month', views_through)::date)
  ),
  constraint wikipedia_articles_views_check check (
    (views_from is null) = (cardinality(views) = 0)
  )
);

create table public.artist_wikipedia_links (
  artist_id bigint primary key references public.artists(id) on delete cascade,
  -- Null when Wikidata has no item with this Spotify ID.
  wikidata_qid text,
  -- Null when the item has no English article.
  article_id bigint references public.wikipedia_articles(id) on delete set null,
  checked_at timestamptz not null default now()
);

create index artist_wikipedia_links_article_idx
  on public.artist_wikipedia_links (article_id);

-- All of English Wikipedia, user agent. Total traffic fell by about a quarter
-- between 2015 and 2026, so each article's views are divided by this.
create table public.wikipedia_site_monthly (
  month date primary key,
  views bigint not null,
  fetched_at timestamptz not null default now(),
  constraint wikipedia_site_monthly_month_check
    check (month = date_trunc('month', month)::date)
);

alter table public.wikipedia_articles enable row level security;
alter table public.artist_wikipedia_links enable row level security;
alter table public.wikipedia_site_monthly enable row level security;
revoke all on table public.wikipedia_articles from anon, authenticated;
revoke all on table public.artist_wikipedia_links from anon, authenticated;
revoke all on table public.wikipedia_site_monthly from anon, authenticated;
grant select, insert, update, delete on table public.wikipedia_articles to service_role;
grant select, insert, update, delete on table public.artist_wikipedia_links to service_role;
grant select, insert, update, delete on table public.wikipedia_site_monthly to service_role;

-- 2. Work lists and saves for the fetcher.

-- Played artists with no link yet, then links older than 90 days (articles
-- get created and renamed). Most-played first.
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
  left join artist_wikipedia_links l on l.artist_id = a.id
  where a.spotify_artist_id is not null
    and (l.artist_id is null or l.checked_at < now() - interval '90 days')
  order by l.checked_at nulls first, p.plays desc, a.id
  limit greatest(p_limit, 0);
$$;

-- p_links: [{artist_id, qid, title}], qid and title null when nothing matched.
create or replace function public.save_wikipedia_links(p_links jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved integer;
begin
  insert into wikipedia_articles (title, wikidata_qid)
  select distinct on (x.title) x.title, x.qid
  from jsonb_to_recordset(p_links) as x(artist_id bigint, qid text, title text)
  where x.title is not null
  order by x.title, x.qid
  on conflict (title) do update
    set wikidata_qid = excluded.wikidata_qid,
        updated_at = now()
    where wikipedia_articles.wikidata_qid is distinct from excluded.wikidata_qid;

  insert into artist_wikipedia_links (artist_id, wikidata_qid, article_id, checked_at)
  select x.artist_id, x.qid, w.id, now()
  from jsonb_to_recordset(p_links) as x(artist_id bigint, qid text, title text)
  left join wikipedia_articles w on w.title = x.title
  on conflict (artist_id) do update
    set wikidata_qid = excluded.wikidata_qid,
        article_id = excluded.article_id,
        checked_at = excluded.checked_at;
  get diagnostics saved = row_count;

  -- An article no artist links to any more is not fetched again.
  delete from wikipedia_articles w
  where not exists (select 1 from artist_wikipedia_links l where l.article_id = w.id);

  return saved;
end;
$$;

create or replace function public.wikipedia_redirect_candidates(p_limit integer)
returns table (id bigint, title text)
language sql
stable
security invoker
set search_path = public
as $$
  select w.id, w.title
  from wikipedia_articles w
  where w.redirects_checked_at is null
     or w.redirects_checked_at < now() - interval '90 days'
  order by w.redirects_checked_at nulls first, w.id
  limit greatest(p_limit, 0);
$$;

-- p_updates: [{id, former_titles: [..]}]. A changed list clears the views, so
-- the next fetch takes the full history again with the new titles.
create or replace function public.save_wikipedia_former_titles(p_updates jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved integer;
begin
  with updates as (
    select
      x.id,
      coalesce(
        array(
          select distinct t
          from jsonb_array_elements_text(coalesce(x.former_titles, '[]'::jsonb)) as t
          order by t
        ),
        '{}'
      ) as former_titles
    from jsonb_to_recordset(p_updates) as x(id bigint, former_titles jsonb)
  )
  update wikipedia_articles w
  set former_titles = u.former_titles,
      redirects_checked_at = now(),
      updated_at = now(),
      views_from = case when w.former_titles = u.former_titles then w.views_from end,
      views = case when w.former_titles = u.former_titles then w.views else '{}' end,
      views_through = case when w.former_titles = u.former_titles then w.views_through end,
      multipliers = case when w.former_titles = u.former_titles then w.multipliers end,
      multipliers_through = case when w.former_titles = u.former_titles then w.multipliers_through end
  from updates u
  where w.id = u.id;
  get diagnostics saved = row_count;
  return saved;
end;
$$;

-- Articles whose views stop before p_through. Only after the former-title
-- check, so a renamed article is fetched once with all its titles.
create or replace function public.wikipedia_pageview_candidates(p_through date, p_limit integer)
returns table (
  id bigint,
  title text,
  former_titles text[],
  views_from date,
  views_through date
)
language sql
stable
security invoker
set search_path = public
as $$
  select w.id, w.title, w.former_titles, w.views_from, w.views_through
  from wikipedia_articles w
  where w.redirects_checked_at is not null
    and (w.views_through is null or w.views_through < p_through)
  order by w.views_through nulls first, w.id
  limit greatest(p_limit, 0);
$$;

-- p_append true adds months after views_through. Otherwise the history is
-- replaced; p_from is null when the article has no views at all.
create or replace function public.save_wikipedia_pageviews(
  p_article_id bigint,
  p_from date,
  p_views integer[],
  p_through date,
  p_append boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_row wikipedia_articles%rowtype;
begin
  select * into current_row from wikipedia_articles where id = p_article_id for update;
  if not found then
    return;
  end if;

  if p_append then
    if current_row.views_from is null
       or p_from <> (current_row.views_through + interval '1 month')::date then
      raise exception 'save_wikipedia_pageviews: % does not follow % for article %',
        p_from, current_row.views_through, p_article_id;
    end if;
    update wikipedia_articles
    set views = views || coalesce(p_views, '{}'),
        views_through = p_through,
        updated_at = now()
    where id = p_article_id;
  else
    update wikipedia_articles
    set views_from = case when cardinality(coalesce(p_views, '{}')) = 0 then null else p_from end,
        views = coalesce(p_views, '{}'),
        views_through = p_through,
        multipliers = null,
        multipliers_through = null,
        updated_at = now()
    where id = p_article_id;
  end if;
end;
$$;

-- p_rows: [{month, views}].
create or replace function public.save_wikipedia_site_months(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved integer;
begin
  insert into wikipedia_site_monthly (month, views, fetched_at)
  select x.month, x.views, now()
  from jsonb_to_recordset(p_rows) as x(month date, views bigint)
  on conflict (month) do update
    set views = excluded.views,
        fetched_at = excluded.fetched_at;
  get diagnostics saved = row_count;
  return saved;
end;
$$;

-- 3. Multipliers.
--
-- For article a and month m:
--   ratio = (mean views of a over m-5 .. m+6 / mean views of a over the latest
--            12 months) / (the same ratio for all of English Wikipedia)
--   multiplier = sqrt(clamp(ratio, 0.1, 10)), so between about 0.32 and 3.2.
--
-- The 12-month window stops release-month and news spikes (30-40x in single
-- months) from deciding a year. The square root is the measured relation
-- between page views and Last.fm listeners across 2,736 artists (slope 0.48
-- on log-log). A month before the article existed has no multiplier.
create or replace function public.refresh_wikipedia_attention()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_through date := (select max(month) from wikipedia_site_monthly);
  v_site_recent numeric;
  refreshed integer;
begin
  if v_through is null then
    return 0;
  end if;

  select avg(views) into v_site_recent
  from wikipedia_site_monthly
  where month > (v_through - interval '12 months')::date
    and month <= v_through;

  with series as (
    select
      w.id,
      s.ord,
      (w.views_from + (s.ord - 1) * interval '1 month')::date as month,
      s.views::numeric as views
    from wikipedia_articles w
    cross join lateral unnest(w.views) with ordinality as s(views, ord)
    where w.views_from is not null
      and w.views_through = v_through
  ),
  recent as (
    select id, coalesce(sum(views) filter (where month > (v_through - interval '12 months')::date), 0) / 12 as mean_views
    from series
    group by id
  ),
  windowed as (
    select
      s.id,
      s.ord,
      avg(s.views) over w as window_views,
      avg(site.views) over w as window_site
    from series s
    left join wikipedia_site_monthly site on site.month = s.month
    window w as (partition by s.id order by s.ord rows between 5 preceding and 6 following)
  ),
  computed as (
    select
      wd.id,
      array_agg(
        case when r.mean_views > 0 and wd.window_site > 0 then
          sqrt(least(10, greatest(0.1,
            (wd.window_views / r.mean_views) / (wd.window_site / v_site_recent)
          )))::real
        end
        order by wd.ord
      ) as multipliers
    from windowed wd
    join recent r using (id)
    group by wd.id
  )
  update wikipedia_articles w
  set multipliers = c.multipliers,
      multipliers_through = v_through,
      updated_at = now()
  from computed c
  where w.id = c.id;
  get diagnostics refreshed = row_count;

  -- Articles that are behind or have no views keep no multipliers.
  update wikipedia_articles
  set multipliers = null,
      multipliers_through = null,
      updated_at = now()
  where multipliers is not null
    and (views_from is null or views_through is distinct from v_through);

  return refreshed;
end;
$$;

create or replace function public.wikipedia_attention_progress()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with site as (select max(month) as through from wikipedia_site_monthly)
  select jsonb_build_object(
    'site_through', (select through from site),
    'artists_checked', (select count(*) from artist_wikipedia_links),
    'artists_with_article', (select count(*) from artist_wikipedia_links where article_id is not null),
    'artists_to_link', (select count(*) from public.wikipedia_link_candidates(100000)),
    'articles', (select count(*) from wikipedia_articles),
    'articles_with_former_titles', (select count(*) from wikipedia_articles where cardinality(former_titles) > 0),
    'articles_to_check_redirects', (select count(*) from wikipedia_articles where redirects_checked_at is null),
    'articles_to_fetch', (
      select count(*) from wikipedia_articles w, site
      where w.views_through is null or w.views_through < site.through
    ),
    'articles_with_multipliers', (select count(*) from wikipedia_articles where multipliers is not null),
    -- Fetched up to the newest month but not yet turned into multipliers.
    'articles_with_stale_multipliers', (
      select count(*) from wikipedia_articles w, site
      where w.views_from is not null
        and w.views_through = site.through
        and w.multipliers_through is distinct from site.through
    )
  );
$$;

revoke all on function public.wikipedia_link_candidates(integer) from public, anon, authenticated;
revoke all on function public.save_wikipedia_links(jsonb) from public, anon, authenticated;
revoke all on function public.wikipedia_redirect_candidates(integer) from public, anon, authenticated;
revoke all on function public.save_wikipedia_former_titles(jsonb) from public, anon, authenticated;
revoke all on function public.wikipedia_pageview_candidates(date, integer) from public, anon, authenticated;
revoke all on function public.save_wikipedia_pageviews(bigint, date, integer[], date, boolean) from public, anon, authenticated;
revoke all on function public.save_wikipedia_site_months(jsonb) from public, anon, authenticated;
revoke all on function public.refresh_wikipedia_attention() from public, anon, authenticated;
revoke all on function public.wikipedia_attention_progress() from public, anon, authenticated;
grant execute on function public.wikipedia_link_candidates(integer) to service_role;
grant execute on function public.save_wikipedia_links(jsonb) to service_role;
grant execute on function public.wikipedia_redirect_candidates(integer) to service_role;
grant execute on function public.save_wikipedia_former_titles(jsonb) to service_role;
grant execute on function public.wikipedia_pageview_candidates(date, integer) to service_role;
grant execute on function public.save_wikipedia_pageviews(bigint, date, integer[], date, boolean) to service_role;
grant execute on function public.save_wikipedia_site_months(jsonb) to service_role;
grant execute on function public.refresh_wikipedia_attention() to service_role;
grant execute on function public.wikipedia_attention_progress() to service_role;

-- 4. The insights payload gains popularity.adjusted: the same play-weighted
--    median with each play's listeners multiplied by its month's multiplier.
--    Everything else is unchanged from 20261020100000.
create or replace function public.build_insights_payload(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  melbourne_today date := (now() at time zone 'Australia/Melbourne')::date;
  result jsonb;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  with plays as (
    select
      e.local_date,
      e.track_id,
      e.primary_artist_id as artist_id,
      extract(hour from (e.played_at at time zone 'Australia/Melbourne'))::int as hour
    from listening_events e
    where e.user_id = p_user_id
      and e.archived_at is null
  ),
  -- Latest Last.fm listener count per artist. Artist stats are almost all
  -- name-matched, so they are trusted as they are.
  artist_listeners as (
    select distinct on (s.artist_id) s.artist_id, s.listeners, s.observed_on
    from external_music_stats s
    where s.source = 'lastfm'
      and s.artist_id is not null
      and s.listeners is not null
    order by s.artist_id, s.observed_on desc
  ),
  -- Popularity: a play-weighted median of artist listeners per bucket.
  -- Aggregating to (bucket, artist) first is ~10x faster than ordering every
  -- play, and gives the same median.
  bucket_artist as (
    select 'all_time'::text as bucket, artist_id, count(*)::bigint as plays
    from plays group by artist_id
    union all
    select 'last_30_days', artist_id, count(*)
    from plays where local_date >= melbourne_today - 29 group by artist_id
    union all
    select extract(year from local_date)::int::text, artist_id, count(*)
    from plays group by 1, artist_id
  ),
  bucket_totals as (
    select bucket, sum(plays)::int as plays
    from bucket_artist
    group by bucket
  ),
  covered as (
    select
      ba.bucket,
      al.listeners,
      sum(ba.plays) over (
        partition by ba.bucket order by al.listeners, ba.artist_id
        rows unbounded preceding
      ) as running_plays,
      sum(ba.plays) over (partition by ba.bucket) as covered_plays
    from bucket_artist ba
    join artist_listeners al using (artist_id)
  ),
  medians as (
    select distinct on (bucket) bucket, listeners as median_artist_listeners, covered_plays::int
    from covered
    where running_plays * 2 >= covered_plays
    order by bucket, running_plays
  ),
  popularity as (
    select
      t.bucket,
      jsonb_build_object(
        'median_artist_listeners', m.median_artist_listeners,
        'plays', t.plays,
        'covered_plays', coalesce(m.covered_plays, 0)
      ) as summary
    from bucket_totals t
    left join medians m using (bucket)
  ),
  -- Attention-adjusted popularity: each (month, artist) gets today's
  -- listeners times the artist's Wikipedia multiplier for that month. Plays
  -- before July 2015 (the start of the page-view data) use July 2015, and
  -- plays after the last fetched month use that month. Without a multiplier
  -- the play keeps today's count, so covered_plays matches the today score.
  artist_attention as (
    select l.artist_id, w.views_from, w.multipliers_through, w.multipliers
    from artist_wikipedia_links l
    join wikipedia_articles w on w.id = l.article_id
    where w.multipliers is not null
  ),
  month_artist as (
    select date_trunc('month', local_date)::date as month, artist_id, count(*)::bigint as plays
    from plays
    group by 1, 2
  ),
  adjusted_month_artist as (
    select
      ma.month,
      ma.plays,
      al.listeners * coalesce(x.multiplier, 1) as listeners,
      x.multiplier is not null as adjusted
    from month_artist ma
    join artist_listeners al using (artist_id)
    left join artist_attention aa using (artist_id)
    cross join lateral (
      select greatest(date '2015-07-01', least(ma.month, aa.multipliers_through)) as month
    ) clamped
    cross join lateral (
      -- An index below 1 (a month before the article existed) reads null.
      select aa.multipliers[
        (extract(year from age(clamped.month, aa.views_from)) * 12
          + extract(month from age(clamped.month, aa.views_from)))::int + 1
      ] as multiplier
    ) x
  ),
  adjusted_bucket as (
    select 'all_time'::text as bucket, listeners, plays, adjusted from adjusted_month_artist
    union all
    select extract(year from month)::int::text, listeners, plays, adjusted from adjusted_month_artist
  ),
  adjusted_ranked as (
    select
      bucket,
      listeners,
      sum(plays) over (partition by bucket order by listeners rows unbounded preceding) as running_plays,
      sum(plays) over (partition by bucket) as covered_plays,
      coalesce(sum(plays) filter (where adjusted) over (partition by bucket), 0) as adjusted_plays
    from adjusted_bucket
  ),
  adjusted_medians as (
    select distinct on (bucket) bucket, listeners, covered_plays, adjusted_plays
    from adjusted_ranked
    where running_plays * 2 >= covered_plays
    order by bucket, running_plays
  ),
  adjusted_popularity as (
    select
      t.bucket,
      jsonb_build_object(
        'median_artist_listeners', round(m.listeners)::bigint,
        'plays', t.plays,
        'covered_plays', coalesce(m.covered_plays, 0)::int,
        'adjusted_plays', coalesce(m.adjusted_plays, 0)::int
      ) as summary
    from bucket_totals t
    left join adjusted_medians m using (bucket)
    where t.bucket <> 'last_30_days'
  ),
  -- Deep cuts use name-matched track stats only: MBID matches often land on a
  -- near-empty duplicate Last.fm entry (featured tracks especially).
  track_listeners as (
    select distinct on (s.track_id) s.track_id, s.listeners
    from external_music_stats s
    join external_music_metadata m
      on m.track_id = s.track_id
     and m.source = 'lastfm'
     and m.match_method = 'name'
    where s.source = 'lastfm'
      and s.track_id is not null
      and s.listeners is not null
    order by s.track_id, s.observed_on desc
  ),
  -- The artist comes from the plays, not track_artists: some tracks carry two
  -- order-0 artist rows (duplicate artist records), which would list them twice.
  track_plays as (
    select p.track_id, min(p.artist_id) as artist_id, count(*)::int as plays
    from plays p
    group by p.track_id
  ),
  -- One song is often several Spotify tracks (single, album, remaster), so
  -- merge by artist and lower-cased name.
  deep_cuts as (
    select
      tp.artist_id,
      (array_agg(t.name order by tp.plays desc, t.id))[1] as track_name,
      (array_agg(t.spotify_track_id order by tp.plays desc, t.id))[1] as spotify_track_id,
      sum(tp.plays)::int as plays,
      max(tl.listeners) as track_listeners
    from track_plays tp
    join track_listeners tl using (track_id)
    join tracks t on t.id = tp.track_id
    group by tp.artist_id, lower(t.name)
    -- Filter after merging, so a song counts all its versions' plays and any
    -- version at 20k+ listeners keeps it off the list.
    having sum(tp.plays) >= 3
       and max(tl.listeners) < 20000
    order by sum(tp.plays) desc, max(tl.listeners), tp.artist_id, lower(t.name)
    limit 10
  ),
  -- Hour tags: which labels this person plays more than their own average in
  -- each part of the day. Each play counts at most once per label.
  parts(part, ord, first_hour, last_hour) as (
    values
      ('late_night', 1, 0, 4),
      ('morning', 2, 5, 8),
      ('day', 3, 9, 16),
      ('evening', 4, 17, 20),
      ('night', 5, 21, 23)
  ),
  part_artist as (
    select pt.part, p.artist_id, count(*)::numeric as plays
    from plays p
    join parts pt on p.hour between pt.first_hour and pt.last_hour
    group by pt.part, p.artist_id
  ),
  part_totals as (
    select part, sum(plays) as plays from part_artist group by part
  ),
  grand_total as (
    select sum(plays) as plays from part_totals
  ),
  artist_labels as (
    select distinct t.artist_id, r.label
    from external_music_tags t
    join clock_tag_rules r
      on r.normalized_tag = t.normalized_tag
     and r.decision = 'include'
    where t.source = 'lastfm'
      and t.artist_id is not null
      and t.rank <= 10
      and t.artist_id in (select artist_id from part_artist)
  ),
  label_part as (
    select
      pa.part,
      al.label,
      sum(pa.plays) as n,
      count(*) as artists,
      max(pa.plays) as top_artist_plays
    from part_artist pa
    join artist_labels al using (artist_id)
    group by pa.part, al.label
  ),
  label_totals as (
    select label, sum(n) as n from label_part group by label
  ),
  -- Adjusted lift pulls small counts toward 1. The artist rules matter most:
  -- without them a single artist becomes a whole label ("smooth jazz 9.15x").
  scored as (
    select
      lp.part,
      lp.label,
      lp.n,
      (lp.n + 20) / (pt.plays * lt.n / gt.plays + 20) as lift
    from label_part lp
    join part_totals pt using (part)
    join label_totals lt using (label)
    cross join grand_total gt
    where pt.plays >= 150
      and lp.n >= 15
      and lp.artists >= 3
      and lp.top_artist_plays * 2 <= lp.n
  ),
  ranked as (
    select s.*, row_number() over (partition by part order by lift desc, n desc, label) as rn
    from scored s
    where lift >= 1.15
  )
  select jsonb_build_object(
    'generated_at', now(),
    'timezone', 'Australia/Melbourne',
    'source', 'lastfm',
    -- The newest Last.fm day behind this person's numbers, not the newest
    -- observation in the whole table.
    'stats_observed_through', (
      select max(al.observed_on)
      from artist_listeners al
      where al.artist_id in (select artist_id from bucket_artist)
    ),
    'popularity', jsonb_build_object(
      'all_time', (select summary from popularity where bucket = 'all_time'),
      'last_30_days', (select summary from popularity where bucket = 'last_30_days'),
      'by_year', coalesce((
        select jsonb_agg(
          jsonb_build_object('year', bucket::int) || summary
          order by bucket::int
        )
        from popularity
        where bucket ~ '^[0-9]{4}$'
      ), '[]'::jsonb),
      'deep_cuts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'spotify_track_id', dc.spotify_track_id,
          'track_name', dc.track_name,
          'artist_id', dc.artist_id,
          'artist_name', a.name,
          'plays', dc.plays,
          'track_listeners', dc.track_listeners
        ) order by dc.plays desc, dc.track_listeners, dc.artist_id, dc.track_name)
        from deep_cuts dc
        left join artists a on a.id = dc.artist_id
      ), '[]'::jsonb),
      'adjusted', jsonb_build_object(
        'all_time', (select summary from adjusted_popularity where bucket = 'all_time'),
        'by_year', coalesce((
          select jsonb_agg(
            jsonb_build_object('year', bucket::int) || summary
            order by bucket::int
          )
          from adjusted_popularity
          where bucket ~ '^[0-9]{4}$'
        ), '[]'::jsonb)
      )
    ),
    -- The last month of Wikipedia page views behind the adjusted score.
    'wikipedia_views_through', (select max(multipliers_through) from artist_attention),
    'hour_tags', (
      select jsonb_agg(jsonb_build_object(
        'part', pt.part,
        'first_hour', pt.first_hour,
        'last_hour', pt.last_hour,
        'plays', coalesce(tot.plays, 0)::int,
        'labels', coalesce((
          select jsonb_agg(jsonb_build_object(
            'label', r.label,
            'plays', r.n::int,
            'lift', round(r.lift, 2)
          ) order by r.rn)
          from ranked r
          where r.part = pt.part and r.rn <= 3
        ), '[]'::jsonb)
      ) order by pt.ord)
      from parts pt
      left join part_totals tot using (part)
    )
  )
  into result;

  return result;
end;
$$;

-- 5. Schedule the fetcher every 15 minutes, away from the sync and external
--    enrichment slots. Each run stops after about 100 seconds, so runs never
--    overlap. Most runs find nothing to do: new played artists to link, and
--    one month of views per article after each month ends (about 10 hours of
--    runs). Reuses the Vault secrets of the other jobs.
create or replace function public.trigger_wikipedia_attention()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'sync_secret_key';

  if v_url is null or v_key is null then
    raise exception 'Missing Vault secrets project_url / sync_secret_key for trigger_wikipedia_attention()';
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/refresh-wikipedia-attention',
    headers := jsonb_build_object(
      'apikey', v_key,
      'Content-Type', 'application/json'
    ),
    body := '{"budget_seconds":100}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;

revoke all on function public.trigger_wikipedia_attention()
from public, anon, authenticated;

select cron.schedule(
  'refresh-wikipedia-attention',
  '9,24,39,54 * * * *',
  $$ select public.trigger_wikipedia_attention(); $$
);

notify pgrst, 'reload schema';
