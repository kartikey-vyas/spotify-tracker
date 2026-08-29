-- Last.fm genre projection fans out across every historic listening date for
-- the affected artists. Production monitoring after the external worker fix
-- measured one ten-entity run adding 177 unique dates while the existing job
-- drained only 150 every fifteen minutes, so the backlog still grew.
--
-- Keep the proven 150-date batch size: a 300-date production API benchmark hit
-- the statement timeout. Increasing only the cadence makes the drain capable
-- of 1,800 dates/hour without lengthening any individual transaction.

select cron.unschedule('drain-rollup-refresh-queue');

select cron.schedule(
  'drain-rollup-refresh-queue',
  '*/5 * * * *',
  $$ select public.drain_rollup_refresh_queue(150); $$
);
