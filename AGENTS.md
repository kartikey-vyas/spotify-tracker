# AGENTS.md

This file provides guidance to coding agents working in this repository.

## What this is

A static SvelteKit dashboard (deployed to GitHub Pages) for exploring public, read-only Spotify listening history across invited users. The governing rule is **public read, private write**: the browser only ever gets `PUBLIC_SUPABASE_URL` and a public Supabase key. Every write and every Spotify secret lives behind Supabase RLS or Edge Functions.

## Commands

Package manager is **pnpm** (Node >= 22). Scripts run under `tsx`. Python tooling uses **uv** for the Marimo/Polars backfill utilities.

```bash
pnpm dev          # local dev server
pnpm build        # static build into build/ (adapter-static)
pnpm check        # svelte-kit sync + svelte-check (app type checking)
pnpm typecheck    # tsc on scripts/ via tsconfig.scripts.json
pnpm test         # vitest run (tests/unit/*.test.ts)
uv run pytest     # Python tests for tools/spotify_backfill
```

Run a single test: `pnpm vitest run tests/unit/dates.test.ts` (or `pnpm vitest -t "<name>"`).

Operational CLIs (require `.env.local` with `SUPABASE_URL` + `SUPABASE_SECRET_KEY`):

```bash
pnpm invite:create --label=friend --max-uses=1 --site-url=https://.../app/
uv run marimo edit notebooks/spotify_extended_history_explore.py
uv run python -m tools.spotify_backfill.clean --input my_spotify_data.zip --out analysis/out --cutoff-iso '<timestamp>'
pnpm import:spotify-export --user-id=<auth-user-uuid> analysis/out/cleaned_*.json
pnpm db:size
```

`spotify:auth` and `sync:recently-played` are **legacy single-user / manual** commands. Do not use them for the current public homepage — current sync is the `sync-due-users` Edge Function. `enrich:metadata` remains useful after large imports to backfill Spotify metadata and refresh affected user rollups.

## Four separate runtimes — do not mix them

This repo has three TypeScript environments plus local Python tooling with different module systems and env access. Code does not cross between them.

1. **Browser app** (`src/`) — SvelteKit + Svelte 5, prerendered. Reads env via `$env/dynamic/public`, talks to Supabase only through the public client in `src/lib/supabase.ts` (nullable — every query guards `if (!supabase) return null`). Type checked with `pnpm check`.
2. **Node scripts** (`scripts/`) — `tsx`, ESM, service-key access. Env loaded from `.env.local`/`.env` via `scripts/lib/env.ts`; Supabase admin client in `scripts/lib/supabase-admin.ts`. Type checked with `pnpm typecheck` (`tsconfig.scripts.json`).
3. **Supabase Edge Functions** (`supabase/functions/`) — **Deno**, `npm:`/URL imports, `Deno.env`. Shared helpers in `supabase/functions/_shared/`. Not covered by either tsconfig.
4. **Python backfill tools** (`tools/spotify_backfill/`, `notebooks/`) — `uv`, Marimo, Polars, DuckDB. These are local-only tools for PII-sensitive Spotify export exploration and cleaning; generated data belongs under gitignored `analysis/`.

There is intentional duplication of helpers (dates, hashing, Spotify dimensions, env) across `scripts/lib/` and `supabase/functions/_shared/` because Node and Deno cannot share modules. When changing logic in one, check whether the parallel copy needs the same change.

## Data architecture

- **Per-user rows** are keyed by `user_id`: `profiles`, `spotify_connections`, `listening_events`, `rollup_daily_entity_stats`, `sync_state`, `overview_cache`, `public_activity_recent`.
- **Shared Spotify metadata** is global (no `user_id`): `artists`, `albums`, `tracks`, `track_artists`, `artist_genres`.
- Event uniqueness is `(user_id, source_event_key)` so two users can play the same track at the same instant without colliding.
- Legacy single-user data lives as `user_id = null` rows, now **archived** (`archived_at` set) and hidden from the public read path — recoverable, not deleted.

The browser's read surface is restricted to safe views/tables: `public_profile_overview`, `overview_cache`, `rollup_daily_entity_stats`, the metadata tables, and `public_activity_recent`. It never gets direct access to `listening_events` or `sync_state`. A profile only appears publicly when `profiles.is_public = true` and a user-scoped overview cache exists. The public homepage default slug is `defaultSlug` in `src/routes/+page.svelte`.

### Data quality / metrics semantics

- `source/data_quality = 1` (`exact`): Spotify export rows with `ms_played`.
- `source/data_quality = 2` (`api_unknown_duration`): recently-played API rows, no duration.
- `source/data_quality = 3` (`inferred`): reserved.
- **Minute totals** count exact + inferred durations only; **play totals** include API-only plays. See `src/lib/metrics.ts`.
- Dates bucket in `Australia/Melbourne`, weeks start Monday (`src/lib/dateRanges.ts`, `scripts/lib/dates.ts`).

## Extended history backfill

The committed workflow is documented in `docs/extended-history-backfill-plan.md`.

1. Explore with `uv run marimo edit notebooks/spotify_extended_history_explore.py`.
2. Find the cutoff with `min(played_at)` for the target user where `source = 2`.
3. Clean with `uv run python -m tools.spotify_backfill.clean --input my_spotify_data.zip --out analysis/out --cutoff-iso '<timestamp>'`.
4. Import with `pnpm import:spotify-export --user-id=<auth-user-uuid> analysis/out/cleaned_*.json`.
5. Re-run the import once to verify idempotency, then run `pnpm enrich:metadata` until counts taper off.

The TypeScript importer requires `--user-id`; do not add back the null-user path. The cleaner emits JSON arrays, excludes PII columns, drops rows without `spotify_track_uri`, and preserves the source-event hash fields verbatim.

## Auth & sync flow (invite-only)

1. Owner runs `pnpm invite:create`; the **plaintext token is printed once** (stored only as a SHA-256 hash in Supabase).
2. Friend opens `/app/invite/?code=...`, submits email/display name/slug/visibility.
3. `accept-invite` Edge Function (public at the JWT layer — the invite token *is* the credential) creates the Auth user, `profiles`, and `sync_state`, then consumes the invite. The invite page sends a magic link (`shouldCreateUser: false`).
4. After sign-in at `/app/`, the user connects Spotify. `spotify-connect` (requires logged-in user) returns an auth URL; `spotify-callback` (public — Spotify redirects to it) exchanges the code, encrypts the refresh token with `SPOTIFY_TOKEN_ENCRYPTION_KEY`, stores it in `spotify_connections`.
5. **`sync-due-users`** (public at JWT layer but gates itself via `assertServiceRequest` checking the `apikey` header) finds stale enabled users, decrypts each token, fetches recently played, inserts `listening_events`, and refreshes that user's rollups + overview cache.

`complete-onboarding` is deployed for legacy/manual recovery only.

### What drives the sync cron

Sync scheduling has **moved from GitHub Actions into the database** (pg_cron + pg_net) because scheduled Actions were unreliable. See `supabase/migrations/20260619142000_schedule_sync_due_users_cron.sql`: `trigger_sync_due_users()` reads `project_url` and `sync_secret_key` from Supabase **Vault** and POSTs to `sync-due-users` every 15 minutes. The two Vault secrets must be created once per project (see the migration header) and are never committed. The old `.github/workflows/sync-recently-played.yml` has been deleted; README references to it are stale.

## Edge Functions deploy

```bash
supabase db push
supabase functions deploy accept-invite --no-verify-jwt
supabase functions deploy spotify-callback --no-verify-jwt
supabase functions deploy sync-due-users --no-verify-jwt
supabase functions deploy spotify-connect          # requires JWT
supabase functions deploy complete-onboarding
```

The `--no-verify-jwt` functions enforce their own credential checks (invite token / Spotify redirect / service `apikey`).

**Do not run `supabase config push`** unless hosted Auth URLs and provider settings have been reviewed in the dashboard. The checked-in `supabase/config.toml` disables email signups for local dev; hosted Auth provider settings (public signups disabled, redirect URLs) are managed separately in the Supabase dashboard.

## Migrations

Numbered prefixes (`0001_`…`0003_`) are the original schema; later migrations use timestamp prefixes (`YYYYMMDDHHMMSS_`). RLS is enabled on all public tables with public-read policies only for safe tables and no anon write policies.

## Deploy

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on pushes to `main`. The base path is `/<repo-name>` in production (overridable via `PUBLIC_BASE_PATH`), so all in-app links must respect SvelteKit's `base` — see `svelte.config.js`.
