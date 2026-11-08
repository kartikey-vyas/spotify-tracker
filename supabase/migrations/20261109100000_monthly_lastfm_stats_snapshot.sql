-- Monthly Last.fm popularity snapshots.
--
-- external_music_stats keys rows by (source, entity_type, entity_id,
-- observed_on), but the first-pass enrichment fetched every entity once, so
-- there is no history. Once a month this requeues completed artists through
-- the existing external enrichment queue with only their `artist.info`
-- endpoint cleared. The worker skips endpoints that are already terminal, so
-- the only provider call is one Last.fm artist.getInfo per artist: no
-- MusicBrainz, tags, similarities or genre/rollup refresh. The persisted
-- getInfo response adds a new stats row for the day it was observed.
--
-- Snapshot rows claim after all first-pass rows, so new entities are never
-- starved by the monthly sweep. Leasing, retries, provider circuits and run
-- telemetry are the existing ones. The Edge Function needs no change.
--
-- Only artists are scheduled (the popularity score uses artist listeners).
-- The function accepts 'track' and 'album' too, so adding them later is a
-- cron.schedule in a new migration.

alter table public.external_music_enrichment_queue
  add column if not exists stats_snapshot_on date;

comment on column public.external_music_enrichment_queue.stats_snapshot_on is
  'First day (UTC) of the most recent monthly Last.fm stats snapshot requested for this row. Non-null rows claim after first-pass work.';

-- The claim order gains a leading snapshot rank; replace the index that
-- matched the previous order.
drop index if exists public.external_music_enrichment_queue_actionable_idx;

create index if not exists external_music_enrichment_queue_claim_order_idx
  on public.external_music_enrichment_queue (
    (case when stats_snapshot_on is not null then 1 else 0 end),
    (
      case
        when entity_type = 'track'
          and coalesce(last_result #>> '{endpoints,musicbrainz,status}', '')
            not in ('ok', 'not_found', 'no_match')
          and coalesce(last_result #>> '{endpoints,track.info,status}', '')
            in ('ok', 'not_found', 'no_match')
          and coalesce(last_result #>> '{endpoints,track.tags,status}', '')
            in ('ok', 'not_found', 'no_match')
          and coalesce(last_result #>> '{endpoints,track.similar,status}', '')
            in ('ok', 'not_found', 'no_match')
        then 1
        else 0
      end
    ),
    priority_plays desc,
    id
  )
  where status in ('pending', 'retry');

create or replace function public.claim_external_music_enrichment_batch(
  p_batch_size integer default 10,
  p_lease_seconds integer default 240
)
returns table (
  queue_id bigint,
  worker_token uuid,
  attempt_count integer,
  entity_type text,
  entity_id bigint,
  entity_name text,
  last_result jsonb,
  context_track_id bigint,
  context_track_name text,
  context_duration_ms integer,
  context_isrc text,
  context_album_id bigint,
  context_album_name text,
  context_artists jsonb
)
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 10), 20));
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 240), 600));
  v_worker_token uuid;
  v_active_token uuid;
  v_active_until timestamptz;
  v_queue_ids bigint[];
begin
  select w.lease_token, w.lease_expires_at
  into v_active_token, v_active_until
  from public.external_music_enrichment_worker w
  where w.singleton
  for update;

  if v_active_token is not null and v_active_until > v_now then
    return;
  end if;

  update public.external_music_enrichment_queue q
  set status = case when q.attempt_count >= 8 then 'dead' else 'retry' end,
      next_attempt_at = case when q.attempt_count >= 8 then null else v_now end,
      completed_at = case when q.attempt_count >= 8 then v_now else q.completed_at end,
      lease_token = null,
      lease_expires_at = null,
      last_error = 'Worker lease expired before completion',
      updated_at = v_now
  where q.status = 'processing' and q.lease_expires_at <= v_now;

  select array_agg(
    ready.id
    order by ready.snapshot_rank, ready.provider_blocked_rank, ready.priority_plays desc, ready.id
  )
  into v_queue_ids
  from (
    select
      q.id,
      q.priority_plays,
      case when q.stats_snapshot_on is not null then 1 else 0 end as snapshot_rank,
      case
        when q.entity_type = 'track'
          and coalesce(q.last_result #>> '{endpoints,musicbrainz,status}', '')
            not in ('ok', 'not_found', 'no_match')
          and coalesce(q.last_result #>> '{endpoints,track.info,status}', '')
            in ('ok', 'not_found', 'no_match')
          and coalesce(q.last_result #>> '{endpoints,track.tags,status}', '')
            in ('ok', 'not_found', 'no_match')
          and coalesce(q.last_result #>> '{endpoints,track.similar,status}', '')
            in ('ok', 'not_found', 'no_match')
        then 1
        else 0
      end as provider_blocked_rank
    from public.external_music_enrichment_queue q
    where q.status in ('pending', 'retry')
      and q.attempt_count < 8
      and coalesce(q.next_attempt_at, v_now) <= v_now
    order by snapshot_rank, provider_blocked_rank, q.priority_plays desc, q.id
    limit v_batch_size
    for update skip locked
  ) ready;

  if coalesce(cardinality(v_queue_ids), 0) = 0 then
    update public.external_music_enrichment_worker
    set lease_token = null, lease_expires_at = null, updated_at = v_now
    where singleton;
    return;
  end if;

  v_worker_token := gen_random_uuid();

  update public.external_music_enrichment_worker
  set lease_token = v_worker_token,
      lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
      updated_at = v_now
  where singleton;

  update public.external_music_enrichment_queue q
  set status = 'processing',
      attempt_count = q.attempt_count + 1,
      lease_token = v_worker_token,
      lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
      last_started_at = v_now,
      last_error = null,
      updated_at = v_now
  where q.id = any(v_queue_ids);

  return query
  select
    q.id,
    v_worker_token,
    q.attempt_count,
    q.entity_type,
    q.entity_id,
    case
      when q.track_id is not null then ct.name
      when q.artist_id is not null then ar.name
      else al.name
    end,
    q.last_result,
    ct.id,
    ct.name,
    ct.duration_ms,
    ct.isrc,
    ct.album_id,
    ca.name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', credit_artist.id,
          'name', credit_artist.name,
          'artist_order', ta.artist_order
        ) order by ta.artist_order, credit_artist.id
      )
      from public.track_artists ta
      join public.artists credit_artist on credit_artist.id = ta.artist_id
      where ta.track_id = ct.id
    ), '[]'::jsonb)
  from public.external_music_enrichment_queue q
  left join public.artists ar on ar.id = q.artist_id
  left join public.albums al on al.id = q.album_id
  left join lateral (
    select candidate.id, candidate.name, candidate.duration_ms, candidate.isrc, candidate.album_id
    from public.tracks candidate
    where nullif(btrim(candidate.isrc), '') is not null
      and (
        candidate.id = q.track_id
        or (q.artist_id is not null and exists (
          select 1 from public.track_artists candidate_artist
          where candidate_artist.track_id = candidate.id
            and candidate_artist.artist_id = q.artist_id
        ))
        or (q.album_id is not null and candidate.album_id = q.album_id)
      )
    order by case when candidate.id = q.track_id then 0 else 1 end, candidate.id
    limit 1
  ) ct on true
  left join public.albums ca on ca.id = ct.album_id
  where q.id = any(v_queue_ids)
  -- Process in claim order, so first-pass work in a mixed batch goes first.
  order by array_position(v_queue_ids, q.id);
end;
$$;

-- An ISRC change resets a track to a full first pass; it must claim with
-- first-pass priority again, so drop its snapshot marker.
create or replace function public.enqueue_external_music_track()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if nullif(btrim(new.isrc), '') is null then
    delete from public.external_music_enrichment_queue where track_id = new.id;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.isrc is distinct from new.isrc then
    insert into public.external_music_enrichment_queue (track_id, next_attempt_at)
    values (new.id, now())
    on conflict (entity_type, entity_id) do update
    set status = 'pending',
        attempt_count = 0,
        next_attempt_at = now(),
        lease_token = null,
        lease_expires_at = null,
        completed_at = null,
        last_error = null,
        last_result = '{}'::jsonb,
        stats_snapshot_on = null,
        updated_at = now();
  else
    insert into public.external_music_enrichment_queue (track_id, next_attempt_at)
    values (new.id, now())
    on conflict (entity_type, entity_id) do nothing;
  end if;

  if new.album_id is not null then
    insert into public.external_music_enrichment_queue (album_id, next_attempt_at)
    values (new.album_id, now())
    on conflict (entity_type, entity_id) do nothing;
  end if;

  return new;
end;
$$;

-- Requeue every eligible entity of one type for this month's stats reading.
-- Eligible: first pass finished (succeeded or dead) with every endpoint other
-- than the stats one terminal, so the worker can only repeat the getInfo call;
-- not already requested this month; and no stats row observed this month
-- (entities first enriched this month already have one). Safe to run twice.
-- v_kept_endpoints mirrors requiredEndpoints() minus statsEndpoint() in
-- supabase/functions/_shared/external-music-enrichment.ts; a unit test keeps
-- them in step.
create or replace function public.enqueue_external_music_stats_snapshot(
  p_entity_type text default 'artist'
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_period date := date_trunc('month', now() at time zone 'UTC')::date;
  v_kept_endpoints text[];
  v_count integer;
begin
  v_kept_endpoints := case p_entity_type
    when 'track' then array['musicbrainz', 'track.tags', 'track.similar']
    when 'artist' then array['artist.tags']
    when 'album' then array['album.tags']
  end;
  if v_kept_endpoints is null then
    raise exception 'Unknown external music entity type: %', p_entity_type;
  end if;

  update public.external_music_enrichment_queue q
  set status = 'pending',
      attempt_count = 0,
      next_attempt_at = now(),
      completed_at = null,
      last_error = null,
      last_result = q.last_result #- array['endpoints', p_entity_type || '.info'],
      stats_snapshot_on = v_period,
      updated_at = now()
  where q.entity_type = p_entity_type
    and q.status in ('succeeded', 'dead')
    and q.stats_snapshot_on is distinct from v_period
    and not exists (
      select 1
      from unnest(v_kept_endpoints) as kept(endpoint)
      where coalesce(q.last_result #>> array['endpoints', kept.endpoint, 'status'], '')
        not in ('ok', 'not_found', 'no_match')
    )
    and not exists (
      select 1
      from public.external_music_stats s
      where s.source = 'lastfm'
        and s.entity_type = q.entity_type
        and s.entity_id = q.entity_id
        and s.observed_on >= v_period
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Snapshot progress per requested month, for scripts/external-metadata-status.ts.
create or replace function public.external_music_stats_snapshot_progress()
returns table (entity_type text, snapshot_on date, status text, item_count bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select q.entity_type, q.stats_snapshot_on, q.status, count(*)::bigint
  from public.external_music_enrichment_queue q
  where q.stats_snapshot_on is not null
  group by q.entity_type, q.stats_snapshot_on, q.status
  order by q.stats_snapshot_on desc, q.entity_type, q.status;
$$;

revoke all on function public.enqueue_external_music_stats_snapshot(text)
from public, anon, authenticated;
revoke all on function public.external_music_stats_snapshot_progress()
from public, anon, authenticated;
grant execute on function public.enqueue_external_music_stats_snapshot(text)
to service_role;
grant execute on function public.external_music_stats_snapshot_progress()
to service_role;

-- 00:11 UTC on the 1st, clear of the sync (:00/:15), drain (every 3 min,
-- in-database) and external enrichment (:02/:07/:12) slots. The work itself
-- is drained by the existing enrich-external-metadata job: ~16.3k artists at
-- 20 per five-minute run takes about three days.
select cron.schedule(
  'snapshot-lastfm-artist-stats',
  '11 0 1 * *',
  $$ select public.enqueue_external_music_stats_snapshot('artist'); $$
);

-- Start the series now instead of waiting for the 1st of next month.
select public.enqueue_external_music_stats_snapshot('artist');

notify pgrst, 'reload schema';
