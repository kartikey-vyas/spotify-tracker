-- Temporarily move MusicBrainz + Last.fm queue draining off hosted Edge
-- invocations and onto the resumable laptop runner. Spotify sync, Spotify
-- metadata enrichment, queue triggers, and rollup draining remain scheduled.
--
-- Resume hosted processing with a new migration that calls cron.schedule for
-- `enrich-external-metadata`; do not edit cron.job directly.
select cron.unschedule('enrich-external-metadata');
