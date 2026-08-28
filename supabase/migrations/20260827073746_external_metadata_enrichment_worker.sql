-- Turn the MusicBrainz + Last.fm spike into a bounded, resumable production
-- worker. Queue rows are service-only; the browser continues to read only the
-- curated artist_genres projection.

create table public.external_music_enrichment_queue (
  id bigint generated always as identity primary key,
  track_id bigint references public.tracks(id) on delete cascade,
  artist_id bigint references public.artists(id) on delete cascade,
  album_id bigint references public.albums(id) on delete cascade,
  entity_type text generated always as (
    case
      when track_id is not null then 'track'
      when artist_id is not null then 'artist'
      when album_id is not null then 'album'
    end
  ) stored,
  entity_id bigint generated always as (coalesce(track_id, artist_id, album_id)) stored,
  priority_plays bigint not null default 0,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  last_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_music_enrichment_queue_one_entity_check
    check (num_nonnulls(track_id, artist_id, album_id) = 1),
  constraint external_music_enrichment_queue_entity_uidx
    unique (entity_type, entity_id),
  constraint external_music_enrichment_queue_priority_check
    check (priority_plays >= 0),
  constraint external_music_enrichment_queue_attempt_check
    check (attempt_count >= 0),
  constraint external_music_enrichment_queue_status_check
    check (status in ('pending', 'processing', 'retry', 'succeeded', 'dead')),
  constraint external_music_enrichment_queue_lease_check
    check (
      (status = 'processing' and lease_token is not null and lease_expires_at is not null)
      or
      (status <> 'processing' and lease_token is null and lease_expires_at is null)
    )
);

-- Pending/retry rows are the hot subset while the one-time backfill drains.
-- Priority is first because every claim asks for the most-listened work due.
create index external_music_enrichment_queue_ready_idx
  on public.external_music_enrichment_queue (priority_plays desc, id)
  where status in ('pending', 'retry');

create index external_music_enrichment_queue_stale_lease_idx
  on public.external_music_enrichment_queue (lease_expires_at)
  where status = 'processing';

create index external_music_enrichment_queue_track_idx
  on public.external_music_enrichment_queue (track_id)
  where track_id is not null;
create index external_music_enrichment_queue_artist_idx
  on public.external_music_enrichment_queue (artist_id)
  where artist_id is not null;
create index external_music_enrichment_queue_album_idx
  on public.external_music_enrichment_queue (album_id)
  where album_id is not null;

-- A singleton lease prevents overlapping cron/manual invocations from jointly
-- exceeding MusicBrainz's one-request-per-second application limit.
create table public.external_music_enrichment_worker (
  singleton boolean primary key default true check (singleton),
  lease_token uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint external_music_enrichment_worker_lease_check
    check (num_nonnulls(lease_token, lease_expires_at) in (0, 2))
);

insert into public.external_music_enrichment_worker (singleton) values (true);

create table public.external_music_enrichment_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  requested_limit integer not null,
  claimed integer not null default 0,
  succeeded integer not null default 0,
  retried integer not null default 0,
  dead integer not null default 0,
  warnings integer not null default 0,
  error text,
  constraint external_music_enrichment_runs_counts_check
    check (
      requested_limit > 0
      and claimed >= 0
      and succeeded >= 0
      and retried >= 0
      and dead >= 0
      and warnings >= 0
    )
);

create index external_music_enrichment_runs_started_at_idx
  on public.external_music_enrichment_runs (started_at desc);

-- Seed track priority from the existing public rollups. The 25 entities
-- imported during the spike start completed; everything else starts pending.
with track_plays as (
  select entity_id::bigint as track_id, sum(plays)::bigint as plays
  from public.rollup_daily_entity_stats
  where entity_type = 'track' and archived_at is null
  group by entity_id
)
insert into public.external_music_enrichment_queue (
  track_id,
  priority_plays,
  status,
  next_attempt_at,
  completed_at,
  last_result
)
select
  t.id,
  coalesce(p.plays, 0),
  case when m.id is null then 'pending' else 'succeeded' end,
  case when m.id is null then now() else null end,
  case when m.id is null then null else now() end,
  case when m.id is null then '{}'::jsonb else '{"seeded_from_existing":true}'::jsonb end
from public.tracks t
left join track_plays p on p.track_id = t.id
left join public.external_music_metadata m
  on m.source = 'lastfm' and m.track_id = t.id
where nullif(btrim(t.isrc), '') is not null
on conflict (entity_type, entity_id) do nothing;

with track_plays as (
  select entity_id::bigint as track_id, sum(plays)::bigint as plays
  from public.rollup_daily_entity_stats
  where entity_type = 'track' and archived_at is null
  group by entity_id
), artist_plays as (
  select ta.artist_id, sum(coalesce(p.plays, 0))::bigint as plays
  from public.track_artists ta
  join public.tracks t on t.id = ta.track_id
  left join track_plays p on p.track_id = t.id
  where nullif(btrim(t.isrc), '') is not null
  group by ta.artist_id
)
insert into public.external_music_enrichment_queue (
  artist_id,
  priority_plays,
  status,
  next_attempt_at,
  completed_at,
  last_result
)
select
  a.id,
  coalesce(p.plays, 0),
  case when m.id is null then 'pending' else 'succeeded' end,
  case when m.id is null then now() else null end,
  case when m.id is null then null else now() end,
  case when m.id is null then '{}'::jsonb else '{"seeded_from_existing":true}'::jsonb end
from public.artists a
join artist_plays p on p.artist_id = a.id
left join public.external_music_metadata m
  on m.source = 'lastfm' and m.artist_id = a.id
on conflict (entity_type, entity_id) do nothing;

with track_plays as (
  select entity_id::bigint as track_id, sum(plays)::bigint as plays
  from public.rollup_daily_entity_stats
  where entity_type = 'track' and archived_at is null
  group by entity_id
), album_plays as (
  select t.album_id, sum(coalesce(p.plays, 0))::bigint as plays
  from public.tracks t
  left join track_plays p on p.track_id = t.id
  where t.album_id is not null and nullif(btrim(t.isrc), '') is not null
  group by t.album_id
)
insert into public.external_music_enrichment_queue (
  album_id,
  priority_plays,
  status,
  next_attempt_at,
  completed_at,
  last_result
)
select
  a.id,
  coalesce(p.plays, 0),
  case when m.id is null then 'pending' else 'succeeded' end,
  case when m.id is null then now() else null end,
  case when m.id is null then null else now() end,
  case when m.id is null then '{}'::jsonb else '{"seeded_from_existing":true}'::jsonb end
from public.albums a
join album_plays p on p.album_id = a.id
left join public.external_music_metadata m
  on m.source = 'lastfm' and m.album_id = a.id
on conflict (entity_type, entity_id) do nothing;

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

create trigger tracks_enqueue_external_music_insert
after insert on public.tracks
for each row execute function public.enqueue_external_music_track();

create trigger tracks_enqueue_external_music_update
after update of isrc, album_id on public.tracks
for each row execute function public.enqueue_external_music_track();

create or replace function public.enqueue_external_music_artist()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_isrc text;
begin
  select isrc into v_isrc from public.tracks where id = new.track_id;
  if nullif(btrim(v_isrc), '') is not null then
    insert into public.external_music_enrichment_queue (artist_id, next_attempt_at)
    values (new.artist_id, now())
    on conflict (entity_type, entity_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger track_artists_enqueue_external_music_insert
after insert on public.track_artists
for each row execute function public.enqueue_external_music_artist();

create trigger track_artists_enqueue_external_music_update
after update of track_id, artist_id on public.track_artists
for each row execute function public.enqueue_external_music_artist();

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

  select array_agg(ready.id order by ready.priority_plays desc, ready.id)
  into v_queue_ids
  from (
    select q.id, q.priority_plays
    from public.external_music_enrichment_queue q
    where q.status in ('pending', 'retry')
      and q.attempt_count < 8
      and coalesce(q.next_attempt_at, v_now) <= v_now
    order by q.priority_plays desc, q.id
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

create or replace function public.finish_external_music_enrichment_item(
  p_queue_id bigint,
  p_worker_token uuid,
  p_succeeded boolean,
  p_error text default null,
  p_retry_after_seconds integer default null,
  p_result jsonb default null
)
returns text
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_attempt_count integer;
  v_status text;
  v_backoff_seconds integer;
begin
  select q.attempt_count into v_attempt_count
  from public.external_music_enrichment_queue q
  where q.id = p_queue_id
    and q.status = 'processing'
    and q.lease_token = p_worker_token
  for update;

  if not found then
    return 'ignored';
  end if;

  if p_succeeded then
    v_status := 'succeeded';
  elsif v_attempt_count >= 8 then
    v_status := 'dead';
  else
    v_status := 'retry';
  end if;

  v_backoff_seconds := greatest(
    60,
    least(
      86400,
      coalesce(
        nullif(p_retry_after_seconds, 0),
        (60 * power(2, least(greatest(v_attempt_count - 1, 0), 10)))::integer
      )
    )
  );

  update public.external_music_enrichment_queue
  set status = v_status,
      next_attempt_at = case when v_status = 'retry'
        then now() + make_interval(secs => v_backoff_seconds)
        else null
      end,
      lease_token = null,
      lease_expires_at = null,
      completed_at = case when v_status in ('succeeded', 'dead') then now() else completed_at end,
      last_error = case when v_status = 'succeeded' then null else left(coalesce(p_error, 'Unknown provider failure'), 2000) end,
      last_result = coalesce(p_result, last_result),
      updated_at = now()
  where id = p_queue_id;

  return v_status;
end;
$$;

create or replace function public.release_external_music_enrichment_worker(p_worker_token uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  update public.external_music_enrichment_worker
  set lease_token = null, lease_expires_at = null, updated_at = now()
  where singleton and lease_token = p_worker_token;
  return found;
end;
$$;

create or replace function public.external_music_enrichment_progress()
returns table (status text, item_count bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select q.status, count(*)::bigint
  from public.external_music_enrichment_queue q
  group by q.status
  order by q.status;
$$;

alter table public.external_music_enrichment_queue enable row level security;
alter table public.external_music_enrichment_worker enable row level security;
alter table public.external_music_enrichment_runs enable row level security;

revoke all on table
  public.external_music_enrichment_queue,
  public.external_music_enrichment_worker,
  public.external_music_enrichment_runs
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.external_music_enrichment_queue,
  public.external_music_enrichment_worker,
  public.external_music_enrichment_runs
to service_role;

grant usage, select on sequence
  public.external_music_enrichment_queue_id_seq,
  public.external_music_enrichment_runs_id_seq
to service_role;

revoke all on function public.claim_external_music_enrichment_batch(integer, integer)
from public, anon, authenticated;
revoke all on function public.finish_external_music_enrichment_item(bigint, uuid, boolean, text, integer, jsonb)
from public, anon, authenticated;
revoke all on function public.release_external_music_enrichment_worker(uuid)
from public, anon, authenticated;
revoke all on function public.external_music_enrichment_progress()
from public, anon, authenticated;
revoke all on function public.enqueue_external_music_track()
from public, anon, authenticated;
revoke all on function public.enqueue_external_music_artist()
from public, anon, authenticated;

grant execute on function public.claim_external_music_enrichment_batch(integer, integer)
to service_role;
grant execute on function public.finish_external_music_enrichment_item(bigint, uuid, boolean, text, integer, jsonb)
to service_role;
grant execute on function public.release_external_music_enrichment_worker(uuid)
to service_role;
grant execute on function public.external_music_enrichment_progress()
to service_role;

-- Reuse the Vault secrets that already authenticate sync-due-users and
-- enrich-backfill. LASTFM_API_KEY is an Edge Function secret, not a DB secret.
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
    body := '{"batch_size":10,"lease_seconds":240}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_external_music_enrichment()
from public, anon, authenticated;

-- Ten mixed track/artist/album items every ten minutes spreads provider load
-- throughout the day. It also leaves clear offsets from the existing Spotify
-- enrichment and rollup-drain jobs.
select cron.schedule(
  'enrich-external-metadata',
  '3,13,23,33,43,53 * * * *',
  $$ select public.trigger_external_music_enrichment(); $$
);

notify pgrst, 'reload schema';
