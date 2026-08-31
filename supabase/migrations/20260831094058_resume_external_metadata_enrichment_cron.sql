-- Resume MusicBrainz + Last.fm enrichment as a continuously scheduled Edge
-- Function after the supervised laptop drain. Keep work that can still make
-- progress ahead of tracks whose Last.fm endpoints are complete but whose
-- MusicBrainz endpoint is waiting on a provider recovery.

create index if not exists external_music_enrichment_queue_actionable_idx
  on public.external_music_enrichment_queue (
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
    ready.id order by ready.provider_blocked_rank, ready.priority_plays desc, ready.id
  )
  into v_queue_ids
  from (
    select
      q.id,
      q.priority_plays,
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
    order by provider_blocked_rank, q.priority_plays desc, q.id
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
  order by q.priority_plays desc, q.id;
end;
$$;

-- These rows exhausted their old finite budget solely because MusicBrainz was
-- returning 503s during the laptop drain. Preserve their completed Last.fm
-- endpoints and make the MusicBrainz step resumable again.
update public.external_music_enrichment_queue
set status = 'retry',
    attempt_count = 0,
    next_attempt_at = now(),
    lease_token = null,
    lease_expires_at = null,
    completed_at = null,
    last_error = null,
    updated_at = now()
where status = 'dead'
  and last_error like 'musicbrainz:%'
  and coalesce(last_result #>> '{endpoints,musicbrainz,status}', '')
    not in ('ok', 'not_found', 'no_match');

-- Reuse the existing Vault-backed trigger, but increase the bounded batch now
-- that production observations showed 20-item runs remain well within the
-- Edge wall-clock budget. The singleton queue lease prevents overlap.
create or replace function public.trigger_external_music_enrichment()
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
    raise exception 'Missing Vault secrets project_url / sync_secret_key for trigger_external_music_enrichment()';
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/enrich-external-metadata',
    headers := jsonb_build_object(
      'apikey', v_key,
      'Content-Type', 'application/json'
    ),
    body := '{"batch_size":20,"lease_seconds":600}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_external_music_enrichment()
from public, anon, authenticated;

-- Twelve invocations/hour is 8,640 in a 30-day month. Successful full batches
-- can clear up to 240 entities/hour while the database lease keeps provider
-- traffic serialized and safely turns overlapping calls into no-ops.
select cron.schedule(
  'enrich-external-metadata',
  '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
  $$ select public.trigger_external_music_enrichment(); $$
);

notify pgrst, 'reload schema';
