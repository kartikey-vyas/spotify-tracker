from __future__ import annotations

import json
import zipfile
from pathlib import Path

import polars as pl

from backfill.cleaning import clean_export_frame, load_export, write_cleaned_export


def export_row(ts: str, uri: str | None = "spotify:track:abc") -> dict[str, object]:
    return {
        "ts": ts,
        "platform": "ios",
        "ms_played": 12345,
        "master_metadata_track_name": "Track",
        "master_metadata_album_artist_name": "Artist",
        "master_metadata_album_album_name": "Album",
        "spotify_track_uri": uri,
        "spotify_episode_uri": None,
        "reason_start": "trackdone",
        "reason_end": "fwdbtn",
        "shuffle": False,
        "skipped": True,
        "offline": False,
        "incognito_mode": True,
        "ip_addr": "127.0.0.1",
        "conn_country": "US",
    }


def write_json(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows), encoding="utf-8")


def test_loads_zipped_export_and_ignores_video_files(tmp_path: Path) -> None:
    archive = tmp_path / "my_spotify_data.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr(
            "Spotify Extended Streaming History/Streaming_History_Audio_2020.json",
            json.dumps([export_row("2020-01-01T00:00:00Z")]),
        )
        zf.writestr(
            "Spotify Extended Streaming History/Streaming_History_Video_2020.json",
            json.dumps([export_row("2020-01-02T00:00:00Z", "spotify:episode:def")]),
        )

    frame = load_export(archive)

    assert frame.height == 1
    assert frame["spotify_track_uri"].to_list() == ["spotify:track:abc"]


def test_loads_extracted_export_layout(tmp_path: Path) -> None:
    write_json(
        tmp_path / "Spotify Extended Streaming History" / "Streaming_History_Audio_2021.json",
        [export_row("2021-03-01T00:00:00Z")],
    )

    frame = load_export(tmp_path)

    assert frame.height == 1
    assert frame["_source_file"].to_list() == [
        "Spotify Extended Streaming History/Streaming_History_Audio_2021.json"
    ]


def test_cleaning_drops_null_track_uri_and_applies_strict_cutoff() -> None:
    frame = pl.from_dicts(
        [
            export_row("2020-01-01T00:00:00Z", "spotify:track:old"),
            export_row("2020-01-02T00:00:00Z", None),
            export_row("2020-01-03T00:00:00Z", "spotify:track:cutoff"),
            export_row("2020-01-04T00:00:00Z", "spotify:track:new"),
        ]
    )

    cleaned = clean_export_frame(frame, "2020-01-03T00:00:00Z")

    assert cleaned.height == 1
    assert cleaned["spotify_track_uri"].to_list() == ["spotify:track:old"]


def test_write_preserves_dedupe_key_values_and_strips_pii(tmp_path: Path) -> None:
    original = export_row("2020-01-01T00:00:00Z", "spotify:track:abc")
    frame = clean_export_frame(pl.from_dicts([original]), "2020-02-01T00:00:00Z")

    write_cleaned_export(frame, tmp_path, "2020-02-01T00:00:00Z")

    [written] = json.loads((tmp_path / "cleaned_2020.json").read_text(encoding="utf-8"))
    for key in [
        "ts",
        "spotify_track_uri",
        "spotify_episode_uri",
        "ms_played",
        "platform",
        "reason_start",
        "reason_end",
    ]:
        assert written[key] == original[key]
    assert "ip_addr" not in written
    assert "conn_country" not in written

