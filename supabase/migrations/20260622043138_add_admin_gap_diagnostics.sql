-- One-time setup after deploy:
-- insert into public.admin_users (user_id) values ('<owner-auth-user-uuid>');
-- Run with service_role access from the Supabase SQL editor or a trusted admin script.

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

drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users au
      where au.user_id = (select auth.uid())
    )
  );

drop policy if exists "Admins read all sync state" on public.sync_state;
create policy "Admins read all sync state"
  on public.sync_state for select
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users au
      where au.user_id = (select auth.uid())
    )
  );
