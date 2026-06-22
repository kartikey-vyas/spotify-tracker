-- Local-only Supabase seed data. This file is loaded by `supabase db reset`.
-- It is intentionally not used by hosted `supabase db push`.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'admin@local.test',
  null,
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"],"local_seed":true}'::jsonb,
  '{"display_name":"Local Admin"}'::jsonb,
  now(),
  now(),
  false,
  false
)
on conflict (id) do update
set email = excluded.email,
    email_confirmed_at = excluded.email_confirmed_at,
    confirmation_token = excluded.confirmation_token,
    recovery_token = excluded.recovery_token,
    email_change_token_new = excluded.email_change_token_new,
    email_change = excluded.email_change,
    email_change_token_current = excluded.email_change_token_current,
    phone_change = excluded.phone_change,
    phone_change_token = excluded.phone_change_token,
    reauthentication_token = excluded.reauthentication_token,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = excluded.updated_at;

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '{"sub":"00000000-0000-4000-8000-000000000001","email":"admin@local.test","email_verified":true,"phone_verified":false}'::jsonb,
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do update
set user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = excluded.updated_at;

insert into public.profiles (
  user_id,
  slug,
  display_name,
  is_public,
  onboarding_completed_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  'local-admin',
  'Local Admin',
  false,
  now(),
  now()
)
on conflict (user_id) do update
set slug = excluded.slug,
    display_name = excluded.display_name,
    is_public = excluded.is_public,
    onboarding_completed_at = excluded.onboarding_completed_at,
    updated_at = excluded.updated_at;

insert into public.sync_state (
  id,
  user_id,
  updated_at
)
values (
  1,
  '00000000-0000-4000-8000-000000000001',
  now()
)
on conflict (user_id) do update
set updated_at = excluded.updated_at;

insert into public.admin_users (
  user_id
)
values (
  '00000000-0000-4000-8000-000000000001'
)
on conflict (user_id) do nothing;

-- Plaintext local invite code: local-invite
insert into public.invite_codes (
  code_hash,
  label,
  max_uses,
  use_count,
  expires_at
)
values (
  'eebd127073acce790d0796a66fc4b5718299ddf16d9a1a8020e62326d520b079',
  'local-seed',
  20,
  0,
  null
)
on conflict (code_hash) do update
set label = excluded.label,
    max_uses = excluded.max_uses,
    expires_at = excluded.expires_at;
