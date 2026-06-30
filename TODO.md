# TODO

## Admin operations to add later

The admin data-health page is intentionally read-only for now. Future owner-only
actions should stay behind explicit admin/service checks:

1. Trigger sync now for all due users or one selected user.
2. Rerun metadata enrichment.
3. Create and revoke invite links.
4. Pause or resume a user's Spotify sync.
5. Refresh a user's rollups and overview cache.

## Backfill extended streaming history (2014–2026)

Marimo/Polars exploration + cleaning + user-scoped TS import flow written up in
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

## Nice loading placeholder for the overview viz

**Why:** The "top music" band (cover wall + artist/track lists) loads via live
ranking queries (`loadRecent` in `src/routes/+page.svelte`) — on first paint and
on every 7d/30d toggle. While those resolve the band is blank, which feels
abrupt; the page only shows a plain "Loading overview..." line.

**What to do:**
- Add skeleton placeholders in the established terminal aesthetic (sharp, no
  flashy gradients — faint `--surface-2`/`--line` blocks with a subtle pulse):
  - Cover wall: a grid of blank square tiles (reuse `CoverWall`'s column-measure
    + complete-rows trim so the skeleton fills whole rows too).
  - Top artists/tracks: ~8 placeholder rows each.
- Drive it off a `bandLoading` flag set around `loadRecent`. Decide whether a
  toggle should swap to skeletons or keep the previous data visible until the new
  window resolves (the latter may feel smoother — there's already a load token).
- Consider the same treatment for the calendar/clock/histogram on first load.

## Custom hover tooltip matching the design language

**Why:** The viz use native `title=""` attributes (`ContributionGraph.svelte`,
`ListeningClock.svelte`, `ReleaseYearChart.svelte`, `CoverWall.svelte`), so hovers
show the slow, unstyled OS tooltip that clashes with the monospace/sharp theme.

**What to do:**
- Build one shared tooltip (a small Svelte action or component) styled with the
  theme tokens: `--surface` background, 1px `--line` border, no radius, monospace,
  small text; cursor-following or anchored to the target.
- Replace the `title` attributes across those four components with it; keep the
  existing `tooltip()` text builders as the content source.
- Mind accessibility (keyboard focus + `aria-describedby`), touch (no hover), and
  that the calendar/clock are SVG — it must work over `<path>` and `<span>` alike.
