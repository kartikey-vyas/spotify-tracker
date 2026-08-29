-- Scheduled sync and the rollup drain can refresh the same user concurrently.
-- Both rebuild public_activity_recent with delete-then-insert, so an overlap can
-- make one transaction insert an event ID that the other just inserted. Hold a
-- transaction-scoped advisory lock for the complete per-user refresh pipeline.

create or replace function public.refresh_user_public_stats(
  p_user_id uuid,
  target_dates date[] default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refresh_user_public_stats:' || p_user_id::text, 0)
  );

  perform public.refresh_user_rollups(p_user_id, target_dates);
  perform public.refresh_user_activity_recent(p_user_id, 100);
  perform public.refresh_user_overview_cache(p_user_id);
end;
$$;

revoke all on function public.refresh_user_public_stats(uuid, date[])
from public, anon, authenticated;
grant execute on function public.refresh_user_public_stats(uuid, date[])
to service_role;

notify pgrst, 'reload schema';
