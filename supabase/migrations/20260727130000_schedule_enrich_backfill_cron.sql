-- Schedule metadata enrichment in the database, replacing the GitHub Actions
-- workflow. Same reasoning as 20260619142000_schedule_sync_due_users_cron.sql:
-- GitHub's scheduler drops and delays runs. Measured over the enrichment
-- workflow's first 43 hours: 11 fires against 14 requested, drift up to 2h31m.
--
-- Reuses the Vault secrets created for the sync cron (`project_url` and
-- `sync_secret_key`), so no new secrets are needed. If those are missing this
-- raises, exactly as trigger_sync_due_users() does.

create or replace function public.trigger_enrich_backfill()
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
    raise exception 'Missing Vault secrets project_url / sync_secret_key for trigger_enrich_backfill()';
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/enrich-backfill',
    headers := jsonb_build_object(
      'apikey', v_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_enrich_backfill() from public, anon, authenticated;

-- Every 15 minutes: 96 attempts a day at the function's default 30-track batch
-- is ~2,880/day, well above anything GitHub Actions delivered. The function
-- records each attempt in enrichment_runs, so if this outruns Spotify's cap the
-- aborts and their retry-after values are visible on /admin rather than lost.
select cron.schedule(
  'enrich-backfill',
  '0,15,30,45 * * * *',
  $$ select public.trigger_enrich_backfill(); $$
);

-- Drain the rollup queue on its own cadence. This one needs no HTTP hop: the
-- work is entirely in-database. Offset from the enrichment schedule so a drain
-- is not competing with the batch that just queued its dates.
select cron.schedule(
  'drain-rollup-refresh-queue',
  '5,20,35,50 * * * *',
  $$ select public.drain_rollup_refresh_queue(50); $$
);

notify pgrst, 'reload schema';
