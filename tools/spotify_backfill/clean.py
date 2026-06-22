from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .cleaning import clean_export_frame, load_export, summarize_history, write_cleaned_export


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Clean Spotify extended streaming history audio exports.")
    parser.add_argument("--input", required=True, help="Path to my_spotify_data.zip or an extracted export folder.")
    parser.add_argument("--out", required=True, help="Output directory, usually analysis/out.")
    parser.add_argument(
        "--cutoff-iso",
        required=True,
        help="Strict cutoff timestamp; only rows with ts < cutoff are emitted.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    frame = load_export(args.input)
    source_summary = summarize_history(frame)
    cleaned = clean_export_frame(frame, args.cutoff_iso)
    summary = write_cleaned_export(cleaned, Path(args.out), args.cutoff_iso, source_summary)
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

