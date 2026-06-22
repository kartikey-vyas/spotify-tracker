from __future__ import annotations

import json
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

import polars as pl

AUDIO_FILE_PREFIX = "Streaming_History_Audio_"
AUDIO_FILE_SUFFIX = ".json"

DEDUPE_KEY_FIELDS = (
    "ts",
    "spotify_track_uri",
    "spotify_episode_uri",
    "ms_played",
    "platform",
    "reason_start",
    "reason_end",
)

SAFE_EXPORT_COLUMNS = (
    "ts",
    "platform",
    "ms_played",
    "master_metadata_track_name",
    "master_metadata_album_artist_name",
    "master_metadata_album_album_name",
    "spotify_track_uri",
    "episode_name",
    "episode_show_name",
    "spotify_episode_uri",
    "reason_start",
    "reason_end",
    "shuffle",
    "skipped",
    "offline",
    "incognito_mode",
)


@dataclass(frozen=True)
class ExportFile:
    display_name: str
    rows: list[dict[str, Any]]


def is_audio_history_file(path: str | Path) -> bool:
    name = Path(path).name
    return name.startswith(AUDIO_FILE_PREFIX) and name.endswith(AUDIO_FILE_SUFFIX)


def _load_json_array(handle: TextIO, display_name: str) -> list[dict[str, Any]]:
    parsed = json.load(handle)
    if not isinstance(parsed, list):
        raise ValueError(f"{display_name} did not contain a JSON array")
    if not all(isinstance(row, dict) for row in parsed):
        raise ValueError(f"{display_name} contained non-object rows")
    return parsed


def iter_audio_export_files(input_path: str | Path) -> Iterable[ExportFile]:
    path = Path(input_path)
    if path.is_file() and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            for member in sorted(archive.namelist()):
                if not is_audio_history_file(member):
                    continue
                with archive.open(member) as raw:
                    rows = json.loads(raw.read().decode("utf-8"))
                if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
                    raise ValueError(f"{member} did not contain a JSON object array")
                yield ExportFile(member, rows)
        return

    if path.is_file():
        if not is_audio_history_file(path):
            raise ValueError(f"{path} is not a {AUDIO_FILE_PREFIX}*.json file")
        with path.open(encoding="utf-8") as handle:
            yield ExportFile(path.name, _load_json_array(handle, str(path)))
        return

    if not path.is_dir():
        raise FileNotFoundError(f"Spotify export input not found: {path}")

    for file_path in sorted(path.rglob(f"{AUDIO_FILE_PREFIX}*{AUDIO_FILE_SUFFIX}")):
        if not file_path.is_file() or not is_audio_history_file(file_path):
            continue
        with file_path.open(encoding="utf-8") as handle:
            yield ExportFile(str(file_path.relative_to(path)), _load_json_array(handle, str(file_path)))


def load_export(input_path: str | Path) -> pl.DataFrame:
    frames = []
    for export_file in iter_audio_export_files(input_path):
        if not export_file.rows:
            continue
        frame = pl.from_dicts(export_file.rows, infer_schema_length=None).with_columns(
            pl.lit(export_file.display_name).alias("_source_file")
        )
        frames.append(frame)

    if not frames:
        return pl.DataFrame({"_source_file": []})

    return pl.concat(frames, how="diagonal_relaxed")


def _with_required_columns(frame: pl.DataFrame, columns: Iterable[str]) -> pl.DataFrame:
    result = frame
    for column in columns:
        if column not in result.columns:
            result = result.with_columns(pl.lit(None).alias(column))
    return result


def _with_parsed_ts(frame: pl.DataFrame) -> pl.DataFrame:
    return frame.with_columns(
        pl.col("ts")
        .str.to_datetime(time_zone="UTC", strict=False)
        .alias("_parsed_ts")
    )


def clean_export_frame(frame: pl.DataFrame, cutoff_iso: str) -> pl.DataFrame:
    if "ts" not in frame.columns:
        raise ValueError("Export data is missing required ts column")
    if "spotify_track_uri" not in frame.columns:
        raise ValueError("Export data is missing required spotify_track_uri column")

    cutoff = pl.Series([cutoff_iso]).str.to_datetime(time_zone="UTC", strict=True)[0]
    with_columns = _with_required_columns(frame, SAFE_EXPORT_COLUMNS)
    parsed = _with_parsed_ts(with_columns)

    invalid_ts = parsed.filter(pl.col("_parsed_ts").is_null() & pl.col("ts").is_not_null()).height
    if invalid_ts:
        raise ValueError(f"{invalid_ts} rows had invalid ts values")

    return (
        parsed.filter(pl.col("spotify_track_uri").is_not_null())
        .filter(pl.col("_parsed_ts").is_not_null())
        .filter(pl.col("_parsed_ts") < cutoff)
        .select(list(SAFE_EXPORT_COLUMNS))
    )


def summarize_history(frame: pl.DataFrame) -> dict[str, Any]:
    if frame.is_empty() or "ts" not in frame.columns:
        return {
            "rows": 0,
            "date_range": {"start": None, "end": None},
            "plays_by_year": [],
            "top_artists": [],
            "top_tracks": [],
            "null_track_uri_rate": None,
            "skipped_rate": None,
            "offline_rate": None,
            "incognito_rate": None,
            "ms_played_distribution": {},
        }

    working = _with_required_columns(
        frame,
        [
            "spotify_track_uri",
            "master_metadata_album_artist_name",
            "master_metadata_track_name",
            "skipped",
            "offline",
            "incognito_mode",
            "ms_played",
        ],
    )
    parsed = _with_parsed_ts(working)
    rows = parsed.height

    def bool_rate(column: str) -> float | None:
        if rows == 0:
            return None
        return parsed.select(pl.col(column).fill_null(False).cast(pl.Int64).sum()).item() / rows

    ms_stats = (
        parsed.select(
            pl.col("ms_played").cast(pl.Int64, strict=False).quantile(0.0).alias("min"),
            pl.col("ms_played").cast(pl.Int64, strict=False).quantile(0.5).alias("p50"),
            pl.col("ms_played").cast(pl.Int64, strict=False).quantile(0.9).alias("p90"),
            pl.col("ms_played").cast(pl.Int64, strict=False).quantile(0.99).alias("p99"),
            pl.col("ms_played").cast(pl.Int64, strict=False).max().alias("max"),
        )
        .to_dicts()[0]
    )

    return {
        "rows": rows,
        "date_range": {
            "start": parsed.select(pl.col("_parsed_ts").min()).item(),
            "end": parsed.select(pl.col("_parsed_ts").max()).item(),
        },
        "plays_by_year": (
            parsed.with_columns(pl.col("_parsed_ts").dt.year().alias("year"))
            .group_by("year")
            .len(name="plays")
            .sort("year")
            .to_dicts()
        ),
        "top_artists": (
            parsed.group_by("master_metadata_album_artist_name")
            .len(name="plays")
            .sort("plays", descending=True)
            .head(25)
            .to_dicts()
        ),
        "top_tracks": (
            parsed.group_by(["master_metadata_track_name", "master_metadata_album_artist_name"])
            .len(name="plays")
            .sort("plays", descending=True)
            .head(25)
            .to_dicts()
        ),
        "null_track_uri_rate": parsed.select(pl.col("spotify_track_uri").is_null().sum()).item() / rows,
        "skipped_rate": bool_rate("skipped"),
        "offline_rate": bool_rate("offline"),
        "incognito_rate": bool_rate("incognito_mode"),
        "ms_played_distribution": ms_stats,
    }


def _json_default(value: Any) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def write_cleaned_export(
    frame: pl.DataFrame,
    out_dir: str | Path,
    cutoff_iso: str,
    source_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    with_year = _with_parsed_ts(frame).with_columns(pl.col("_parsed_ts").dt.year().alias("_year"))
    output_files = []
    rows_written = 0

    for year in with_year.select("_year").drop_nulls().unique().sort("_year").to_series().to_list():
        year_frame = with_year.filter(pl.col("_year") == year).select(list(SAFE_EXPORT_COLUMNS))
        records = year_frame.to_dicts()
        file_path = out_path / f"cleaned_{year}.json"
        with file_path.open("w", encoding="utf-8") as handle:
            json.dump(records, handle, ensure_ascii=False, indent=2, default=_json_default)
            handle.write("\n")
        rows_written += len(records)
        output_files.append({"path": str(file_path), "rows": len(records)})

    summary = {
        "cutoff_iso": cutoff_iso,
        "rows_written": rows_written,
        "output_files": output_files,
        "history": source_summary,
    }
    with (out_path / "summary.json").open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2, default=_json_default)
        handle.write("\n")
    return summary
