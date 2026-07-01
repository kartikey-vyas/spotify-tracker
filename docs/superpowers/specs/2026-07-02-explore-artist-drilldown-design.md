# Explore Artist Drilldown Design

## Goal

Improve `/explore` so a visitor can choose one public profile, inspect that profile's artist rankings for a date range, and click an artist to see the albums, tracks, and months where that artist was played most.

The page must preserve the repository's public-read/private-write rule. Browser access stays limited to public Supabase keys and safe public aggregate surfaces; no raw `listening_events` rows are exposed to anonymous clients.

## Scope

The first version is profile-scoped and artist-first:

- `/explore` defaults to the same public profile used by the homepage.
- A profile selector in the toolbar switches between public profiles.
- Changing the profile writes `?profile=<slug>` into the URL so the page is shareable.
- Date ranges include the existing presets plus an `All time` option.
- Rankings use the selected profile and date range, not an aggregate across all public profiles.
- Clicking an artist in the ranking updates the URL with `entity=artist&id=<artist_id>` and opens a detail pane.
- If no artist is selected, the detail pane shows an empty prompt. The page does not auto-select the top artist.
- Artist drilldowns count only primary-artist plays in v1, matching existing artist rollup semantics.
- Selected artist top albums, top tracks, and monthly timeline use the active date range.
- The existing ASCII-based "Distribution" chart sections should be removed from `/explore`. V1 should not replace them with another text-art chart.

Track and album drilldowns are out of scope for this version, but the design should leave a clear path for equivalent detail panes later.

## Data Model And API

The current explore route should stop reading `rollup_daily_entity_stats` directly for public browsing. Main rankings should use `public_profile_rollup_daily_entity_stats` filtered by the selected `slug`.

Artist detail needs a new public aggregate database surface. Implement it as narrowly scoped `security definer` RPC functions with fixed parameters, `set search_path = public`, and explicit grants to `anon` and `authenticated`. This is necessary because anonymous callers should not receive direct `listening_events` access, and security-invoker functions would be blocked by the existing RLS policy.

The RPCs must return only grouped metrics for public profiles. They must not expose direct event rows, event IDs, timestamps, or source event keys.

Required aggregate outputs for a selected `(slug, artist_id, start_date, end_date)`:

- Artist summary row with the same metric fields as `RankingRow`.
- Top albums for that artist/date window.
- Top tracks for that artist/date window.
- Monthly artist timeline buckets for that artist/date window.

The SQL should aggregate from `listening_events` joined through `profiles` and the relevant dimension tables. It must filter `profiles.is_public = true`, `e.primary_artist_id = artist_id`, and `e.local_date between start_date and end_date`.

Metric semantics should mirror existing rollups:

- `minutes = sum(coalesce(ms_played, 0) + coalesce(inferred_ms_played, 0)) / 60000`
- `plays = count(*)`, including API-only plays
- `qualified_plays = count(*) where duration is at least 30 seconds`
- `unique_tracks = count(distinct track_id)`
- skip fields follow current rollup formulas
- `unknown_duration_plays` counts plays without exact or inferred duration

For `All time`, the frontend should resolve the selected profile's public rollup date span first, then call the same ranking and artist-detail paths with concrete `start` and `end` dates. This keeps the public data path bounded and avoids special open-ended query behavior.

## Frontend Behavior

The toolbar should become:

- Profile selector
- Date range selector, including `All time`
- Metric selector
- Entity selector retained for existing artist/track/album rankings

The default route state is profile-scoped artist rankings with no selected artist. Existing track and album ranking modes should keep working, but the artist detail pane only appears for `entity=artist`.

URL state:

- `profile=<slug>` identifies the selected public profile.
- `entity=artist|track|album` identifies the ranking mode.
- `id=<entity_id>` identifies the selected artist only when `entity=artist`.
- Invalid or unavailable profile slugs fall back to the default public profile and clear stale selected entity state.

Artist selection should be driven by clicking the artist ranking table, not by manually entering an ID. Search/select for any artist in the profile is a later enhancement.

## Layout

Use a side-by-side browser layout:

- Left pane: artist ranking table for the selected profile/date range.
- Right pane: selected artist detail.

Selected artist detail contains:

- Summary strip with artist name, active metric value, plays, and unique tracks.
- Monthly timeline showing the artist's strongest months in the active range, using normal UI elements rather than ASCII output.
- Top albums table for that artist in the active range.
- Top tracks table for that artist in the active range.

When no artist is selected, the right pane should show a quiet empty state: select an artist from the ranking.

On narrow screens, stack the ranking above the detail pane while keeping the same source order.

The ranking area should prioritize sortable/readable tables and the artist detail pane. Remove the current standalone ASCII distribution panel because it is hard to scan and does not work well across real artist names or responsive widths.

## Edge Cases

- If Supabase public env is missing, the page keeps the existing empty/read-only behavior.
- If a profile has no rollups, show an empty ranking state and avoid all-time queries without bounds.
- If an artist is selected but has no rows in the active range, show an empty artist-detail state instead of stale data.
- If the date range changes, preserve the selected artist ID and reload detail. This lets shared artist URLs remain useful even when the artist is no longer in the visible top ranking.
- If the profile changes, clear the selected artist unless the URL explicitly provides one for the new profile.
- If aggregate detail queries fail independently of rankings, show the error in the detail pane without replacing the ranking list.

## Testing

Add focused tests around the data boundary and UI helpers:

- Profile-scoped ranking tests that prove `/explore` does not mix public profile rollups.
- All-time date span resolution from public profile rollups.
- Artist detail query helper mapping for summary, top albums, top tracks, and monthly buckets.
- Monthly timeline formatting/aggregation helpers.
- Explore page regression checks that the old ASCII distribution panel is gone.

If local Supabase is available, verify the migration through a database reset. If it is not available, use SQL review plus frontend unit tests and Svelte type checking.

## Future Work

Album and track drilldowns should follow the same pattern once the artist version is proven:

- profile-scoped ranking list
- URL-selected entity
- aggregate-only public detail surface
- timeline and related top entities for the active date range

Credited-artist support is also future work. It would require deciding how to count features and collaborations against the existing primary-artist rollup semantics.
