-- Drop the legacy public.refresh_public_stats no-op functions.
--
-- The anonymous public_home feed was archived (see
-- 20260619130036_archive_legacy_public_rows); connected profiles use
-- refresh_user_public_stats(user_id, target_dates) instead, and nothing in
-- the app, edge functions, or cron calls refresh_public_stats anymore.
--
-- This replaces the never-pushed local migrations
-- 20260622045626_fix_legacy_refresh_public_stats_signature and
-- 20260622045724_drop_legacy_refresh_public_stats, consolidated into a single
-- migration dated after the production-applied admin migrations so it applies
-- in version order.
drop function if exists public.refresh_public_stats();
drop function if exists public.refresh_public_stats(date[]);
