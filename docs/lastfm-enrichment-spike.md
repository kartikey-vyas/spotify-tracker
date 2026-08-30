# MusicBrainz + Last.fm enrichment spike

> The spike commands remain useful for provider exploration and manual report
> capture. Production coverage is now handled by the scheduled worker described
> below; it does not require repeatedly running this script.

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

## Production queue and enrichment runners

Migration `20260827073746_external_metadata_enrichment_worker.sql` adds a
service-only queue for tracks, artists and albums, a singleton worker lease,
retry state, run telemetry, enqueue triggers and an original ten-minute
`pg_cron` job. Migration
`20260830111346_pause_external_enrichment_cron_for_local_drain.sql` pauses only
that external-enrichment job while the production queue is drained locally.
It seeds every current track with a valid ISRC plus the related artists and
albums. Existing imported Last.fm entities start complete; the rest are
processed from highest aggregate play count downward.

The `enrich-external-metadata` Edge Function claims at most 20 mixed entities
per invocation. It serializes MusicBrainz lookups at 1.1 seconds apart and
Last.fm calls at 500ms apart, writes successful endpoint results immediately,
and preserves that endpoint state when another endpoint needs a retry. A
singleton database lease prevents scheduled and manual invocations from
overlapping. Items retry with exponential backoff and become `dead` after eight
failed attempts so a permanent provider/configuration issue cannot loop forever.

`caffeinate -i node --max-old-space-size=128 --import tsx
scripts/supervise-external-metadata-local.ts --duration-hours=12` runs a small
supervisor around the shared Node worker. Use Node directly because package
manager wrappers can intercept terminal signals before lease cleanup. Each
worker gets one shared 1.1-second pacer for both
providers, limiting all outbound provider calls globally to less than one per
second, including a pacing pause across process boundaries. The supervisor
recycles workers after 25 batches or 30 minutes, starts them with a 384 MiB V8
heap ceiling, samples worker and supervisor memory every minute, and requests an
early recycle at 512 MiB RSS. Output is mirrored to a timestamped JSONL file in
`analysis/logs/`; non-zero exits restart with bounded exponential backoff.
Provider circuit state persists across batches and half-opens with one request
after the provider-specific cooldown. If both providers are unavailable, the
worker waits for the first cooldown instead of cycling database queue items.

The database singleton lease makes an accidental hosted invocation harmless,
although the cron should remain paused to avoid wasting Edge Function
invocations. SIGINT/SIGTERM stops after the current claimed batch. The runner
stops claiming work at 500 pending rollup refreshes, so external genre discovery
cannot outrun the database drain indefinitely. On macOS, run it under
`caffeinate -i` to prevent system sleep.

The production worker deliberately requests only the fields retained by the
schema:

- track: MusicBrainz ISRC candidates plus Last.fm info, top tags and similar
  tracks;
- artist: Last.fm info and top tags;
- album: Last.fm info and top tags.

The worker queries track info and similarities by the selected recording MBID
first, then falls back to artist/title if Last.fm rejects that MBID. Track tags
use artist/title directly because Last.fm returns an empty HTTP 400 for some
valid recording MBIDs on `track.getTopTags`. Request-specific 4xx responses do
not open the batch-wide provider circuit. Genre projection and historic rollup
refreshes reuse the same reviewed importer/RPC path as manual reports. The
rollup drain keeps its production-proven 150-date batch and runs every three
minutes; larger batches can exceed the database statement timeout. Production
timings put the 150-date transaction at 7–11 seconds, while the heaviest
observed ten-entity artist batch queued 326 unique user/date refreshes. Genre
refresh and rollup queueing are atomic, and historic dates are queued only when
the artist's effective public genre set actually changes. Per-user public-stat
refreshes take a transaction advisory lock so scheduled sync and rollup drains
cannot race the delete-then-insert activity projection.

The separate Spotify metadata backfill persists long app-wide `Retry-After`
deadlines in `enrichment_runs`. While that cooldown is active, its scheduled
Edge invocation records a zero-failure skip without requesting a token or
calling Spotify; MusicBrainz and Last.fm enrichment continue independently.

Required Edge Function secret:

```bash
supabase secrets set LASTFM_API_KEY=...
```

`MUSICBRAINZ_USER_AGENT` is optional; the repository/contact default is used
when it is absent. Inspect progress and the last ten batches with:

```bash
pnpm external:status
```
