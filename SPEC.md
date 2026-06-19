# Spotify History Explorer Spec

## Goal

Build a public, lightweight, static Spotify listening-history explorer hosted on GitHub Pages with Supabase Free as the read database and GitHub Actions/local scripts as the only write paths.

Core principle:

```text
Public read, private write.
```

## Implemented MVP Scope

- Static SvelteKit app with `adapter-static`
- Supabase schema for artists, albums, tracks, track artists, artist genres, listening events, sync state, daily rollups, overview cache, and safe recent activity
- RLS enabled on all public schema tables
- Public read policies only for safe tables
- No anon write policies
- Local Spotify export importer
- Spotify authorization helper
- Recently-played sync job
- Metadata enrichment job
- Rollup and overview refresh RPCs
- DB size report RPC and CLI
- GitHub Pages deploy workflow
- Scheduled GitHub Actions workflows for sync and enrichment

## Non-Goals

- Multi-user auth
- Commercial Spotify app
- True public live playback
- Raw export JSON storage in Postgres
- Artwork blob storage
- Podcast deep support

## Data Quality

- `source = 1`, `data_quality = 1`: exact Spotify export rows
- `source = 2`, `data_quality = 2`: recently-played API rows with unknown duration
- `source = 3`, `data_quality = 3`: reserved inferred player session rows

Minute totals exclude API-only unknown-duration events. Play totals include them.

## Public Read Surface

The browser uses:

- `overview_cache`
- `rollup_daily_entity_stats`
- `artists`
- `albums`
- `tracks`
- `track_artists`
- `artist_genres`
- `public_activity_recent`

The browser does not receive direct access to `listening_events` or `sync_state`.

## Operational Flow

1. Apply migrations to Supabase.
2. Configure public GitHub repository variables.
3. Configure private GitHub Actions secrets.
4. Run local import against Spotify export files.
5. Run metadata enrichment.
6. Enable scheduled recently-played sync.
7. Deploy static site to GitHub Pages.
