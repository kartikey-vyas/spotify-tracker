# Spotify History Explorer

A static SvelteKit dashboard for public, read-only Spotify listening history exploration.

The architecture follows one rule: public read, private write.

- Frontend: static SvelteKit app for GitHub Pages
- Database: Supabase Postgres
- Historical import: local TypeScript CLI with service credentials
- Forward sync: GitHub Actions calls a secret-key-protected Supabase Edge Function
- Browser credentials: only `PUBLIC_SUPABASE_URL` and a public Supabase key

## Setup

1. Create a Supabase project.
2. Apply the SQL files in `supabase/migrations/` in order.
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
5. Install dependencies:

```bash
pnpm install
```

6. Run the app locally:

```bash
pnpm dev
```

## Invite-only Friends Mode

Apply migrations, deploy Edge Functions, and set Edge Function secrets:

```bash
supabase db push
supabase secrets set SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... SPOTIFY_TOKEN_ENCRYPTION_KEY=... SITE_URL=https://kartikey-vyas.github.io/spotify-tracker/app/
supabase functions deploy complete-onboarding
supabase functions deploy spotify-connect
supabase functions deploy spotify-callback --no-verify-jwt
supabase functions deploy sync-due-users --no-verify-jwt
```

Create an invite code locally:

```bash
pnpm invite:create --label=friend --max-uses=1
```

Friends sign in at `/app/`, complete onboarding with the invite code, then connect Spotify. Public profiles use:

```text
/profile/?slug=their-slug
```

## Local Import

Put Spotify Extended Streaming History JSON files somewhere ignored by git, for example `data/`, then run:

```bash
pnpm import:spotify-export ./data/Streaming_History_Audio_*.json
```

For a friends-mode user, pass their Supabase Auth user ID:

```bash
pnpm import:spotify-export --user-id=<auth-user-uuid> ./data/Streaming_History_Audio_*.json
```

The local importer reads `.env.local`:

```text
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

It imports track events, skips podcast rows for v1, rebuilds daily rollups, refreshes recent public activity, and regenerates `overview_cache.public_home`.

## Spotify Refresh Token

The old single-user local auth helper still exists for legacy/manual sync. For friends mode, register this Spotify redirect URI instead:

```text
https://<project-ref>.supabase.co/functions/v1/spotify-callback
```

Then each user connects Spotify from `/app/`. The refresh token is encrypted inside the Edge Function before it is stored.

For the legacy helper, set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` locally, register `http://127.0.0.1:5179/callback` as a Spotify redirect URI, then run:

```bash
pnpm spotify:auth
```

Store the printed refresh token as `SPOTIFY_REFRESH_TOKEN` only if you keep using the legacy single-user sync scripts.

## Commands

```bash
pnpm build
pnpm check
pnpm test
pnpm sync:recently-played
pnpm enrich:metadata
pnpm refresh:rollups
pnpm invite:create --label=friend
pnpm db:size
```

## Data Semantics

- `exact`: imported from Spotify Extended Streaming History with `ms_played`
- `api_unknown_duration`: imported from recently-played API without duration
- `inferred`: reserved for optional future player polling

Minute totals use exact and inferred durations. API-only plays are counted as plays and shown as unknown duration.

Dates are bucketed in `Australia/Melbourne`; weeks start Monday.

## Security

Authenticated users can read their own user-scoped rollups, overview cache, sync state, and raw listening events. They cannot directly insert/update listening events. Anon users can read legacy public data and public profile views where `profiles.is_public = true`; no anon writes are granted. Spotify refresh tokens are only handled by Edge Functions and are encrypted before storage.
