drop function if exists public.refresh_public_stats(date[]);

create or replace function public.refresh_public_stats()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- The anonymous public_home feed is archived; connected profiles use
  -- refresh_user_public_stats(user_id, target_dates) instead.
  return;
end;
$$;

revoke all on function public.refresh_public_stats() from anon, authenticated;
grant execute on function public.refresh_public_stats() to service_role;
