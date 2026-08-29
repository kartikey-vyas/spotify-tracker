-- A provider-wide circuit protects the upstream service by deferring the
-- remaining requests in an already-claimed batch. Claiming increments every
-- row's attempt_count, though, so those deferred rows previously spent retry
-- budget without making the failed request and could eventually become dead
-- during a long provider outage.
--
-- Keep the new argument optional while the database migration and Edge
-- Function roll out. Supabase/PostgREST does not support overloaded RPCs, so
-- replace the six-argument signature instead of leaving both versions behind.

drop function public.finish_external_music_enrichment_item(
  bigint,
  uuid,
  boolean,
  text,
  integer,
  jsonb
);

create function public.finish_external_music_enrichment_item(
  p_queue_id bigint,
  p_worker_token uuid,
  p_succeeded boolean,
  p_error text default null,
  p_retry_after_seconds integer default null,
  p_result jsonb default null,
  p_consume_attempt boolean default true
)
returns text
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_claim_attempt_count integer;
  v_effective_attempt_count integer;
  v_status text;
  v_backoff_seconds integer;
begin
  select q.attempt_count into v_claim_attempt_count
  from public.external_music_enrichment_queue q
  where q.id = p_queue_id
    and q.status = 'processing'
    and q.lease_token = p_worker_token
  for update;

  if not found then
    return 'ignored';
  end if;

  v_effective_attempt_count := greatest(
    0,
    v_claim_attempt_count - case
      when not p_succeeded and not coalesce(p_consume_attempt, true) then 1
      else 0
    end
  );

  if p_succeeded then
    v_status := 'succeeded';
  elsif v_effective_attempt_count >= 8 then
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
        (60 * power(2, least(greatest(v_effective_attempt_count - 1, 0), 10)))::integer
      )
    )
  );

  update public.external_music_enrichment_queue
  set status = v_status,
      attempt_count = v_effective_attempt_count,
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

revoke all on function public.finish_external_music_enrichment_item(
  bigint,
  uuid,
  boolean,
  text,
  integer,
  jsonb,
  boolean
) from public, anon, authenticated;

grant execute on function public.finish_external_music_enrichment_item(
  bigint,
  uuid,
  boolean,
  text,
  integer,
  jsonb,
  boolean
) to service_role;

notify pgrst, 'reload schema';
