# TODO

## Backfill extended streaming history (2014–2026)

Hybrid Python-explore + data-seam + TS-import plan written up in
[docs/extended-history-backfill-plan.md](docs/extended-history-backfill-plan.md).
Raw data is in `my_spotify_data.zip` (gitignored — contains PII). Key gotcha:
avoid double-counting the overlap window against the live sync.

## Restore genres via a non-Spotify source

**Why:** Spotify's Web API no longer returns the `genres` field on artist objects
(verified June 2026 — `/v1/artists/{id}` returns `genres: undefined` for major
artists; `artist_genres` has stayed at 0 rows since the app was built). The genre
UI ("Top genre", "Top genres this week", the Explorer `genre` entity) was removed
because it could only ever show "Unknown". The data plumbing is still intact and
ready to light back up.

**Candidate sources:**
- **Last.fm** — `artist.getTopTags` / `artist.getInfo`. Free API key, good coverage,
  tag-based (crowd-sourced, noisy but rich). Likely the best fit.
- **MusicBrainz** — free/open, has genre tags, but coverage is patchier and rate
  limits are strict (1 req/s). Map via the artist's MBID or name.
- **Deezer** — has genres at the album/artist level; no auth for basic reads.

**What already exists (don't rebuild):**
- `artist_genres` table + the genre rollup in `public.refresh_user_rollups`
  (`supabase/migrations/20260619104539_invite_only_friends_mode.sql`).
- `replaceArtistGenres()` in `scripts/lib/spotify-dimensions.ts` writes the rows.
- `refreshConnectedUsersPublicStats()` in `scripts/lib/supabase-admin.ts`
  propagates new genres into the daily rollups + overview cache (added when the
  enrichment refresh no-op was fixed).

**Work to do:**
1. Add a genre-source client (start with Last.fm) under `scripts/lib/`.
2. In `scripts/enrich-metadata.ts`, after upserting an artist, fetch its
   genres/tags from the chosen source and call `replaceArtistGenres()`.
   (The Spotify artist fetch still supplies name/images.)
3. Re-add the genre UI: the `genre` option in `src/routes/explore/+page.svelte`,
   the "Top genre" summary card (`src/lib/metrics.ts` + `src/routes/+page.svelte`),
   the "Top genres this week" panel, and the About-page Genres blurb.
4. Backfill: run enrichment across existing artists so historical dates get genres,
   relying on the per-user rollup refresh to propagate them.

**Removed-UI reference (commit that stripped it):** see git history for
"Remove dead genre UI" — revert/adapt those hunks when re-adding.
