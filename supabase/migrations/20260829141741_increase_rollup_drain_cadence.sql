-- The first complete production interval at the five-minute cadence exposed a
-- slightly heavier artist batch than the tuning baseline: external enrichment
-- queued 326 unique user/date rollups in ten minutes while two drains could
-- remove only 300. The drain transactions themselves completed in 7.28-10.72
-- seconds, so running the same proven 150-date batch every three minutes keeps
-- ample separation while raising capacity from 1,800 to 3,000 dates/hour.

select cron.unschedule('drain-rollup-refresh-queue');

select cron.schedule(
  'drain-rollup-refresh-queue',
  '*/3 * * * *',
  $$ select public.drain_rollup_refresh_queue(150); $$
);
