# Extended Streaming History Backfill

Use **Marimo** for exploration, **Polars** for cleaning, and the existing TypeScript importer for the authoritative database write. Marimo notebooks are committed as Python files, can run through `uv`, and support DuckDB-backed SQL exploration over local dataframes.

## Local Data

Keep all private data under gitignored paths:

- Raw export: `my_spotify_data.zip` or an extracted `Spotify Extended Streaming History/` folder.
- Generated output: `analysis/out/cleaned_YYYY.json` and `analysis/out/summary.json`.
- Do not commit raw rows, IP addresses, countries, or generated cleaned files.

The cleaner reads only `Streaming_History_Audio_*.json` files and ignores video history files.

## Explore

```bash
uv run marimo edit notebooks/spotify_extended_history_explore.py
```

The notebook loads a local zip or extracted folder, then shows:

- Date range and total rows.
- Plays by year.
- Top artists and tracks.
- Null URI, skipped, offline, and incognito rates.
- `ms_played` distribution.
- A DuckDB SQL editor over the loaded `history_df` dataframe.

## Choose The Cutoff

The export overlaps with live recently-played sync data, but export rows and API rows use different source-event hashes. Without a cutoff, overlap dates double-count.

Use the earliest API event for the target user:

```sql
select min(played_at)
from listening_events
where user_id = '<auth-user-uuid>'
  and source = 2;
```

Only export rows with `ts < cutoff` should be imported.

## Clean

```bash
uv run python -m tools.spotify_backfill.clean \
  --input my_spotify_data.zip \
  --out analysis/out \
  --cutoff-iso '<timestamp>'
```

The cleaner:

- Emits JSON arrays, matching `scripts/import-spotify-export.ts`.
- Drops rows with missing `spotify_track_uri`.
- Keeps incognito, offline, skipped, and short plays.
- Applies the strict cutoff `ts < --cutoff-iso`.
- Preserves the source-event hash fields: `ts`, `spotify_track_uri`, `spotify_episode_uri`, `ms_played`, `platform`, `reason_start`, `reason_end`.
- Excludes `ip_addr` and `conn_country` from cleaned output.

## Import

```bash
pnpm import:spotify-export --user-id=<auth-user-uuid> analysis/out/cleaned_*.json
```

The importer requires `--user-id`, writes user-scoped events, keeps the existing source-event hash behavior, and refreshes the target user's affected dates with `refresh_user_public_stats`.

Re-run the import once. The second run should be a no-op because events upsert on `(user_id, source_event_key)` with duplicate ignores.

## Enrich

```bash
pnpm enrich:metadata
```

Run until refresh counts taper off.

## Validation

- Cleaned row count roughly matches importer attempted events.
- Second import does not create new rows.
- Known overlap dates do not double-count export/API plays.
- Historical years appear in profile rollups.

