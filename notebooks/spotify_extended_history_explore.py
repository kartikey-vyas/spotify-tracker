import marimo

__generated_with = "0.14.0"
app = marimo.App(width="full")


@app.cell
def _():
    import duckdb
    import marimo as mo
    import polars as pl

    from tools.spotify_backfill import clean_export_frame, load_export, summarize_history

    return clean_export_frame, duckdb, load_export, mo, pl, summarize_history


@app.cell
def _(mo):
    mo.md(
        """
        # Spotify extended history exploration

        Point this notebook at a local `my_spotify_data.zip` file or extracted Spotify export folder.
        The committed notebook contains no Spotify rows; raw data and generated outputs stay under gitignored paths.
        """
    )
    return


@app.cell
def _(mo):
    export_path = mo.ui.text(
        label="Spotify export path",
        value="my_spotify_data.zip",
        full_width=True,
    )
    cutoff_iso = mo.ui.text(
        label="Cutoff ISO for preview cleaning",
        value="2026-01-01T00:00:00Z",
        full_width=True,
    )
    mo.vstack([export_path, cutoff_iso])
    return cutoff_iso, export_path


@app.cell
def _(export_path, load_export, mo):
    load_error = None
    try:
        history_df = load_export(export_path.value)
    except Exception as exc:
        history_df = None
        load_error = exc

    mo.callout(str(load_error), kind="danger") if load_error else mo.md(f"Loaded `{history_df.height:,}` audio rows.")
    return history_df, load_error


@app.cell
def _(history_df, load_error, mo, summarize_history):
    if load_error or history_df is None:
        summary = None
        mo.stop(True)
    summary = summarize_history(history_df)
    mo.ui.table(
        [
            {"metric": "Rows", "value": summary["rows"]},
            {"metric": "First timestamp", "value": summary["date_range"]["start"]},
            {"metric": "Last timestamp", "value": summary["date_range"]["end"]},
            {"metric": "Null track URI rate", "value": summary["null_track_uri_rate"]},
            {"metric": "Skipped rate", "value": summary["skipped_rate"]},
            {"metric": "Offline rate", "value": summary["offline_rate"]},
            {"metric": "Incognito rate", "value": summary["incognito_rate"]},
        ]
    )
    return summary


@app.cell
def _(mo, summary):
    mo.vstack(
        [
            mo.md("## Plays by year"),
            mo.ui.table(summary["plays_by_year"]),
            mo.md("## Top artists"),
            mo.ui.table(summary["top_artists"]),
            mo.md("## Top tracks"),
            mo.ui.table(summary["top_tracks"]),
        ]
    )
    return


@app.cell
def _(clean_export_frame, cutoff_iso, history_df, mo):
    try:
        cleaned_preview = clean_export_frame(history_df, cutoff_iso.value)
        clean_error = None
    except Exception as exc:
        cleaned_preview = None
        clean_error = exc

    if clean_error:
        mo.callout(str(clean_error), kind="danger")
    else:
        mo.md(f"Preview keeps `{cleaned_preview.height:,}` rows with track URIs and `ts < {cutoff_iso.value}`.")
    return cleaned_preview, clean_error


@app.cell
def _(clean_error, cleaned_preview, mo):
    mo.ui.dataframe(cleaned_preview) if not clean_error else mo.md("")
    return


@app.cell
def _(mo):
    sql_query = mo.ui.text_area(
        label="DuckDB SQL over history_df",
        value="""select
  date_part('year', cast(ts as timestamptz)) as year,
  count(*) as plays
from history_df
where spotify_track_uri is not null
group by 1
order by 1""",
        full_width=True,
    )
    sql_query
    return sql_query


@app.cell
def _(duckdb, history_df, mo, sql_query):
    sql_error = None
    try:
        sql_result = duckdb.sql(sql_query.value).pl()
    except Exception as exc:
        sql_result = None
        sql_error = exc

    mo.callout(str(sql_error), kind="danger") if sql_error else mo.ui.table(sql_result)
    return sql_error, sql_result


@app.cell
def _(mo):
    mo.md(
        """
        Export cleaned files from the terminal:

        ```bash
        uv run python -m tools.spotify_backfill.clean --input my_spotify_data.zip --out analysis/out --cutoff-iso '<timestamp>'
        ```
        """
    )
    return


if __name__ == "__main__":
    app.run()
