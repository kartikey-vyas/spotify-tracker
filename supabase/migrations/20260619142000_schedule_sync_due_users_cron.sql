-- Schedule the recently-played sync inside the database instead of GitHub Actions.
--
-- GitHub Actions scheduled workflows are unreliable (delayed/dropped under load,
-- slow to register on new repos), so we drive the sync from pg_cron + pg_net,
-- which lives next to the edge function and fires dependably.
--
-- Secrets are read from Vault so no environment-specific values live in source
-- control. Before this cron can run, create the two secrets ONCE per project
-- (run in the SQL editor / via CLI, do NOT commit the values):
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<SUPABASE_SECRET_KEY>',      'sync_secret_key');
--
-- To rotate, update the secret value in Vault; the cron job picks it up on the
-- next run with no migration change.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Invokes the sync-due-users edge function. The function gates itself on the
-- `apikey` header (assertServiceRequest) and SYNC_STALE_MINUTES, so calling it
-- on a fixed cadence never over-polls Spotify per user.
create or replace function public.trigger_sync_due_users()
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
    raise exception 'Missing Vault secrets project_url / sync_secret_key for trigger_sync_due_users()';
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/sync-due-users',
    headers := jsonb_build_object(
      'apikey', v_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_sync_due_users() from public, anon, authenticated;

-- (Re)schedule on the hour and every 15 minutes after. cron.schedule upserts by
-- job name, so re-running this migration replaces the existing job rather than
-- duplicating it.
select cron.schedule(
  'sync-due-users',
  '0,15,30,45 * * * *',
  $$ select public.trigger_sync_due_users(); $$
);
