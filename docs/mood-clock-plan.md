# Hour Tags ("mood clock") — Plan

For each part of the day, show which Last.fm tags a person plays more than their own average. Status: **built on branch `feat/popularity-and-hour-tags`**, shown as "What your hours sound like". The tag list was accepted as drafted on 2026-10-20 and can be revised later. All numbers below come from production queries run on 2026-10-19.

## Tag list

The draft is `docs/mood-clock-tags-draft.csv` (columns: `normalized_tag, decision, category, label, plays_covered, notes`). It has 554 tags: the top 520 by play coverage, plus 34 mood and texture tags from further down.

| Decision | Category | Tags |
|---|---|---|
| include | style | 290 |
| include | texture | 41 |
| include | mood | 26 |
| exclude | place | 94 |
| exclude | junk | 54 |
| exclude | person_or_label | 42 |
| exclude | era | 7 |

- The included tags collapse into 280 display labels; synonyms are merged, for example `lo fi`/`lofi`/`lo fi hip hop` → "lo-fi".
- Genres in `genre_tag_rules` stay eligible. With mood and texture labels only, the three smaller profiles had almost nothing to show; the interesting results are styles. Because of this, the panel is better called something like **"What your hours sound like"** than "mood".
- Tags with 2 or fewer artists are excluded as junk.

Plays covered by at least one included label: kartikey 96.6%, mikeox 64.9%, bbnatnat 90.2%, m-akb 77.9%. The gaps are missing Last.fm tags, not curation.

## The rule

Use artist tags only (track tags cover 2.9k of 29k tracks), with rank ≤ 10 and Melbourne hours.

- **Buckets:** five parts of day: late night 0–5, morning 5–9, day 9–17, evening 17–21, night 21–24. Per-hour buckets were tested: for kartikey they partly hold up (psytrance 6–8, vaporwave 12–16), but 17–20 jumps between unrelated labels, and the small profiles have about 120–170 plays per hour.
- **Count:** each play counts at most once per label.
- **Adjusted lift** = (n + 20) / (expected + 20), where `n` is the label's plays in the bucket and `expected` = bucket plays × the label's share of all plays. The constant 20 pulls small counts toward 1. At 10 the order was almost the same; at 50 broad labels won on small profiles.
- **Show a label only when all of these are true:**
  - n ≥ 15
  - at least 3 distinct artists
  - its top artist has at most 50% of the label's plays in that bucket
  - the bucket has at least 150 plays
  - adjusted lift ≥ 1.15
- Show the top 3 labels per bucket.

The artist rules matter most. Without them, the winners were single-artist results: "smooth jazz 9.15" (1 artist, 100% of plays) and "progressive trance 8.38" (1 artist). Raising the play minimum to 30 did not remove them.

### Results with these settings

| Profile | Late 0–5 | Morning 5–9 | Day 9–17 | Evening 17–21 | Night 21–24 |
|---|---|---|---|---|---|
| kartikey | rain sounds 1.97, video game music 1.81, nature sounds 1.78 | prog psytrance 1.71, psytrance 1.65, prog trance 1.60 | drone 1.34, progressive electronic 1.31, microhouse 1.31 | acid house 1.47, boom bap 1.36, meditation 1.32 | j-pop 1.68, chillhop 1.67, rain sounds 1.58 |
| mikeox | hidden (113 plays) | dance 1.86, house 1.63, drum and bass 1.57 | trip-hop 1.21 | liquid dnb 1.43, drum and bass 1.29, female vocalists 1.26 | indie pop 1.79, indie 1.70, dream pop 1.62 |
| bbnatnat | electronica 1.33, house 1.30, male vocalists 1.22 | trap 1.37, pop rap 1.31, afrobeats 1.31 | dream pop 1.35, disco 1.28, synthpop 1.22 | hidden (17 plays) | hyperpop 1.29, pop rock 1.28, dance pop 1.24 |
| m-akb | trap 1.45, southern hip-hop 1.30, gangsta rap 1.21 | instrumental 1.39 | uk garage 1.34, deep house 1.28, dubstep 1.28 | pop rap 1.36, west coast hip-hop 1.23, jazz 1.22 | dance 1.24, lo-fi 1.22, soul 1.18 |

This table was made before the 1.15 floor was chosen, so some values in it are below 1.15.

## Database

Built in `20261020100000_listening_insights_cache.sql`, together with the popularity score (`docs/popularity-score-plan.md`).

1. Table `clock_tag_rules(normalized_tag pk, decision, category, label, notes, updated_at)`. Same RLS and grants as `genre_tag_rules` (service-only). A check constraint requires a label and a style/texture/mood category for `include`, and no label with a place/era/person_or_label/junk category for `exclude`. Seeded from `docs/mood-clock-tags-draft.csv` (554 rows).
2. Computed in `build_insights_payload`, written to the `public_insights:<user_id>` cache row by the daily `refresh-insights-caches` job. It stays out of `build_overview_payload` for cost reasons.
3. Window: **all time**. The three friends have had about 3 months of history since July 2026; a 30-day window would hide most buckets.
4. Payload: `hour_tags: [{ part, first_hour, last_hour, plays, labels: [{ label, plays, lift }] }]`, always five parts in order. Thresholds are applied in SQL, so hidden parts have an empty `labels` array.
5. Changing a rule triggers nothing (the same gap as `genre_tag_rules`). The daily job picks the change up the next day, or run `select public.refresh_all_insights_caches();`.

## Browser

- `src/lib/insights.ts` (pure): `HOUR_PART_NAMES`, `hourRange` ("05–09"), `formatLift` ("2.0×"), `hasHourTags`.
- `src/lib/components/HourTags.svelte`: five columns (two on tablets, one on phones), each with the part's hours and its top 3 labels; the strongest label is in accent. Parts with nothing to show say "Nothing stands out".
- Homepage: a "What your hours sound like" section after "The age of your music". Hidden when no part has a label.

## Open questions (accepted as drafted for now)

1. Review the CSV. The subagent marked 17 borderline tags: swag, based, opium, boyband, male vocalists, beats → instrumental hip-hop, hardcore, minimal, anime, comfy, chillhop kept apart from lo-fi, bare west/east coast merged into hip-hop labels, composer(s), irish hip hop as a place, the synthwave merge (retrowave, dreamwave, chillsynth), funny (comedy) as a mood, and whether to keep umbrella genres (hip-hop, electronic, pop).
2. Whether umbrella genres stay. They rarely win, but they do no harm.
3. Panel name.
