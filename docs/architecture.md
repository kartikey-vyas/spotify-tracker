# Architecture

The whole system follows one rule: **public read, private write**. The browser only ever receives `PUBLIC_SUPABASE_URL` and a public Supabase key. Every write and every Spotify secret lives behind Supabase RLS or Edge Functions.

## Components

- **Frontend**: static SvelteKit app deployed to GitHub Pages
- **Database**: Supabase Postgres with RLS on every public table
- **Forward sync**: Supabase Cron calls a service-key-protected Edge Function every 15 minutes
- **Historical import**: local Marimo/Polars exploration and cleaning, followed by a user-scoped TypeScript CLI import with service credentials
- **Browser credentials**: only `PUBLIC_SUPABASE_URL` and a public Supabase key

## Public flow

The public homepage reads from `public_profile_overview`, not from the old anonymous `public_home` cache. It defaults to the `kartikey` slug and lets visitors switch between public profiles. A profile only appears there when `profiles.is_public = true` and a user-specific overview cache exists.

Public profile URLs work directly:

```text
/profile/?slug=kartikey
```

The default homepage slug is set in `src/routes/+page.svelte` as `defaultSlug`.

## Invite-only flow

The browser is still a static SvelteKit app. All writes and all Spotify secrets stay behind Supabase RLS or Edge Functions.

1. The site owner runs `pnpm invite <email>`. Supabase (custom SMTP via Resend on `krtky.dev`) emails an invite link; accounts are created server-side, so hosted signups stay disabled — invite-only holds.
2. The invitee clicks the link, lands signed-in at `/app/` with no profile yet, and sets a password + display name, slug, and visibility. The client calls `auth.updateUser({ password })` then the `complete-onboarding` Edge Function (authenticated; the session is the gate — no invite code).
3. Returning users sign in with email + password. "Forgot password?" uses `resetPasswordForEmail`; a `PASSWORD_RECOVERY` session shows the set-new-password form. Logged-in users can also change their password in-app.
4. They click "connect spotify". The `spotify-connect` Edge Function creates a short-lived OAuth state and returns a Spotify authorization URL.
5. Spotify redirects to `spotify-callback`, which exchanges the code using `SPOTIFY_CLIENT_SECRET`, encrypts the Spotify refresh token with `SPOTIFY_TOKEN_ENCRYPTION_KEY`, and stores it in `spotify_connections`.
6. Supabase Cron calls `sync-due-users` every 15 minutes using the service key stored in Supabase Vault.
7. `sync-due-users` finds stale enabled users, decrypts each refresh token, fetches recently played tracks, inserts `listening_events` with that user's `user_id`, refreshes that user's rollups, and updates their overview cache.

## Edge Functions

- `spotify-connect` requires a logged-in Supabase user.
- `spotify-callback` is public because Spotify redirects to it; it enforces its own state checks.
- `sync-due-users` is public at the JWT layer but checks the service key itself.
- `complete-onboarding` is the authenticated onboarding function; the session is the gate.

## Data model

User-specific rows live under `user_id`:

```text
profiles
spotify_connections
listening_events
rollup_daily_entity_stats
sync_state
overview_cache
public_activity_recent
```

Shared Spotify metadata remains global:

```text
artists
albums
tracks
track_artists
artist_genres
```

The main uniqueness rule for events is:

```text
(user_id, source_event_key)
```

That lets two users listen to the same track at the same time without colliding.

## Access model

```text
anon:
  can read public profile views where profiles.is_public = true
  cannot read archived legacy user_id = null rows
  cannot write

authenticated user:
  can read their own private profile, rollups, overview, activity, sync state, and events
  can update their profile visibility and Spotify sync toggle
  cannot directly insert/update/delete listening_events

Edge Functions/service key:
  owns invite validation, Spotify token exchange, scheduled sync, event inserts, and rollup refreshes
```

The old single-user public rows remain in the database with `user_id = null`, but they are archived with `archived_at` and hidden from the public read path. They are recoverable, not physically deleted.

## Data semantics

- `exact`: imported from Spotify Extended Streaming History with `ms_played`
- `api_unknown_duration`: imported from recently-played API without duration
- `inferred`: reserved for optional future player polling

Minute totals use exact and inferred durations. API-only plays are counted as plays and shown as unknown duration.

Dates are bucketed in `Australia/Melbourne`; weeks start Monday.

## Sync scheduling

The recently-played sync runs from inside the database, not GitHub Actions: a Supabase Cron job (`pg_cron` + `pg_net`, see `supabase/migrations/*_schedule_sync_due_users_cron.sql`) calls the `sync-due-users` Edge Function every 15 minutes. It reads `project_url` and `sync_secret_key` from Supabase Vault; those two Vault secrets must be created once per project (see the migration header) and are never committed.

## GitHub workflows

- `deploy.yml`: production release pipeline on `main` pushes. It builds first,
  applies pending Supabase migrations, deploys all Edge Functions, and only then
  publishes the static site to GitHub Pages. Database deployments are serialized
  and never cancelled midway by a newer push.
- `enrich-metadata.yml`: manual-only metadata enrichment (artist images/genres + backfill for imported history). Spotify removed the batch catalog endpoints (`/v1/{artists,albums,tracks}?ids=`) in Feb 2026, so the fetchers in `scripts/lib/spotify.ts` call the single-item endpoints (`/v1/artists/{id}`, …) one id at a time.

## Legacy single-user Spotify auth

The old single-user local auth helper still exists for legacy/manual sync experiments. It uses this redirect URI:

```text
http://127.0.0.1:5179/callback
```

Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` locally, then run:

```bash
pnpm spotify:auth
```

Store the printed refresh token as `SPOTIFY_REFRESH_TOKEN` only if you keep using the legacy single-user scripts. Do not use `spotify:auth` or `sync:recently-played` for the current public homepage — the current sync path is `sync-due-users`.

## Security summary

Authenticated users can read their own user-scoped rollups, overview cache, sync state, and raw listening events. They cannot directly insert/update listening events. Anon users can read public profile views where `profiles.is_public = true`; no anon writes are granted. Archived `user_id = null` rows are hidden from anon access. Spotify refresh tokens are only handled by Edge Functions and are encrypted before storage.
