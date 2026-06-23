-- Imported verbatim from the production migration ledger (applied via the
-- Supabase dashboard). Captured into the repo to reconcile divergent history.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

revoke all on table public.admin_users from anon, authenticated;
grant select on table public.admin_users to authenticated;
grant select, insert, update, delete on table public.admin_users to service_role;

drop policy if exists "Admins read own marker" on public.admin_users;
create policy "Admins read own marker"
  on public.admin_users for select
  to authenticated
  using (user_id = (select auth.uid()));

insert into public.admin_users (user_id)
values ('6873a96d-3c4a-49a2-b487-1e7a78226280')
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
