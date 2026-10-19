# Global Popularity Score — Plan

Show how mainstream or underground each person's listening is, using Last.fm listener counts. Status: **built on branch `feat/popularity-and-hour-tags`** (migration `20261020100000_listening_insights_cache.sql`). All numbers below come from production queries run on 2026-10-19 and 2026-10-20.

## The metric

**Typical artist listeners**: the play-weighted median of the Last.fm `listeners` count of each play's primary artist.

- Use **artist** listeners, not track listeners. Artist stats cover 78–99.8% of plays per profile; track stats cover 53–87%.
- Weighted median, not mean. A mean is dominated by a few 10M-listener artists.
- Use the latest `external_music_stats` row per artist (`distinct on (artist_id) ... order by observed_on desc`). Today there is exactly one row per entity, so no change over time is visible yet.
- Plays include API-only plays (`data_quality = 2`), the same as the clock. Popularity is about *what* you play, not for how long.
- Report `coverage` (share of plays with a listener count) beside every value. Hide a value when coverage is under 50% or fewer than 50 plays are covered.

Current values:

| Profile | Plays | Typical artist listeners | Band (proposed) |
|---|---|---|---|
| m-akb | 2.9k | 2.68M | mainstream |
| bbnatnat | 3.4k | 1.39M | well known |
| kartikey | 103k | 1.29M | well known |
| mikeox | 4.0k | 136k | cult |

By year (kartikey): 2015 2.20M → 2016–17 1.73M → 2018 1.46M → 2019–21 ~1.2M → 2022 0.93M → 2023–24 ~1.3M → 2025 0.86M. A yearly series shows a clear trend. Monthly values are too noisy to show.

### Bands (proposed, log scale)

| Band | Typical artist listeners |
|---|---|
| deep underground | < 25k |
| underground | 25k – 100k |
| cult | 100k – 500k |
| well known | 500k – 2M |
| mainstream | ≥ 2M |

For reference, across all 16k artists in the catalogue: p10 4.3k, p25 25.7k, median 91.9k, p75 297k, p90 963k.

### Wording rule

The listener counts are a snapshot taken between August and October 2026. The page must say "popularity on Last.fm today", not "at the time you played". Show "Data from Last.fm" with a link (Last.fm API terms require attribution).

## Deep cuts

Tracks you played at least 3 times whose Last.fm track listeners are under 20k. Order by your plays. Show the top 10.

- One song is often several Spotify tracks (single, album, remaster). They are merged by artist and lower-cased name, and their plays are added together.
- The artist comes from the plays (`primary_artist_id`), not `track_artists`. Some tracks have two order-0 artist rows (duplicate artist records), which listed the same song twice.

**Data problem found while testing:** track stats matched through `match_method = 'mbid'` are often the wrong Last.fm entry. Featured tracks matched by MBID have a median of 434 listeners; featured tracks matched by name have 92k. 19% of non-featured MBID matches have under 1k listeners, compared with 7% of name matches. Examples: "Alive (feat. Wizkid)" with 10 listeners, "Snap My Finger (feat. PinkPantheress)" with 286.

- For v1, deep cuts use **name-matched track stats only**.
- Artist stats are not affected: 16,096 of 16,114 artists are name-matched.
- Fixing the MBID track lookup is a separate task (see Follow-ups).

## Where it is computed

A new cache row per user, **not** a new key inside `build_overview_payload`.

- `build_overview_payload` runs on every 15-minute sync and every 3-minute drain batch (`refresh_user_public_stats`). The drain path has hit statement timeouts before.
- Listener counts change only when enrichment runs, so a daily refresh is fresh enough.
- Cost: a naive per-play median by month took 2.0 s for kartikey. Aggregating to `(bucket, artist, plays)` first and taking the weighted median with a running `sum() over (partition by bucket order by listeners)` took **0.2 s**. Use the aggregated form for every series.

### Database objects (one migration)

The popularity score and the hour tags (`docs/mood-clock-plan.md`) share one cache row and one daily job.

1. `build_insights_payload(p_user_id uuid) returns jsonb`. Security invoker, `search_path = public`, execute for `service_role` only. About 1 s for kartikey (103k plays).
2. `refresh_user_insights_cache(p_user_id uuid)`. Upserts `overview_cache` with `key = 'public_insights:' || user_id`. Takes its own advisory lock (`'refresh_user_insights_cache:' || user_id`), so it never waits on the sync lock.
3. `refresh_all_insights_caches()`. Loops over every profile, the same as the rebuild loops at the end of earlier overview migrations.
4. pg_cron job `refresh-insights-caches`, daily at 17:37 UTC (03:37 or 04:37 Melbourne), away from the sync slots.
5. View `public_profile_insights` (security invoker). The same join and gate as `public_profile_overview`, on the `public_insights:` key, returning `user_id, slug, display_name, payload, generated_at`. The existing `overview_cache` RLS policy (owner, or public and not archived) covers the new key.
6. End of migration: `select public.refresh_all_insights_caches()` builds every cache once.

### Payload shape

Shape only; the values are placeholders.

```jsonc
{
  "generated_at": "<timestamptz>",
  "source": "lastfm",
  "stats_observed_through": "<date>",   // max(observed_on) used
  "last_30_days": { "median_artist_listeners": 0, "plays": 0, "covered_plays": 0 },
  "all_time":     { "median_artist_listeners": 0, "plays": 0, "covered_plays": 0 },
  "by_year": [ { "year": 0, "median_artist_listeners": 0, "plays": 0, "covered_plays": 0 } ],
  "deep_cuts": [ { "spotify_track_id": "", "track_name": "", "artist_id": 0, "artist_name": "", "plays": 0, "track_listeners": 0 } ]
}
```

The real payload has these under a `popularity` key, beside `hour_tags`.

- The band is **not** stored. The browser derives it, so the bands can be changed without a migration.
- The SQL returns every year. The browser hides any window with fewer than 50 covered plays or under 50% coverage (`reliableMedian` in `src/lib/insights.ts`), which removes kartikey's 2014 (3 plays).
- `last_30_days` uses `local_date >= melbourne_today - 29`, the same as the clock.

## Browser

- `src/lib/types.ts`: `InsightsPayload`, `PopularitySummary`, `DeepCut`, `PopularityStripRow`.
- `src/lib/insights.ts` (pure, no DOM): `POPULARITY_BANDS`, `bandFor`, `reliableMedian`, `formatListeners` (1289568 → "1.3M"), `scalePosition` (log axis 10k–10M), `buildStrip`, `buildYearSeries`.
- `src/lib/queries/insights.ts`: `getPublicProfileInsights(slug)` and `getPopularityStrip()` (all public rows, only `payload->popularity->all_time`). Both guard `if (!supabase) return null`.
- Homepage `src/routes/+page.svelte`:
  - A 4th `MetricCard` inside the existing `DitherFrame`: "Popularity, 30 days" / band / "Typical artist · 1.3M listeners". The grid becomes `cols-4` only when the card has a reliable value. No new WebGL context.
  - A "How mainstream" section (`PopularityPanel.svelte`) after "The age of your music": the band headline, the friends strip (one row per profile on a shared log axis, so close scores never collide), the by-year bars with the most underground year in accent, and the deep-cuts list. Deep-cut artists link to the explorer on "All time".
  - A failed or missing insights read hides these panels; it never fails the page.
- Not on `/profile` or `/app` in v1.

## Tests

`tests/unit/insights.test.ts` covers `bandFor`, `reliableMedian`, `formatListeners`, `scalePosition`, `buildStrip`, `buildYearSeries` and the hour-tag helpers.

- Derive band boundaries from `POPULARITY_BANDS` in assertions; do not hard-code them.
- Mutation-tested: a `<=` band boundary, a disabled coverage check, the wrong tie-break for the lowest year, and a wrong `formatListeners` threshold all fail the tests.
- No SQL test harness exists. Verify the migration by comparing payload values with the numbers in this document (for example, mikeox all-time ≈ 136k).

## Verify

1. `pnpm verify`.
2. `supabase db push`, then check `select key, payload->'popularity'->'all_time' from overview_cache where key like 'public_insights:%'` for one row per profile.
3. `select * from cron.job where jobname = 'refresh-insights-caches'`.
4. Run the app (`verify` skill) and check the card, the strip and the deep-cuts list for 2 profiles, in both themes and at phone width.

## Decisions (2026-10-20)

1. Band names and thresholds: accepted as in the table above, for now.
2. Deep-cut rule: under 20k track listeners and at least 3 plays. Under 5k gives 40–649 tracks per profile; under 20k gives 52–1347.
3. The friends strip shows every public profile's score on every profile's page: accepted.

## Follow-ups (not in v1)

- **Fix MBID track matching** in the Last.fm enrichment (`supabase/functions/_shared/external-music-enrichment.ts`). Possible fix: when an MBID lookup returns far fewer listeners than a name lookup, prefer the name match. Then re-fetch those tracks.
- **Repeat stats readings** (for example monthly per artist), so that "you found them before they got big" becomes possible.
- **Popularity by hour**: show it in the hour-tags panel ("more underground at night": 1.56M at 7am, 1.07M at 11pm for kartikey).
