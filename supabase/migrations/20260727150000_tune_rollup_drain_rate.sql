-- Raise the rollup drain batch so it outpaces the rate enrichment queues dates.
--
-- Measured on 2026-07-27: a 12-track batch queued 28 dates (~2.3 per track), so
-- the 30-track cron queues ~70 per run, ~280/hour. The drain was clearing 50
-- per run, ~200/hour — a standing deficit. The (user_id, local_date) primary key
-- bounds the backlog at the user's distinct-date count rather than letting it
-- grow without limit, but the steady state was a permanently non-empty queue
-- and rollups that were always somewhat stale.
--
-- 150 is safe on time: 30 dates drained in 2.2s against production, so 150 is
-- ~11s, well inside both the statement timeout and the 15-minute gap. Bigger
-- batches are also cheaper per date — refresh_user_public_stats rebuilds
-- activity_recent and the overview cache in full on every call regardless of
-- how many dates it was given, so a larger batch amortizes that fixed cost.

select cron.unschedule('drain-rollup-refresh-queue');

select cron.schedule(
  'drain-rollup-refresh-queue',
  '5,20,35,50 * * * *',
  $$ select public.drain_rollup_refresh_queue(150); $$
);
