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

-- Seed the production owner as an admin, but only if that auth user exists.
-- Migrations run before seed.sql, so on a fresh `supabase db reset` (empty
-- auth.users) an unconditional insert would violate the FK to auth.users and
-- abort the reset. The guard makes this replayable in any fresh environment;
-- on production (where the owner exists) it still seeds, and locally the admin
-- marker for admin@local.test is handled by seed.sql.
insert into public.admin_users (user_id)
select '6873a96d-3c4a-49a2-b487-1e7a78226280'::uuid
where exists (
  select 1 from auth.users where id = '6873a96d-3c4a-49a2-b487-1e7a78226280'
)
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
