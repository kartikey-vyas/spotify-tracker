alter table invite_codes
  add column if not exists accepted_email text,
  add column if not exists accepted_user_id uuid references auth.users(id) on delete set null,
  add column if not exists accepted_at timestamptz;

create index if not exists invite_codes_accepted_user_idx
  on invite_codes (accepted_user_id)
  where accepted_user_id is not null;

create index if not exists invite_codes_accepted_email_idx
  on invite_codes (lower(accepted_email))
  where accepted_email is not null;
