# Local Development

## Day-to-day: point at the hosted project

Normal local app development points at the hosted Supabase project via `.env.local`, which lets `pnpm dev` show live data:

```text
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=<hosted publishable key>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<hosted secret key>
```

The `PUBLIC_*` values are safe for the browser; the `SUPABASE_SECRET_KEY` is only read by the Node CLI scripts (`pnpm invite`, `pnpm import:spotify-export`, etc.) and must never be exposed to the app.

## Full local stack: Supabase CLI

To test the full local Auth flow instead, run `supabase start` and add a gitignored `.env.development.local` override using values from `supabase status -o env`. Remove this file when you want the browser to use live hosted data again:

```text
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local PUBLISHABLE_KEY>
SITE_URL=http://127.0.0.1:5173/app/
```

The local Supabase stack is configured for Vite's default dev origin. Auth emails are captured by Mailpit/Inbucket at `http://127.0.0.1:54324`; they are not sent externally.

Local `supabase/config.toml` enables Auth signups so auth emails (password reset, invite) are issued and captured by Mailpit rather than sent externally. Accounts are only ever created via the admin invite path (`pnpm invite`), never by typing an email into `/app/`. Hosted Auth signup policy is managed separately in the Supabase dashboard; **do not run `supabase config push`** without reviewing it.

For local Edge Functions, create the gitignored file `supabase/functions/.env` with the same local secret key:

```text
SUPABASE_SECRET_KEY=<local SECRET_KEY>
```

`supabase start` loads this file automatically. If the stack is already running, restart it after creating or changing local Auth/function config.

## Seeded local admin

`supabase/seed.sql` creates a local owner account and admin marker on `supabase db reset`:

```text
email: admin@local.test
profile: /local-admin
```

To test admin auth locally:

1. Start Supabase and the app: `supabase start`, then `pnpm dev`.
2. Open `/app/`, enter `admin@local.test`, and use "forgot password?" (the seeded admin has no password).
3. Open Mailpit at `http://127.0.0.1:54324`, click the password-reset link, and set a password.
4. You are now signed in; open `/admin/` — the seeded user is in `admin_users`.

## Testing the invite flow end to end

```bash
pnpm invite <email> --site-url=http://127.0.0.1:5173/app/
```

The invite email appears in Mailpit at `http://127.0.0.1:54324`; click it to land signed-in and set a password + profile. Local users can also be inspected or deleted in Supabase Studio at `http://127.0.0.1:54323`.
