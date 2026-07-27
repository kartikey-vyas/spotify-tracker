// Metadata enrichment, driven by pg_cron instead of GitHub Actions.
//
// GitHub's scheduler dropped and delayed enough runs to matter: over the first
// 43 hours it fired 11 times against 14 requested, drifting up to 2h31m. This
// is the same reason sync-recently-played moved to pg_cron.
//
// The batch is deliberately small. A function invocation has a wall-clock
// budget, and unlike the Node script this one must not also refresh rollups —
// a 40-track batch produced 367 affected dates, and refreshing those inline is
// what blew the statement timeout on 2026-07-26. Dates are queued here and
// drained by a separate cron calling drain_rollup_refresh_queue().

import { adminClient, assertServiceRequest } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/http.ts';
import {
  clientCredentialsToken,
  getByIdOrNull,
  isRateCapError,
  type SpotifyAlbum,
  type SpotifyArtist,
  type SpotifySimplifiedArtist,
  type SpotifyTrack
} from '../_shared/spotify.ts';
import { upsertAlbumFromSpotify, upsertArtistFromSpotify } from '../_shared/dimensions.ts';

// The extended-history backfill user. Mirrors USER in scripts/enrich-backfill.ts.
const DEFAULT_USER = '6873a96d-3c4a-49a2-b487-1e7a78226280';
const DEFAULT_BATCH_SIZE = 30;
const DEFAULT_CONCURRENCY = 3;

type UnenrichedTrack = { id: number; spotify_track_id: string };

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        await worker(items[cursor++]);
      }
    })
  );
}

/** Memoize a per-key resolver so the same id is only written once per run. */
function memoize<T, R>(fn: (value: T) => Promise<R>, keyOf: (value: T) => string): (value: T) => Promise<R> {
  const cache = new Map<string, Promise<R>>();
  return (value: T) => {
    const key = keyOf(value);
    let hit = cache.get(key);
    if (!hit) {
      hit = fn(value);
      cache.set(key, hit);
    }
    return hit;
  };
}

Deno.serve(async (req: Request) => {
  try {
    assertServiceRequest(req);

    const body = (await req.json().catch(() => ({}))) as {
      user_id?: string;
      batch_size?: number;
      concurrency?: number;
    };
    const userId = body.user_id ?? DEFAULT_USER;
    const batchSize = Math.max(1, Math.min(body.batch_size ?? DEFAULT_BATCH_SIZE, 200));
    const concurrency = Math.max(1, Math.min(body.concurrency ?? DEFAULT_CONCURRENCY, 8));

    const supabase = adminClient();

    const { data: worklist, error: worklistError } = await supabase.rpc('next_unenriched_tracks', {
      p_user_id: userId,
      batch_size: batchSize
    });
    if (worklistError) throw new Error(`Loading worklist failed: ${worklistError.message}`);

    const tracks = (worklist ?? []) as UnenrichedTrack[];
    if (tracks.length === 0) {
      return json({ enriched: 0, missing: 0, failed: 0, aborted: false, queued_dates: 0 });
    }

    const { data: runRow } = await supabase
      .from('enrichment_runs')
      .insert({
        trigger: 'cron',
        requested_limit: batchSize,
        concurrency,
        worklist_size: tracks.length
      })
      .select('id')
      .single();
    const runId = (runRow as { id: number } | null)?.id ?? null;

    const token = await clientCredentialsToken();
    const resolveAlbum = memoize(
      (album: SpotifyAlbum) => upsertAlbumFromSpotify(supabase, album),
      (album) => album.id
    );
    const resolveArtist = memoize(
      (artist: SpotifyArtist | SpotifySimplifiedArtist) => upsertArtistFromSpotify(supabase, artist),
      (artist) => artist.id
    );

    const affectedDates = new Set<string>();
    let enriched = 0;
    let missing = 0;
    let failed = 0;
    // Doubles as the abort flag: a non-null value means the run hit the cap.
    let abortRetryAfter: number | null = null;

    await pool(tracks, concurrency, async (track) => {
      if (abortRetryAfter !== null) return;
      try {
        const spotifyTrack = await getByIdOrNull<SpotifyTrack>(
          `/v1/tracks/${track.spotify_track_id}`,
          token
        );

        // A 404 id must be marked refreshed or it is handed back forever.
        if (!spotifyTrack) {
          await supabase
            .from('tracks')
            .update({ last_refreshed_at: new Date().toISOString() })
            .eq('id', track.id);
          missing += 1;
          return;
        }

        // Independent upserts into two unrelated tables. Promise.all preserves
        // input order, which track_artists.artist_order depends on.
        const [albumId, artistIds] = await Promise.all([
          spotifyTrack.album ? resolveAlbum(spotifyTrack.album) : Promise.resolve(null),
          Promise.all((spotifyTrack.artists ?? []).map(resolveArtist))
        ]);

        const { error: trackError } = await supabase
          .from('tracks')
          .update({
            name: spotifyTrack.name,
            album_id: albumId,
            duration_ms: spotifyTrack.duration_ms ?? null,
            explicit: spotifyTrack.explicit ?? null,
            isrc: spotifyTrack.external_ids?.isrc ?? null,
            spotify_url: spotifyTrack.external_urls?.spotify ?? null,
            last_refreshed_at: new Date().toISOString()
          })
          .eq('id', track.id);
        if (trackError) throw new Error(`Updating track: ${trackError.message}`);

        if (artistIds.length > 0) {
          const { error: taError } = await supabase.from('track_artists').upsert(
            artistIds.map((artistId, index) => ({
              track_id: track.id,
              artist_id: artistId,
              artist_order: index
            })),
            { onConflict: 'track_id,artist_id' }
          );
          if (taError) throw new Error(`Upserting track artists: ${taError.message}`);
        }

        const { data: updatedEvents, error: evError } = await supabase
          .from('listening_events')
          .update({ album_id: albumId, primary_artist_id: artistIds[0] ?? null })
          .eq('user_id', userId)
          .eq('track_id', track.id)
          .select('local_date');
        if (evError) throw new Error(`Repointing events: ${evError.message}`);
        for (const row of (updatedEvents ?? []) as Array<{ local_date: string }>) {
          affectedDates.add(row.local_date);
        }

        enriched += 1;
      } catch (error) {
        failed += 1;
        if (isRateCapError(error)) {
          abortRetryAfter ??= error.retryAfter ?? null;
          return;
        }
        console.warn(`track ${track.spotify_track_id} failed: ${(error as Error).message}`);
      }
    });

    // Queued rather than refreshed inline; see the header comment.
    if (affectedDates.size > 0) {
      const { error: queueError } = await supabase.from('rollup_refresh_queue').upsert(
        [...affectedDates].map((local_date) => ({ user_id: userId, local_date })),
        { onConflict: 'user_id,local_date', ignoreDuplicates: true }
      );
      if (queueError) console.warn(`Queueing rollup dates failed: ${queueError.message}`);
    }

    if (runId !== null) {
      await supabase
        .from('enrichment_runs')
        .update({
          enriched,
          missing,
          failed,
          aborted: abortRetryAfter !== null,
          abort_retry_after_seconds: abortRetryAfter,
          finished_at: new Date().toISOString()
        })
        .eq('id', runId);
    }

    return json({
      enriched,
      missing,
      failed,
      aborted: abortRetryAfter !== null,
      abort_retry_after_seconds: abortRetryAfter,
      queued_dates: affectedDates.size
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorJson(message, message === 'Invalid service credential' ? 401 : 400);
  }
});
