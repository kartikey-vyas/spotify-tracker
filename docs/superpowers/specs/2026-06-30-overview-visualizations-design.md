# Overview visualizations — design

Date: 2026-06-30
Status: approved, in progress
Branch: `overview-viz`

Three additions to the Overview page (`/`), all fed by the precomputed overview cache:

1. **Listening calendar redesign** — GitHub-style, per-year, with a year selector.
2. **Listening clock** — 24×7 hour-of-day × weekday heatmap (all-time).
3. **Release-year histogram** — plays by the release year of the music.

The site is prerendered (`adapter-static`); the Overview page reads a single JSONB
payload from `overview_cache.payload`, built server-side by the PL/pgSQL function
`build_overview_payload(p_user_id)`. Refresh is automatic: `refresh_user_overview_cache`
runs on every sync/enrichment via `refresh_user_public_stats`. So all data work is:
extend `build_overview_payload`, extend the `OverviewPayload` type, render it.

---

## 1. Listening calendar redesign

**What changes:** today the calendar is a rolling last-53-weeks grid. It becomes a
fixed **Jan 1 → Dec 31** grid for one selected year, with a vertical **year selector
on the right** (newest year on top, defaults to the latest year). Clicking a year
swaps the grid.

**Look:** GitHub-sized fixed cells (the grid does not stretch its cells to fill the
width — extra width is absorbed by the year column + spacing). Colour intensity is
relative to **that year's own busiest day** (each year uses full contrast; years are
not comparable to each other). Hover tooltip (date + plays) retained.

**Data:** the cache currently emits `calendar.last_365_days` (only the last 365 days).
We switch it to **full daily history** under a renamed field `calendar.daily`
(all `{ local_date, minutes, plays }`, every day with activity, ordered ascending).
Even ~10 years is well under 100 KB. Days without activity are simply absent and the
grid fills them as zero (existing behaviour).

**Code:**
- `src/lib/calendar.ts`: add `buildYearGrid(days, year, metric)` (fixed Jan–Dec layout,
  Sunday-first rows, out-of-year cells flagged `inRange: false`, levels relative to the
  year's max) and `availableYears(days)` (distinct years with data, descending). Reuses
  the existing private helpers (`parseISODate`, `toISODate`, `levelFor`, month names).
  The existing `buildContributionGrid` is left intact.
- `src/lib/components/ContributionGraph.svelte`: render `buildYearGrid` for a selected
  year + the RHS year selector; internal `selectedYear` state defaulting to the newest.
- `src/routes/+page.svelte`: pass `overview.calendar.daily`; update the subhead.

---

## 2. Listening clock

**What:** a 24×7 heatmap. **x-axis = hour 0–23**, **y-axis = weekday Mon→Sun**, one
shaded cell per (weekday, hour), intensity = plays relative to the busiest cell.
**All-time.** Tooltip like `Mon 23:00 · 412 plays`. Same monochrome `color-mix` ramp
as the calendar; works across every theme.

**Data:** new cache field `clock` — a sparse array of `{ dow, hour, plays }` for
non-empty buckets, computed from raw `listening_events` in **local** time:

```sql
select
  extract(dow  from (played_at at time zone 'Australia/Melbourne'))::int as dow,  -- 0=Sun..6=Sat
  extract(hour from (played_at at time zone 'Australia/Melbourne'))::int as hour, -- 0..23
  count(*)::int as plays
from listening_events
where ((p_user_id is null and user_id is null) or user_id = p_user_id)
group by 1, 2
```

**Code:**
- `src/lib/clock.ts`: pure `buildClockGrid(buckets)` → `{ rows, maxValue, total }` with 7
  rows (Mon→Sun), each 24 cells `{ hour, value, level }`, zero-filled; level 0–4 relative
  to `maxValue`. Empty input → empty grid.
- `src/lib/components/ListeningClock.svelte`: render the grid + weekday/hour labels +
  legend + tooltips.

---

## 3. Release-year histogram

**What:** vertical bars, one per release year from the earliest meaningful year to now;
bar height = **plays** of music released that year. **Compilations excluded.** Tooltip
`2019 · N plays`.

**Data:** new cache field `release_years` — sparse `{ year, plays }`, computed by joining
plays to album release year. `albums.release_date` is **free text** (`2024`, `2024-06`,
or `2024-06-15`), so we take the leading 4 characters, keep only plausible 4-digit years,
and skip `album_type = 'compilation'`:

```sql
select
  left(al.release_date, 4)::int as year,
  count(*)::int as plays
from listening_events e
join albums al on al.id = e.album_id
where ((p_user_id is null and user_id is null) or e.user_id = p_user_id)
  and al.album_type is distinct from 'compilation'
  and al.release_date ~ '^\d{4}'
  and left(al.release_date, 4)::int between 1900 and extract(year from now())::int + 1
group by 1
```

**Code:**
- `src/lib/release-years.ts`: pure `buildReleaseYearChart(buckets)` → `{ bars, maxValue,
  total }` where `bars` spans every year min→max ascending, gap-filled with zero, each
  `{ year, value, fraction }` (`fraction = value / maxValue` for bar height).
- `src/lib/components/ReleaseYearChart.svelte`: render bars + sparse year axis labels +
  tooltips.

---

## Shared / cross-cutting

- **Migration:** a new file `supabase/migrations/<ts>_overview_clock_release_calendar.sql`
  that `create or replace`s `build_overview_payload` with the three changes
  (`calendar.daily`, `clock`, `release_years`) and ends with the standard
  `do $$ ... refresh_user_overview_cache(...) ... $$` rebuild loop so every cache is
  rebuilt on apply. Old migrations are not edited.
- **Types** (`src/lib/types.ts`): rename `calendar.last_365_days` → `calendar.daily`; add
  `ClockBucket`, `ReleaseYearBucket`; add `clock?` and `release_years?` to
  `OverviewPayload` (optional so a not-yet-rebuilt cache renders gracefully — the page
  hides those sections when the field is absent/empty).
- **Page** (`src/routes/+page.svelte`): swap calendar field name (4 refs), add the clock +
  histogram panels (each guarded by data presence).
- **Aesthetic:** monochrome `var(--accent)` ramp via `color-mix`, matching
  `ContributionGraph`.
- **Testing:** the three pure modules get Vitest unit tests (mirroring
  `tests/unit/calendar.test.ts`): year layout (leap year, year starting mid-week, partial
  current year, level bucketing, month labels), clock zero-fill + weekday ordering + level
  bucketing, histogram gap-fill + fraction. `pnpm test`, `svelte-check`, and the
  production build must stay clean. The SQL is validated by inspection against existing
  patterns (no local Postgres); it takes effect when the migration is applied and caches
  rebuild.

## Out of scope / known caveats

- No audio features or popularity data exist, so no mood/energy viz.
- Release years for non-compilation re-releases/remasters can still be the re-release date
  (we only have the album's `release_date`, not the track's original ISRC date). Excluding
  compilations removes the worst offenders; the rest is accepted.
- Timezone is hard-coded `Australia/Melbourne` (no per-user tz field), consistent with the
  rest of the app.
