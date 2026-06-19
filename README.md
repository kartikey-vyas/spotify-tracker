# Spotify History Explorer

A static SvelteKit dashboard for public, read-only Spotify listening history exploration.

The architecture follows one rule: public read, private write.

- Frontend: static SvelteKit app for GitHub Pages
- Database: Supabase Postgres
- Historical import: local TypeScript CLI with service credentials
- Forward sync: GitHub Actions using Spotify refresh token and Supabase service role
- Browser credentials: only `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`

## Setup

1. Create a Supabase project.
2. Apply the SQL files in `supabase/migrations/` in order.
3. Add GitHub repository variables:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
   - Optional: `PUBLIC_BASE_PATH` if the GitHub Pages base path should not be `/${repo-name}`
4. Add GitHub Actions secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `SPOTIFY_REFRESH_TOKEN`
5. Install dependencies:

```bash
pnpm install
```

6. Run the app locally:

```bash
pnpm dev
```

## Local Import

Put Spotify Extended Streaming History JSON files somewhere ignored by git, for example `data/`, then run:

```bash
pnpm import:spotify-export ./data/Streaming_History_Audio_*.json
```

The local importer reads `.env.local`:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

It imports track events, skips podcast rows for v1, rebuilds daily rollups, refreshes recent public activity, and regenerates `overview_cache.public_home`.

## Spotify Refresh Token

Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` locally, register `http://127.0.0.1:5179/callback` as a Spotify redirect URI, then run:

```bash
pnpm spotify:auth
```

Store the printed refresh token as `SPOTIFY_REFRESH_TOKEN` in GitHub Actions Secrets.

## Commands

```bash
pnpm build
pnpm check
pnpm test
pnpm sync:recently-played
pnpm enrich:metadata
pnpm refresh:rollups
pnpm db:size
```

## Data Semantics

- `exact`: imported from Spotify Extended Streaming History with `ms_played`
- `api_unknown_duration`: imported from recently-played API without duration
- `inferred`: reserved for optional future player polling

Minute totals use exact and inferred durations. API-only plays are counted as plays and shown as unknown duration.

Dates are bucketed in `Australia/Melbourne`; weeks start Monday.

## Security

Anon/authenticated roles can select only public metadata, daily rollups, overview cache, and refreshed recent activity. They have no insert, update, or delete policies. Core event history and sync state are writeable only through service-role scripts and Actions.
