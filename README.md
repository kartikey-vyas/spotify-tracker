# musik

A static SvelteKit dashboard for public, read-only Spotify listening history exploration across selected public profiles.

The architecture follows one rule: public read, private write.

- Frontend: static SvelteKit app for GitHub Pages
- Database: Supabase Postgres
- Historical import: local TypeScript CLI with service credentials, usually scoped to a Supabase Auth user
- Forward sync: GitHub Actions calls a service-key-protected Supabase Edge Function every 15 minutes
- Browser credentials: only `PUBLIC_SUPABASE_URL` and a public Supabase key

## Setup

1. Create a Supabase project.
2. Apply migrations with `supabase db push`.
3. Add GitHub repository variables:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Optional fallback: `PUBLIC_SUPABASE_ANON_KEY`
   - Optional: `PUBLIC_BASE_PATH` if the GitHub Pages base path should not be `/${repo-name}`
4. Add GitHub Actions secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
5. Add Supabase Edge Function secrets:
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `SPOTIFY_TOKEN_ENCRYPTION_KEY`
   - `SITE_URL`
6. Configure Supabase Auth URL settings:
   - Site URL: `https://kartikey-vyas.github.io/spotify-tracker/app/`
   - Redirect URL: `https://kartikey-vyas.github.io/spotify-tracker/app/`
7. In Supabase Auth email provider settings, disable public email signups. Create new Auth users manually from the Supabase dashboard invite flow or the Admin API.
8. Configure the Spotify app redirect URI exactly:
   - `https://<project-ref>.supabase.co/functions/v1/spotify-callback`
9. Install dependencies:

```bash
pnpm install
```

10. Run the app locally:

```bash
pnpm dev
```

## Current Public Flow

The public homepage reads from `public_profile_overview`, not from the old anonymous `public_home` cache. It defaults to the `kartikey` slug and lets visitors switch between public profiles. A profile only appears there when `profiles.is_public = true` and a user-specific overview cache exists.

Public profile URLs still work directly:

```text
/profile/?slug=kartikey
```

The default homepage slug is set in `src/routes/+page.svelte` as `defaultSlug`.

## Invite-only User Mode

Invite-only mode adds private per-user data while keeping the site static and publicly readable where users opt in.

Apply migrations, deploy Edge Functions, and set Edge Function secrets:

```bash
supabase db push
supabase secrets set SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... SPOTIFY_TOKEN_ENCRYPTION_KEY=... SITE_URL=https://kartikey-vyas.github.io/spotify-tracker/app/
supabase functions deploy accept-invite --no-verify-jwt
supabase functions deploy complete-onboarding
supabase functions deploy spotify-connect
supabase functions deploy spotify-callback --no-verify-jwt
supabase functions deploy sync-due-users --no-verify-jwt
```

`accept-invite` is public at the JWT layer because the invite token is the credential. `spotify-connect` requires a logged-in Supabase user. `spotify-callback` is public because Spotify redirects to it. `sync-due-users` is public at the JWT layer but checks the service key itself. `complete-onboarding` remains deployed for legacy/manual recovery only.

The checked-in local Supabase config has email signups disabled for local development. Hosted Auth provider settings are managed separately in the Supabase dashboard; do not use `supabase config push` unless the hosted Auth URLs and provider settings have been reviewed.

Create an invite link locally:

```bash
pnpm invite:create --label=friend --max-uses=1
```

Invite tokens are stored as SHA-256 hashes in Supabase. The plaintext token and invite URL are only printed by the creation command, so copy the URL when it is generated. Set `SITE_URL=https://kartikey-vyas.github.io/spotify-tracker/app/` locally, or pass `--site-url=...`, so the command can print the full URL.

Send the invite URL to the user. They choose an email, display name, slug, and public/private profile setting from `/app/invite/`. The app creates their Auth user, profile, and sync state, then sends a magic sign-in link. After signing in, they connect Spotify from `/app/`.

### How it works

The browser is still a static SvelteKit app. It only receives `PUBLIC_SUPABASE_URL` and a public Supabase key. All writes and all Spotify secrets stay behind Supabase RLS or Edge Functions.

1. The site owner creates an invite link with `pnpm invite:create`.
2. The friend opens `/app/invite/?code=...` and submits email, display name, slug, and public/private choice.
3. The `accept-invite` Edge Function validates the token, creates the Supabase Auth user, creates `profiles`, creates initial `sync_state`, and consumes the invite.
4. The invite page sends a magic sign-in link with `shouldCreateUser: false`.
5. The friend signs in from email and lands at `/app/`.
6. They click "connect spotify". The `spotify-connect` Edge Function creates a short-lived OAuth state and returns a Spotify authorization URL.
7. Spotify redirects to `spotify-callback`, which exchanges the code using `SPOTIFY_CLIENT_SECRET`, encrypts the Spotify refresh token with `SPOTIFY_TOKEN_ENCRYPTION_KEY`, and stores it in `spotify_connections`.
8. GitHub Actions calls `sync-due-users` with `SUPABASE_SECRET_KEY` on the `7,22,37,52 * * * *` cron.
9. `sync-due-users` finds stale enabled users, decrypts each refresh token, fetches recently played tracks, inserts `listening_events` with that user's `user_id`, refreshes that user's rollups, and updates their overview cache.

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

### Access model

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

## Local Import

Put Spotify Extended Streaming History JSON files somewhere ignored by git, for example `data/`, then run:

```bash
pnpm import:spotify-export --user-id=<auth-user-uuid> ./data/Streaming_History_Audio_*.json
```

The `--user-id` value is the Supabase Auth user ID for the profile that should receive the imported events. The importer refreshes that user's rollups, recent activity, and `overview_cache` row.

Running the importer without `--user-id` writes legacy `user_id = null` rows. That path is kept for old/manual recovery workflows, but it no longer feeds the public homepage.

The local importer reads `.env.local`:

```text
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

It imports track events, skips podcast rows for v1, and rebuilds user-scoped public stats.

## Spotify OAuth

Current user connections go through Supabase Edge Functions. Register this Spotify redirect URI:

```text
https://<project-ref>.supabase.co/functions/v1/spotify-callback
```

Then users connect Spotify from `/app/`. The refresh token is encrypted inside the Edge Function before it is stored in `spotify_connections`.

The old single-user local auth helper still exists for legacy/manual sync experiments:

```text
http://127.0.0.1:5179/callback
```

Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` locally, then run:

```bash
pnpm spotify:auth
```

Store the printed refresh token as `SPOTIFY_REFRESH_TOKEN` only if you keep using the legacy single-user scripts.

## GitHub Workflows

- `deploy.yml`: builds and deploys the static site to GitHub Pages on `main` pushes.
- `enrich-metadata.yml`: manual-only metadata enrichment (artist images/genres + backfill for imported history). Spotify removed the batch catalog endpoints (`/v1/{artists,albums,tracks}?ids=`) in Feb 2026, so the fetchers in `scripts/lib/spotify.ts` call the single-item endpoints (`/v1/artists/{id}`, …) one id at a time.

The recently-played sync no longer runs from GitHub Actions: a Supabase Cron job (`pg_cron` + `pg_net`, see `supabase/migrations/*_schedule_sync_due_users_cron.sql`) calls the `sync-due-users` Edge Function every 15 minutes.

## Commands

```bash
pnpm build
pnpm check
pnpm test
pnpm typecheck
pnpm invite:create --label=friend --max-uses=1 --site-url=https://kartikey-vyas.github.io/spotify-tracker/app/
pnpm import:spotify-export --user-id=<auth-user-uuid> ./data/Streaming_History_Audio_*.json
pnpm db:size
```

Legacy/manual commands still present in `package.json`:

```bash
pnpm spotify:auth
pnpm sync:recently-played
pnpm enrich:metadata
```

Do not use the legacy null-user commands for the current public homepage. The current sync path is `sync-due-users`.

## Data Semantics

- `exact`: imported from Spotify Extended Streaming History with `ms_played`
- `api_unknown_duration`: imported from recently-played API without duration
- `inferred`: reserved for optional future player polling

Minute totals use exact and inferred durations. API-only plays are counted as plays and shown as unknown duration.

Dates are bucketed in `Australia/Melbourne`; weeks start Monday.

## Security

Authenticated users can read their own user-scoped rollups, overview cache, sync state, and raw listening events. They cannot directly insert/update listening events. Anon users can read public profile views where `profiles.is_public = true`; no anon writes are granted. Archived `user_id = null` rows are hidden from anon access. Spotify refresh tokens are only handled by Edge Functions and are encrypted before storage.
