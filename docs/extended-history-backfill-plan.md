# Extended Streaming History — Backfill Plan

Hybrid approach: **Python** for exploration + cleaning → **data-seam file** → existing **TS importer** for the authoritative idempotent write. Goal: load ~12 years (2014–2026) of extended streaming history into the DB without double-counting against the live sync.

## Grounding facts (already verified)

- **Data:** `my_spotify_data.zip` → `Spotify Extended Streaming History/Streaming_History_Audio_YYYY.json` for 2014–2026, plus `Streaming_History_Video_*.json` (ignore video). Each audio file is a JSON array of play records.
- **Audio record schema:** `ts` (ISO), `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`, `master_metadata_album_album_name`, `spotify_track_uri`, `reason_start`, `reason_end`, `shuffle`, `skipped`, `offline`, `incognito_mode`, `platform`, `conn_country`, `ip_addr`, plus null episode/audiobook fields for music rows.
- **The TS importer already consumes this exact format.** `scripts/import-spotify-export.ts` has an `ExportRow` type matching these fields and writes events with `source = SOURCE_EXPORT (1)`, `data_quality = QUALITY_EXACT (1)`. **No reformatting needed.**
- **Idempotency / dedup key:** `sourceEventKey = sha256(['export', ts, spotify_track_uri, spotify_episode_uri, ms_played, platform, reason_start, reason_end])`, upserted on `(user_id, source_event_key)` with `ignoreDuplicates`. Re-importing the same rows is a no-op.

## The data seam

- **Format:** NDJSON (one record per line) or a JSON array, in **Spotify export-row shape**. Because the TS importer parses raw export rows, Python's cleaned output is just filtered export-format files — the importer eats them unchanged.
- **Hard rule:** Python must pass the 8 dedup-key fields through **verbatim** (`ts`, `spotify_track_uri`, `spotify_episode_uri`, `ms_played`, `platform`, `reason_start`, `reason_end`). Altering any of them changes the hash and breaks dedup against re-imports. Filtering rows = fine; mutating these fields = not.

## Python side — explore + clean (no coupling to `src/` or `scripts/lib`)

Location: `analysis/` (gitignored). Toolchain: `uv` + `pandas` (+ `pyarrow` optional). Skills available: `uv`, `ruff`, `ty`.

1. **Load** all `Streaming_History_Audio_*.json` into one DataFrame.
2. **Explore:** total plays, date range, plays/year, top artists/tracks, `ms_played` distribution, % rows with null `spotify_track_uri`, skipped rate, incognito/offline counts.
3. **Filter to music:** keep rows where `spotify_track_uri` is not null (drops podcasts/audiobooks/video and "local file" plays). Decide on incognito/ultra-short plays — recommend **keep them** and let the rollups' existing `>=30s` qualification handle it (don't pre-judge minutes).
4. **Overlap cutoff (CRITICAL — see below).** Emit only export rows older than where the live sync's coverage begins.
5. **Emit** cleaned NDJSON to `analysis/out/` (per-year or single file).

### ⚠️ The overlap double-count problem (most important correctness issue)

The live sync ingests recent plays as `source = SOURCE_RECENTLY_PLAYED` with a **different** `source_event_key` scheme. The export also contains those same recent plays as `SOURCE_EXPORT`. They will **not** dedupe against each other → the overlap window gets **double-counted** minutes/plays.

**Decide a cutoff in Python before emitting:**
- Query the earliest synced event: `min(played_at)` of `listening_events where source = 2 (SOURCE_RECENTLY_PLAYED)` for the user (or `sync_state.recently_played_cursor_ms` / `api_only_period_start`).
- Emit only export rows with `ts <` that boundary. Recent plays stay owned by the sync; history owned by the export. Clean split, no reconciliation needed.

## TS side — authoritative write

1. **Fix the importer's no-op refresh first.** `scripts/import-spotify-export.ts` calls `refreshPublicStats` (a gutted no-op since the anon feed was archived), so rollups won't recompute after import. Change it to `refreshConnectedUsersPublicStats(supabase, uniqueSortedDates(affectedDates))` — exactly the fix already applied to `enrich-metadata.ts` (see `scripts/lib/supabase-admin.ts`).
2. **Get the auth user id.** The importer scopes events via `--user-id=<auth-user-uuid>`; without it, it writes legacy `user_id = null` rows that the current per-user app ignores. Find your real uuid (Supabase Auth users / `spotify_connections.user_id`).
3. **Run:** `pnpm import:spotify-export --user-id=<uuid> ./analysis/out/cleaned_*.json`. It upserts fallback artist/album/track dimension rows (no Spotify IDs yet) + `listening_events`.
4. **Enrich after:** run `pnpm enrich:metadata` repeatedly to backfill artist images for the imported artists (per-run caps: 50/50/100). Genres still need the Last.fm source from `TODO.md`. The per-user rollup refresh now propagates these.

## Validation / done criteria

- Imported event count ≈ kept Python rows.
- **Re-run import → 0 new rows** (idempotency proven).
- Spot-check a date present in both export and sync: no doubled minutes/plays (overlap cutoff worked).
- Overview/rollups show historical dates (e.g., top artists for 2017).

## Privacy

- Raw export holds **PII** (`ip_addr`, `conn_country`, `platform`). `my_spotify_data.zip`, any extracted data, and `analysis/out/` are gitignored — **never commit raw data or PII**. Strip `ip_addr`/`conn_country` from anything that leaves the machine.
