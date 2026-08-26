# MusicBrainz + Last.fm enrichment spike

The capture command is an evidence-gathering pass. It reads the most-played
current tracks from Supabase, resolves each Spotify ISRC to MusicBrainz
recording candidates, and writes the raw responses under the gitignored
`analysis/` directory. It does not update any database table by itself.

## Setup

Create a Last.fm API application at <https://www.last.fm/api/account/create>,
then add its read-only API key to `.env.local`:

```dotenv
LASTFM_API_KEY=...
```

MusicBrainz does not require a key. The script sends an identifying User-Agent
using the repository URL. Set `MUSICBRAINZ_USER_AGENT` only if that contact
should be different.

The normal script credentials are also required because track selection reads
the existing dataset:

```dotenv
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
```

## Run

Resolve MusicBrainz IDs without calling Last.fm:

```bash
pnpm explore:lastfm --musicbrainz-only --limit=25
```

Run the complete Last.fm capture:

```bash
pnpm explore:lastfm --limit=25
```

Use `--output=analysis/lastfm-spike/my-run.json` to choose a stable output
path. MusicBrainz requests are serialized at one request per 1.1 seconds. The
Last.fm capture is also serialized, with 300ms between calls; both intervals
can be increased with `--musicbrainz-delay-ms=` and `--lastfm-delay-ms=`.

The script checkpoints the report after each entity. The Last.fm API key is
sent to Last.fm but is never included in the report.

## Captured evidence

- Spotify track, album and artist identifiers, ISRC and aggregate play count.
- Every MusicBrainz recording candidate returned for the ISRC.
- Candidate score, duration delta, confidence, ambiguity and selected MBID.
- `track.getInfo`, `track.getTopTags` and `track.getSimilar`, queried both by
  recording MBID and by artist/title.
- Artist info, top tags, similar artists, top tracks and top albums.
- Album info and top tags.
- Info and similar-tag responses for the 20 most frequently observed tags.

Low-confidence or ambiguous MusicBrainz candidates remain in the raw report
but are not selected for MBID-based Last.fm requests. Name-based Last.fm calls
still run, giving the spike a useful fallback and comparison group.

The production projection below was designed from that coverage evidence. Raw
provider responses are never copied directly into `artist_genres`.

## Import the curated projection

Migration `20260826034028_add_external_music_metadata.sql` adds the production
projection. Apply it before importing a report. Validate a report without any
database writes first:

```bash
pnpm import:lastfm-report --input=analysis/lastfm-spike/my-run.json --dry-run
```

Then import it with the service key:

```bash
pnpm import:lastfm-report --input=analysis/lastfm-spike/my-run.json
```

The importer is safe to re-run for the same entities. It replaces MusicBrainz
candidates, Last.fm tag evidence and the capped similar-track set; metadata and
same-day popularity observations are upserted. Genre changes enqueue affected
user/date rollups for the existing database drain job.

The persistent shape deliberately keeps:

- all scored MusicBrainz recording candidates, with one optional selected
  candidate per Spotify track;
- Last.fm canonical names, URLs and short wiki/bio summaries;
- one listener/play-count snapshot per entity per UTC day;
- raw and normalized track, artist and album tags;
- at most 20 similar tracks per source track.

It deliberately drops Last.fm track durations, Last.fm-returned recording
MBIDs, images already supplied by Spotify, full wiki content, top-track/top-
album payloads, and the raw JSON envelope.

Provider evidence is service-role-only with RLS enabled and explicit privilege
revocation. `artist_genres` remains the public projection. A reviewed tag-rule
whitelist maps evidence into that projection; direct artist tags win, while
album and track tags only fill artists with no mapped artist tags. Genre source
provenance prevents a Last.fm refresh from deleting Spotify genres.

`summary_html` is provider-authored HTML and is intentionally private. Any
future UI must sanitize it and preserve Last.fm's attribution/licence link; do
not render it with an unguarded HTML directive.
